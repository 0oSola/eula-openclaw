# OpenClaw Daily Codex Review Cron Contract

Date: 2026-06-08
Updated: 2026-06-11

## Purpose

This document defines the cross-system contract for a daily OpenClaw review cron
that aligns with the user on Codex review drafts and promotes confirmed items
into long-term review memory.

OpenClaw owns the scheduled conversation, user alignment, and memory-wiki
publication. FastAPI owns local facts, draft review state, user decision
persistence, memory promotion, and bounded wiki payloads.

The production network direction is:

```text
FastAPI -> OpenClaw
```

OpenClaw must not require inbound HTTP access to the local FastAPI host. FastAPI
pushes snapshots, polls OpenClaw decision commands, applies decisions locally,
and pushes command results plus accepted wiki payloads back to OpenClaw.

## Cron Identity

```text
cron_name: codex-daily-review
agent_id: codex-manager
channel: codex-review
timezone: Asia/Singapore
default_time: 09:30
session_key: codex-review-daily:YYYY-MM-DD
```

If OpenClaw does not yet provide native scheduled jobs, FastAPI may temporarily
create the OpenClaw review run by pushing the first daily snapshot at the same
time. Product behavior should still be treated as "OpenClaw starts the daily
review" because OpenClaw owns the conversation and command queue.

## Daily Flow

```text
OpenClaw cron starts
  -> create review_run(session_key, status=awaiting_snapshot)
  -> FastAPI outbound worker pushes daily summary + draft snapshot
  -> OpenClaw ranks and selects first batch
  -> OpenClaw asks user to confirm 1-3 items
  -> OpenClaw queues decision commands
  -> FastAPI outbound worker polls commands
  -> FastAPI applies decisions locally
  -> FastAPI pushes command results and accepted wiki payloads
  -> OpenClaw wiki_apply + wiki_lint
  -> OpenClaw daily git commit + git push in the Obsidian vault
  -> OpenClaw summarizes what changed
```

## Conversation Rules

OpenClaw should keep the interaction short and decision-oriented.

Default opening:

```text
今天有 {draft_count} 条 Codex 回顾待确认，其中 {high_priority_count} 条优先级较高。
我建议先处理 {batch_size} 条：

1. [{item_type}/{severity}] {title}
   {summary}

你可以回复：接受 / 忽略 / 改成：... / 稍后
```

Rules:

1. Ask at most 3 items in the first batch.
2. Never ask more than 10 items in one day unless the user explicitly requests more.
3. If the user says "接受", queue `action=accept`.
4. If the user says "忽略", queue `action=ignore`.
5. If the user says "稍后", queue `action=snooze`.
6. If the user says "改成：...", queue `action=edit_accept`.
7. If the user asks for evidence, show only bounded evidence already present in the snapshot or queue an evidence request command for FastAPI.

## OpenClaw Review Sync API

OpenClaw should expose a durable queue-style interface. Route names are
suggested and can be adapted to OpenClaw conventions, but FastAPI must initiate
the network calls.

### Snapshot Push

```http
POST /v1/apps/mmd/codex-review/runs/{session_key}/snapshot
Authorization: Bearer <fastapi-service-token>
Content-Type: application/json
```

Expected request:

```json
{
  "kind": "codex_review_daily_snapshot",
  "schema_version": 1,
  "date": "2026-06-08",
  "workspace_id": "mmd-companion",
  "summary": {
    "draft_count": 8,
    "high_priority_count": 3,
    "accepted_today": 2,
    "ignored_today": 1,
    "snoozed_today": 0,
    "recommended_batch_size": 3
  },
  "drafts": [
    {
      "id": "codex_review_...",
      "item_type": "pitfall",
      "title": "...",
      "summary": "...",
      "severity": "high",
      "tags": ["codex"],
      "priority_score": 90,
      "evidence_refs": ["event_turn_failed_1"],
      "bounded_evidence": []
    }
  ],
  "cursor": "fastapi-review-state-..."
}
```

### Command Poll

