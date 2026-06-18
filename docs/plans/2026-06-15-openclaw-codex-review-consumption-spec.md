# OpenClaw Codex Review Consumption Spec

**Date:** 2026-06-15

**Scope:** OpenClaw-side work for consuming FastAPI outbound Codex review snapshots, generating structured knowledge drafts from review candidates, asking the user to confirm review/memory candidates, queueing commands for FastAPI, accepting memory wiki payloads, publishing them to the Obsidian memory-wiki vault, and reporting publish status.

**Non-goals:** OpenClaw must not call the local FastAPI host directly, read Codex JSONL files, execute local shell/Codex/patch/approval actions, or write unconfirmed draft content into memory-wiki.

---

## Current FastAPI Contract

FastAPI pushes:

```http
POST /v1/apps/mmd/codex-review/runs/{session_key}/snapshot
Authorization: Bearer <service-token>
Content-Type: application/json
```

`session_key` format:

```text
codex-review-daily:YYYY-MM-DD
```

Snapshot shape:

```json
{
  "kind": "codex_review_daily_snapshot",
  "schema_version": 1,
  "date": "2026-06-15",
  "workspace_id": "mmd-companion",
  "summary": {
    "date": "2026-06-15",
    "workspace_id": "mmd-companion",
    "draft_count": 100,
    "high_priority_count": 100,
    "accepted_today": 0,
    "ignored_today": 0,
    "snoozed_today": 0,
    "recommended_batch_size": 3
  },
  "drafts": [],
  "work_units": [],
  "learning_candidates": [],
  "rollup": {
    "work_unit_count": 3,
    "work_status_counts": { "completed": 3 },
    "review_item_counts": { "blocker": 5 },
    "learning_candidate_count": 2,
    "learning_candidate_counts": { "blocker": 2 },
    "high_priority_learning_candidate_count": 2,
    "top_tags": [{ "tag": "openclaw", "count": 1 }],
    "changed_files": [],
    "failed_command_count": 15,
    "successful_check_count": 0
  },
  "cursor": "fastapi-review-state:..."
}
```

OpenClaw must treat FastAPI as source of truth for draft state, decisions, local evidence, and memory promotion. OpenClaw can rank, summarize, ask the user, queue commands, publish accepted payloads, and maintain run status.

---

## OpenClaw Responsibilities

### 1. Durable Review Run Store

OpenClaw must persist one run per `session_key`.

Minimum run fields:

```json
{
  "session_key": "codex-review-daily:2026-06-15",
  "date": "2026-06-15",
  "workspace_id": "mmd-companion",
  "status": "awaiting_snapshot",
  "snapshot_cursor": null,
  "snapshot_received_at": null,
  "last_user_prompt_at": null,
  "last_command_cursor": null,
  "last_publish_cursor": null,
  "error": null
}
```

Allowed statuses:

```text
awaiting_snapshot
snapshot_received
no_drafts
needs_user_review
commands_queued
awaiting_fastapi_results
awaiting_memory_payloads
publishing_memory
published
failed
```

Status rules:

- `awaiting_snapshot`: cron created/resumed run, no valid snapshot yet.
- `snapshot_received`: snapshot stored and cursor changed.
- `no_drafts`: `summary.draft_count == 0` and `learning_candidates` empty.
- `needs_user_review`: candidates exist and user has not confirmed/ignored enough items.
- `commands_queued`: OpenClaw queued at least one command for FastAPI.
- `awaiting_fastapi_results`: commands are pending result.
- `awaiting_memory_payloads`: FastAPI accepted command result but memory payload has not arrived.
- `publishing_memory`: OpenClaw is applying wiki payloads.
- `published`: all accepted payloads published or no accepted payloads were needed.
- `failed`: terminal failure requiring user attention.

### 2. Snapshot Ingestion

Endpoint:

```http
POST /v1/apps/mmd/codex-review/runs/{session_key}/snapshot
```

Behavior:

1. Authenticate service token.
2. Validate `kind=codex_review_daily_snapshot` and `schema_version=1`.
3. Persist raw snapshot JSON for audit.
4. Persist latest `cursor`, `summary`, `rollup`, `drafts`, `work_units`, and `learning_candidates`.
5. If cursor did not change, return idempotent success.
6. If `learning_candidates` is non-empty, set `status=needs_user_review`.
7. Else if `drafts` is non-empty, set `status=needs_user_review`.
8. Else set `status=no_drafts`.

Response:

```json
{
  "status": "snapshot_received",
  "session_key": "codex-review-daily:2026-06-15",
  "snapshot_cursor": "fastapi-review-state:...",
  "run_status": "needs_user_review"
}
```

### 3. User Review Conversation

Daily cron should create/resume the run, then wait for the FastAPI snapshot.

When snapshot arrives, OpenClaw should summarize in this order:

1. `rollup`: high-level day/project state.
2. `work_units`: concise work summary per Codex session.
3. `learning_candidates`: top 1-3 items asking for user confirmation.
4. `drafts`: fallback when candidates are missing or user asks for raw queue.

Suggested user-facing structure:

```text
今天 Codex review 收到 {work_unit_count} 个工作单元，
其中 {high_priority_learning_candidate_count} 条高优先级经验候选。

主要主题：{top_tags}
失败命令：{failed_command_count}
成功检查：{successful_check_count}

建议确认这几条：
1. ...
2. ...
3. ...
```

OpenClaw should not show large raw evidence by default. It may show `bounded_evidence` excerpts already present in the snapshot. If more evidence is needed, queue `request_evidence` for FastAPI.

### 3A. Knowledge Draft Generation

OpenClaw must not treat a review draft as the final long-term knowledge entry.

`drafts` and `learning_candidates` are review-time inputs. When a candidate is
worth preserving, OpenClaw must generate a second-layer structured artifact
called `knowledge_draft`.

OpenClaw should generate a `knowledge_draft` only when at least one of these is
true:

1. candidate type is `pitfall`, `decision`, or `blocker`,
2. `priority_score >= 80`,
3. `problem`, `fix`, or `prevention` is non-empty,
4. `bounded_evidence` is present,
5. the user explicitly asks to preserve the item as reusable knowledge.

Input precedence for generation:

1. `learning_candidates[*]`
2. `drafts[*]`
3. `work_units[*]`
4. `rollup`
5. user edits made during the OpenClaw review conversation

Field precedence within a candidate:

1. `problem`
2. `root_cause`
3. `fix`
4. `prevention`
5. `lesson`
6. `summary`
7. `bounded_evidence`
8. `evidence_refs`

Required `knowledge_draft` shape:

```json
{
  "kind": "codex_review_knowledge_draft",
  "schema_version": 1,
  "source": {
    "review_item_id": "codex_review_...",
    "candidate_type": "pitfall",
    "pet_session_id": "codex:...",
    "codex_session_id": "...",
    "workspace_id": "mmd-companion",
    "evidence_refs": ["event_turn_failed_1"]
  },
  "article": {
    "knowledge_kind": "pitfall",
    "title": "...",
    "problem": "...",
    "root_cause": "...",
    "when_to_use": "...",
    "prerequisites": [],
    "steps": [
      {
        "order": 1,
        "instruction": "...",
        "commands": [],
        "file_refs": [],
        "evidence_refs": ["event_turn_failed_1"]
      }
    ],
    "verification": [
      {
        "order": 1,
        "instruction": "...",
        "commands": [],
        "expected_signal": "...",
        "evidence_refs": ["event_turn_failed_1"]
      }
    ],
    "cautions": [],
    "source_summary": "...",
    "open_questions": [],
    "confidence": 0.87
  }
}
```

Minimum required article fields:

- `knowledge_kind`
- `title`
- `problem`
- `when_to_use`
- `steps`
- `verification`
- `source_summary`

Content rules:

- user-facing prose must be Simplified Chinese, except commands, file paths,
  API names, enum values, code identifiers, and quoted error fragments;
- `steps` must be imperative and independently executable when possible;
- `verification` must describe observable success criteria, not vague intent;
- OpenClaw must not invent commands, file paths, or checks that are not grounded
  in snapshot data or explicit user edits;
- if evidence is insufficient, OpenClaw should ask for edit or mark
  `open_questions` instead of fabricating detail.

OpenClaw should present the generated draft in this order:

1. `title`
2. `problem`
3. `root_cause`
4. `when_to_use`
5. `steps`
6. `verification`
7. `cautions`

This keeps the conversation focused on reusable procedure, not only summary
acceptance.

### 4. Ranking Rules

Default ranking:

1. `learning_candidates` before raw `drafts`.
2. Higher `priority_score` first.
3. Candidate types: `blocker`, `pitfall`, `decision`, `followup`, `work_summary`.
4. Prefer candidates with non-empty `problem`, `fix`, `prevention`, or `lesson`.
5. De-prioritize title-only or evidence-empty drafts.

OpenClaw may show at most `summary.recommended_batch_size` items at a time, usually 1-3.

### 5. Command Queue