```http
GET /v1/apps/mmd/codex-review/runs/{session_key}/commands?cursor=...
Authorization: Bearer <fastapi-service-token>
```

Expected response:

```json
{
  "commands": [
    {
      "id": "openclaw_review_cmd_...",
      "type": "review_decision",
      "item_id": "codex_review_...",
      "action": "accept",
      "target": "openclaw_wiki",
      "edited_title": null,
      "edited_summary": null,
      "notes": null,
      "snooze_until": null,
      "decided_by": "admin-1",
      "decided_at": "2026-06-08T09:35:00+08:00"
    }
  ],
  "next_cursor": "..."
}
```

Command types:

- `review_decision`
- `request_evidence`
- `refresh_snapshot`
- `cancel_run`

### Command Result

```http
POST /v1/apps/mmd/codex-review/commands/{command_id}/result
Authorization: Bearer <fastapi-service-token>
Content-Type: application/json
```

Accepted decision result:

```json
{
  "status": "applied",
  "item": {"id": "codex_review_...", "status": "accepted"},
  "memory": {"id": "codex_review_memory_...", "export_status": "pending"},
  "error": null
}
```

### Memory Wiki Payload Push

FastAPI should push the wiki payload only after it has applied an `accept` or
`edit_accept` decision locally.

```http
POST /v1/apps/mmd/codex-review/runs/{session_key}/memory-payloads
Authorization: Bearer <fastapi-service-token>
Content-Type: application/json
```

Expected request:

```json
{
  "kind": "codex_review_memory_wiki_payload",
  "schema_version": 1,
  "memory": {"id": "codex_review_memory_..."},
  "wiki": {
    "path": "sources/codex-review/mmd-companion/YYYY-MM-DD/codex_review_memory_....md",
    "frontmatter": {},
    "markdown": "---\n..."
  },
  "evidence": [],
  "provenance": {}
}
```

OpenClaw then calls memory-wiki `wiki_apply`, runs `wiki_lint`, updates
dashboards/daily note, creates one daily git commit, and pushes the Obsidian
vault remote. If push is rejected or unrelated vault files are dirty, OpenClaw
stops and asks the user to resolve it; it must not auto merge or rebase.

## Local FastAPI APIs

FastAPI may keep these existing local APIs for Web/Pet/manual tooling and for
the outbound worker implementation:

- `GET /codex/reviews/daily-summary`
- `GET /codex/reviews/drafts`
- `POST /codex/reviews/items/{item_id}/decision`
- `GET /codex/reviews/memory/{memory_id}/wiki-payload`

OpenClaw should not call these APIs across the network.

## Ranking Rules

OpenClaw should preserve the FastAPI-provided `priority_score` ordering unless
the user asks for a different view.

Default priority:

1. `blocker`
2. high severity `pitfall`
3. medium severity `pitfall`
4. `decision`
5. old `followup`
6. `work_summary`

## Safety Rules

1. OpenClaw should not write unconfirmed draft content into memory-wiki.
2. OpenClaw should queue every user decision for FastAPI; FastAPI applies decisions locally.
3. OpenClaw should not request full Codex transcript.
4. OpenClaw should show evidence only when needed and only as bounded excerpts.
5. FastAPI remains the source of truth for item status and memory promotion.

## Failure Handling

| Failure | Behavior |
| --- | --- |
| FastAPI snapshot missing or stale | OpenClaw tells the user it is waiting for local MMD/FastAPI sync and retries later. |
| FastAPI command application fails | FastAPI posts `status=failed`; OpenClaw shows the failure and does not publish memory. |
| memory-wiki lint fails | OpenClaw blocks publication and reports the lint issue. |
| Obsidian vault push fails | OpenClaw stops without auto merge/rebase and reports the failing git command. |
| User gives ambiguous response | OpenClaw asks one clarifying question. |
| Duplicate decision | FastAPI command result returns current state; OpenClaw reports the item was already handled. |
| Cron missed | Next run includes still-draft and due snoozed items. |