FastAPI polls:

```http
GET /v1/apps/mmd/codex-review/runs/{session_key}/commands?cursor=...
```

OpenClaw returns durable commands:

```json
{
  "commands": [
    {
      "id": "openclaw_review_cmd_...",
      "session_key": "codex-review-daily:2026-06-15",
      "type": "review_decision",
      "item_id": "codex_review_...",
      "action": "accept",
      "target": "openclaw_wiki",
      "edited_title": null,
      "edited_summary": null,
      "memory_draft": null,
      "notes": "Confirmed by user in OpenClaw daily review.",
      "snooze_until": null,
      "decided_by": "admin-1",
      "decided_at": "2026-06-15T22:35:00+08:00"
    }
  ],
  "cursor": "openclaw-command-cursor:..."
}
```

Supported command types:

```text
review_decision
request_evidence
refresh_snapshot
cancel_run
```

`review_decision.action` values:

```text
accept
edit_accept
ignore
snooze
```

`review_decision` compatibility rules:

- `edited_title` and `edited_summary` remain supported for backwards
  compatibility.
- `memory_draft` is the preferred structured payload when the user is accepting
  knowledge content rather than only a summary.
- OpenClaw may send plain `accept` / `edit_accept` without `memory_draft` as a
  temporary fallback, but this is not sufficient for full-fidelity knowledge
  preservation.

Preferred `memory_draft` contract:

```json
{
  "knowledge_kind": "pitfall",
  "problem": "...",
  "root_cause": "...",
  "when_to_use": "...",
  "prerequisites": [],
  "steps": [
    {
      "order": 1,
      "instruction": "...",
      "commands": [],
      "file_refs": [],
      "evidence_refs": []
    }
  ],
  "verification": [
    {
      "order": 1,
      "instruction": "...",
      "commands": [],
      "expected_signal": "...",
      "evidence_refs": []
    }
  ],
  "cautions": [],
  "source_summary": "...",
  "open_questions": [],
  "confidence": 0.87
}
```

Validation rules:

- `knowledge_kind`, `problem`, `when_to_use`, `steps`, `verification`, and
  `source_summary` are required;
- `steps` and `verification` must each contain at least one item;
- `order` values must start at 1 and be strictly increasing within each list;
- `commands`, `file_refs`, `evidence_refs`, `prerequisites`, `cautions`, and
  `open_questions` must be arrays;
- `confidence`, when present, must be numeric and bounded to `0..1`;
- unknown extra fields may be preserved for forward compatibility but must not
  replace required fields.

Queue rules:

- Commands are append-only.
- A command id is globally unique.
- Replaying the same command must be idempotent.
- Do not queue duplicate active commands for the same `item_id`.
- Store `created_at`, `claimed_at`, `result_at`, and `status`.

### 6. Command Results

FastAPI posts:

```http
POST /v1/apps/mmd/codex-review/commands/{command_id}/result
```

Result shape:

```json
{
  "session_key": "codex-review-daily:2026-06-15",
  "command_id": "openclaw_review_cmd_...",
  "status": "succeeded",
  "result": {
    "item_id": "codex_review_...",
    "item_status": "accepted",
    "memory_id": "codex_review_memory_..."
  },
  "error": null,
  "completed_at": "2026-06-15T22:36:00+08:00"
}
```

On success:

- Mark command `succeeded`.
- If action accepted memory, set run `awaiting_memory_payloads`.
- If action ignored/snoozed, update dashboard and wait for remaining decisions.

For accepted memory, OpenClaw should expect FastAPI to persist any supplied
`memory_draft` into local memory state and later reflect the same structured
content in pushed memory wiki payloads.

On failure:

- Mark command `failed`.
- Set run `failed` only if failure blocks review.
- Notify user with error and current item state.

### 7. Memory Payload Ingestion

FastAPI pushes accepted wiki payloads:

```http
POST /v1/apps/mmd/codex-review/runs/{session_key}/memory-payloads
```

Payload:

```json
{
  "payloads": [
    {
      "kind": "codex_review_memory_wiki_payload",
      "schema_version": 1,
      "memory": {
        "id": "codex_review_memory_...",
        "workspace_id": "mmd-companion",
        "memory_type": "pitfall",
        "title": "...",
        "body": "...",
        "details": {
          "knowledge_kind": "pitfall",
          "problem": "...",
          "root_cause": "...",
          "when_to_use": "...",
          "prerequisites": [],
          "steps": [],
          "verification": [],
          "cautions": [],
          "source_summary": "...",
          "open_questions": [],
          "confidence": 0.87
        }
      },
      "wiki": {
        "path": "sources/codex-review/mmd-companion/2026-06-15/codex_review_memory_....md",
        "frontmatter": {},
        "markdown": "---\n...\n---\n..."
      },
      "evidence": [],
      "provenance": {}
    }
  ]
}
```

OpenClaw must:

1. Validate schema.
2. Persist raw payload for audit.
3. Ensure payload is for the run/workspace expected.
4. Move run to `publishing_memory`.
5. Apply wiki payloads only after validation.

Validation expectations for accepted memory payloads:

- `memory.details` should preserve the accepted structured `memory_draft` when
  one was supplied in the decision command;
- `wiki.markdown` should render actionable sections, not only one free-form
  summary paragraph;
- OpenClaw may reject or hold publication if the accepted payload drops required
  operational sections such as `steps` or `verification`.

### 8. Memory Wiki Publish

For each payload:

1. Apply markdown only to generated codex-review wiki paths.
2. Run `wiki_lint`.
3. Update dashboard/daily note.
4. Run `git status --porcelain`.
5. If unrelated dirty files exist, stop and notify user.
6. `git add` generated wiki paths only.
7. Commit at most once per day:

```text
codex review memory: YYYY-MM-DD
```

8. `git push`.
9. Record publish result.

Never merge, rebase, reset, stash, or discard unrelated vault changes automatically.

### 9. Publish Status

FastAPI polls:

```http
GET /v1/apps/mmd/codex-review/runs/{session_key}/publish-status?cursor=...
```

Response:

```json
{
  "session_key": "codex-review-daily:2026-06-15",
  "cursor": "openclaw-publish-cursor:...",
  "status": "published",
  "items": [
    {
      "memory_id": "codex_review_memory_...",
      "status": "published",
      "wiki_path": "sources/codex-review/mmd-companion/2026-06-15/...",
      "commit": "abc1234",
      "error": null,
      "updated_at": "2026-06-15T22:40:00+08:00"
    }
  ]
}
```

Allowed item statuses:

```text
pending
publishing
published
failed
skipped
```

### 10. Backfill

OpenClaw should support manual backfill for dates that stayed `awaiting_snapshot`, such as `2026-06-14`.

Minimum behavior:

- Create/resume `codex-review-daily:YYYY-MM-DD`.
- Mark `awaiting_snapshot`.
- Optionally queue `refresh_snapshot`.
- Do not fabricate snapshot data.
- If no FastAPI snapshot arrives, report stale/missing snapshot.

### 11. Security Boundary

OpenClaw must not:

- Access local FastAPI URLs directly.
- Read Codex JSONL, project files, diff files, or local paths.
- Execute shell/Codex/patch/approval locally for MMD project.
- Publish draft/unconfirmed content to memory-wiki.
- Store secrets from bounded evidence.
- Auto-resolve git conflicts or unrelated dirty vault files.

OpenClaw may:

- Persist FastAPI-provided bounded snapshot fields.
- Ask user to confirm/edit/ignore/snooze candidates.
- Queue commands for FastAPI to apply locally.
- Publish FastAPI-provided confirmed wiki payloads.

### 12. Acceptance Criteria

OpenClaw-side work is complete when:

- Daily cron creates/resumes `codex-review-daily:YYYY-MM-DD`.
- Snapshot endpoint accepts `drafts`, `work_units`, `learning_candidates`, and `rollup`.
- A snapshot with candidates moves run to `needs_user_review`.
- A snapshot with no drafts/candidates moves run to `no_drafts`.
- User confirmation queues a durable `review_decision` command.
- High-value learning candidates can be turned into structured
  `knowledge_draft` artifacts before final confirmation.
- Preferred `review_decision` commands can carry `memory_draft`.
- FastAPI can poll commands and post command results.
- Accepted command results wait for FastAPI memory payload.
- Accepted memory payloads can preserve structured actionable knowledge, not
  only a review summary body.
- Memory payload endpoint validates and persists accepted payloads.
- Wiki apply/lint/dashboard/git commit/git push run with generated paths only.
- Publish status is pollable by FastAPI.
- Failures notify the user and do not mutate unrelated vault state.

### 13. Suggested Implementation Order

1. Snapshot ingestion store/status update.
2. Daily cron conversation using `rollup`, `work_units`, and `learning_candidates`.
3. Command queue endpoints.
4. Command result endpoint.
5. Memory payload endpoint.
6. Wiki apply/lint/dashboard/git publish.
7. Publish status endpoint.
8. Backfill command for stale dates.
