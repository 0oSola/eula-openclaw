# OpenClaw Control Plane Codex Review Memory Spec

Date: 2026-06-08

## Landed Summary

This spec captures the agreed architecture for coordinating `desktop-pet`, Codex, FastAPI, OpenClaw, and OpenKB.

Update 2026-06-09: the primary long-term target is now OpenClaw `memory-wiki` writing a Git-synced Obsidian-friendly vault. OpenKB-compatible export remains a fallback adapter. The execution contract is `docs/plans/2026-06-09-openclaw-memory-wiki-obsidian-execution-spec.md`.

```text
Pet = local desktop entry and status surface
Codex = engineering execution capability
FastAPI = local adapter, permission boundary, evidence builder, audit source
MMD project = OpenClaw application channel/domain
OpenClaw = system control plane, agent runtime, cron owner, conversation orchestrator
OpenClaw memory-wiki / Obsidian vault = accepted long-term knowledge base
```

The central design decision is that OpenClaw is not "just the LLM gateway". The MMD project is an OpenClaw application channel/domain. OpenClaw can use model backends for reasoning and text generation inside that channel, and can request controlled tools such as Codex through a FastAPI outbound worker.

FastAPI remains the local boundary for anything that touches this workstation: Codex app-server, local files, session JSONL, artifacts, approvals, checks, evidence packs, audit rows, and memory promotion. OpenClaw `memory-wiki` stores only user-confirmed long-term memory. Codex and OpenClaw should not write unconfirmed draft content into the wiki.

Update 2026-06-11: the OpenClaw/FastAPI network direction is FastAPI outbound to OpenClaw. OpenClaw should not require direct inbound access to the local FastAPI host.

## Goals

1. Let OpenClaw orchestrate the MMD project as a first-class application channel, including Codex-related engineering work.
2. Let desktop-pet keep acting as a lightweight local interaction and status surface.
3. Keep FastAPI as the controlled local adapter for Codex execution, evidence extraction, approval handling, audit, and memory promotion.
4. Let OpenClaw run a daily review cron that aligns with the user on Codex work summaries, pitfalls, decisions, blockers, and followups.
5. Persist accepted memories into OpenClaw `memory-wiki` / Obsidian Git vault after user confirmation.
6. Preserve a clear chain of custody from raw Codex events to evidence pack to OpenClaw draft to user-confirmed memory.

## Non-Goals

1. OpenClaw does not directly read local Codex JSONL files.
2. OpenClaw does not directly run local shell commands or apply patches outside FastAPI/Codex tool APIs.
3. Codex does not directly write OpenClaw memory-wiki or OpenKB.
4. Draft review items are not long-term memory.
5. memory-wiki/OpenKB is not the review approval workflow system.
6. The first implementation does not need to replace existing FastAPI-owned Codex app-server integration.

## System Roles

### OpenClaw

OpenClaw is the control plane. It owns scheduled review conversations, decides when tools are needed, routes the MMD project channel across model backends, Codex tools, knowledge services, and user surfaces, and maintains the conversational context for review alignment.

OpenClaw should expose durable review/tool command queues for FastAPI to poll
outbound. Through those queues, OpenClaw can request:

- list pending review drafts,
- start or continue Codex tool sessions,
- retrieve bounded evidence,
- send user decisions,
- request memory export/sync status,
- query local runtime health when needed.

OpenClaw can query memory-wiki/OpenKB for accepted memory, but it must not bypass FastAPI to promote new memory unless the memory is already confirmed and the adapter contract explicitly allows it.

### FastAPI

FastAPI is the local adapter and source of audit truth. It owns local trust boundaries and durable workflow state:

- `desktop_pet_sessions`
- `codex_events`
- `codex_artifacts`
- `codex_approvals`
- `codex_openclaw_sync_outbox`
- `codex_review_items`
- `codex_review_memory`
- `codex_review_memory_versions`
- memory export/sync state

FastAPI exposes local tool APIs to browser/desktop clients and runs outbound workers that connect to OpenClaw. It validates requester identity for local calls, authenticates to OpenClaw for outbound sync, redacts sensitive material, truncates payloads, translates local paths to safe paths, and persists all state transitions.

### Codex

Codex is an engineering tool capability. It executes read-only or patch sessions through the existing FastAPI `CodexInteractiveProvider` / app-server integration. It emits events, artifacts, approvals, checks, diffs, and apply results. Codex does not manage long-term knowledge and does not speak to OpenKB directly.

### Pet

Pet is a local desktop UI. It can:

- show Codex status,
- scan local Codex JSONL for bounded facts,
- send prompts through FastAPI relay or VSCode fallback,
- expose approval affordances when FastAPI relay provides approval IDs,
- upsert metadata to FastAPI.

Pet is not the global orchestrator. It should not call memory-wiki/OpenKB directly and should not own memory state transitions.

### OpenClaw memory-wiki / OpenKB Fallback

OpenClaw `memory-wiki` is the primary accepted knowledge base. It stores user-confirmed memory in a Git-synced, Obsidian-friendly vault. OpenKB-compatible Markdown export remains a fallback adapter. Both are optimized for retrieval, cross-linking, and review after confirmation, not for draft approval.

## Target Topology

```text
User / Feishu / Web / Pet
  -> OpenClaw control plane
     -> MMD project channel/domain
        -> model backend for reasoning/generation
        -> Codex tool command queue
        -> knowledge service via memory-wiki
        -> MMD/local adapter commands

FastAPI outbound workers
  -> OpenClaw review/tool command queues
  -> OpenClaw /v1/responses for draft synthesis

FastAPI local adapter
  -> Codex app-server / Codex CLI
  -> SQLite audit state
  -> evidence packs
  -> review drafts
  -> memory promotion

OpenClaw
  -> memory-wiki / Obsidian Git vault
     -> accepted review_memory only
```

## Data Classes

### Evidence Pack

`codex_review_evidence_pack` is deterministic local evidence. It is built by FastAPI from:

- `desktop_pet_sessions.metadata.facts`
- Codex lifecycle events
- Codex artifacts such as diff/checks/apply
- pending/resolved approvals
- session metadata and bounded summaries

Evidence packs are redacted and truncated. They are inputs to OpenClaw draft generation, not user-confirmed memory.

### Draft Review Item

`codex_review_items` stores OpenClaw-generated drafts. Item types:

- `work_summary`
- `pitfall`
- `decision`
- `followup`
- `blocker`

Draft review items may be regenerated or superseded. They must keep source hashes and evidence refs for dedupe and traceability.

### Review Memory

`codex_review_memory` stores only accepted or edited-and-accepted content. It should not be overwritten by rerunning OpenClaw draft generation.

Implemented fields:

```text
id
workspace_id
source_review_item_id
pet_session_id
codex_session_id
memory_type
title
body
tags_json
evidence_refs_json
source_hash
created_by
confirmed_by
confirmed_at
current_version
export_status
openkb_document_id
export_error
created_at
updated_at
```

`codex_review_memory_versions` stores append-only edits. Version 1 is created with the initial accepted memory. Later edits increment `current_version` and reset export status to `pending`.

### OpenKB Document

The first OpenKB export format should be Markdown with frontmatter. It can later be pushed to OpenKB through a CLI/API adapter.

```yaml
---
id: codex-review-memory-...
type: pitfall
status: accepted
source: codex
pet_session_id: codex:...
codex_session_id: ...
source_review_item_id: ...
evidence_refs: [...]
tags: [codex, openclaw, review]
confirmed_at: 2026-06-08T...
---
```

## Main Flows

### Flow 1: Codex Execution Through OpenClaw

```text
User asks OpenClaw to do engineering work
  -> OpenClaw decides Codex is needed
  -> OpenClaw queues a Codex tool command
  -> FastAPI outbound worker polls and claims the command
  -> FastAPI starts/resumes Codex app-server session
  -> Codex emits events/artifacts/approvals/checks
  -> FastAPI persists audit state
  -> FastAPI posts bounded tool status/results to OpenClaw
  -> OpenClaw explains progress or asks user for approval
  -> Pet/Web surfaces status as needed
```

OpenClaw may orchestrate the work, but FastAPI owns local Codex permissions, sandbox selection, approval dispatch, artifact storage, and apply gates.

### Flow 2: Pet Session Fact Sync

```text
Pet scans CODEX_HOME/sessions/**/rollout-*.jsonl
  -> extracts bounded facts
  -> POST /desktop-pet/sessions
  -> FastAPI stores metadata-only desktop_pet_sessions row
  -> FastAPI enqueues review sync for review-worthy statuses
```

The Pet payload must never include full transcripts. It should include only bounded facts such as failed commands, changed files, approval titles, error excerpts, event counts, last output preview, and session status.

### Flow 3: Draft Generation

```text
FastAPI pending outbox
  -> build evidence_pack
  -> call OpenClaw codex-manager agent
  -> OpenClaw uses its model backend to return structured JSON for the MMD channel
  -> FastAPI validates top-level contract
  -> FastAPI saves codex_review_items(status=draft)
```

OpenClaw is allowed to summarize and classify. It is not allowed to invent facts or promote memory on its own.

### Flow 4: Daily Review Cron

Preferred shape:

```text
OpenClaw scheduled job
  -> create review_run(status=awaiting_snapshot)
  -> FastAPI outbound worker pushes summary + drafts snapshot
  -> rank pending items
  -> start daily review conversation with user
  -> ask for accept/edit/ignore/snooze decisions
  -> queue review_decision commands
  -> FastAPI outbound worker applies decisions locally
  -> FastAPI pushes command results and accepted wiki payloads
```

Fallback shape if OpenClaw does not yet own cron:

```text
FastAPI scheduler
  -> pushes first daily snapshot to OpenClaw
  -> OpenClaw continues the same review conversation
```

Product language can still call this "OpenClaw review cron" because OpenClaw owns the interaction and decision dialogue.

### Flow 5: Memory Promotion And Wiki Publish

```text
FastAPI receives decision=accept/edit_accept
  -> writes immutable codex_review_memory row
  -> renders bounded wiki payload
  -> pushes payload outbound to OpenClaw
  -> OpenClaw publishes through memory-wiki
  -> OpenClaw exposes publish status for FastAPI to poll

OpenClaw later queries memory-wiki
  -> retrieves accepted memory
  -> uses memory to plan, answer, or call Codex
```

Only accepted memory goes to memory-wiki/OpenKB fallback.

## Local FastAPI API Spec

These routes remain useful for Web/Pet/manual tools and for the FastAPI outbound
worker implementation. OpenClaw should not depend on calling these local URLs
directly across the network.

### List Drafts

```http
GET /codex/reviews/drafts?limit=20&priority=default
x-user-id: <openclaw-service-user>
```

Response:

```json
{
  "items": [
    {
      "id": "codex_review_...",
      "pet_session_id": "codex:...",
      "codex_session_id": "...",
      "item_type": "pitfall",
      "title": "...",
      "summary": "...",
      "severity": "high",
      "tags": ["codex"],
      "status": "draft",
      "evidence_refs": ["event_turn_failed_1"],
      "priority_score": 85,
      "created_at": "..."
    }
  ],
  "limit": 20
}
```

### Decide Review Item

```http
POST /codex/reviews/items/{item_id}/decision
x-user-id: <openclaw-service-user>
```

Request:

```json
{
  "action": "accept",
  "edited_title": null,
  "edited_summary": null,
  "notes": null,
  "snooze_until": null,
  "target": "openclaw_wiki"
}
```

Allowed `action` values:

- `accept`
- `edit_accept`
- `ignore`
- `snooze`

Response:

```json
{
  "item": {"id": "...", "status": "accepted"},
  "memory": {"id": "codex_review_memory_...", "export_status": "pending"}
}
```

### Daily Summary

```http
GET /codex/reviews/daily-summary?workspace_id=mmd-companion&date=2026-06-08
x-user-id: <openclaw-service-user>
```

Response:

```json
{
  "date": "2026-06-08",
  "draft_count": 8,
  "high_priority_count": 3,
  "accepted_today": 2,
  "ignored_today": 1,
  "snoozed_today": 0,
  "recommended_batch_size": 3
}
```

### Memory Wiki Payload

```http
GET /codex/reviews/memory/{memory_id}/wiki-payload
x-user-id: <openclaw-service-user>
```

Returns confirmed title/body, deterministic wiki path, frontmatter, Markdown, bounded evidence, and provenance. This remains a local FastAPI route. In the production cross-machine flow, FastAPI renders the same payload internally and pushes it outbound to OpenClaw for `wiki_apply`.

### Fallback Memory Export

```http
POST /codex/reviews/memory/export
```

Request:

```json
{
  "memory_ids": ["codex_review_memory_..."],
  "target": "openkb",
  "force": false
}
```

FastAPI always writes the Markdown export first. If `target=openkb` and `OPENKB_SYNC_ENABLED=true`, FastAPI calls the OpenKB adapter after the Markdown file exists. A successful OpenKB sync returns `status=synced_openkb` and stores the OpenKB document id in `openkb_document_id`; Markdown-only export returns `status=synced_markdown`.

### OpenClaw Codex Tool Facade

This facade is the local FastAPI implementation of the Codex tool entrypoint. It wraps existing FastAPI Codex interactive behavior and keeps output bounded. In the production cross-machine flow, FastAPI invokes the same local behavior after polling an OpenClaw command; OpenClaw should not call this local URL directly.

```http
POST /openclaw/tools/codex/sessions
x-user-id: <openclaw-service-user>
Content-Type: application/json
```

Request:

```json
{
  "local_chat_session_id": null,
  "workspace_id": "mmd-companion",
  "mode": "read_only",
  "sandbox": null
}
```

Response:

```json
{
  "session_id": "codex_sess_...",
  "workspace_id": "mmd-companion",
  "status": "ready",
  "sandbox": "read-only",
  "worktree_path": null,
  "branch_name": null
}
```

```http
GET /openclaw/tools/codex/sessions/{session_id}/status
x-user-id: <openclaw-service-user>
```

Response contains only bounded fields:

```json
{
  "session_id": "codex_sess_...",
  "workspace_id": "mmd-companion",
  "status": "waiting_approval",
  "last_output_preview": "...",
  "pending_approvals": [{"id": "...", "action_type": "command", "title": "..."}],
  "latest_artifacts": [{"id": "...", "kind": "checks", "summary": "..."}],
  "recent_events": [{"event_type": "command_output", "sequence": 5}]
}
```

The status endpoint does not return full transcript payloads, artifact metadata, full diff/patch content, or local artifact paths.

```http
POST /openclaw/tools/codex/approvals/{approval_id}/decision
x-user-id: <openclaw-service-user>
Content-Type: application/json
```

Request:

```json
{"decision": "approve_once"}
```

Allowed decisions currently match the underlying Codex interactive route: `approve_once` and `deny`.

Response:

```json
{
  "exported": 1,
  "failed": 0,
  "items": [
    {
      "memory_id": "...",
      "target": "openkb",
      "status": "synced",
      "document_ref": "knowledge/codex-review/pitfalls/..."
    }
  ]
}
```

## Review State Machine

```text
draft
  -> accepted
  -> edited_accepted
  -> ignored
  -> snoozed
  -> failed

snoozed
  -> draft
  -> accepted
  -> ignored

accepted / edited_accepted
  -> exported
  -> export_failed
```

`accepted` and `edited_accepted` create `codex_review_memory`. `ignored` never exports. `snoozed` remains reviewable after `snooze_until`.

## Ranking Rules For Daily Review

Default daily batch should avoid flooding the user.

Recommended ranking:

1. `blocker` and `pitfall` from failed sessions.
2. Items with `apply_failed=true`.
3. Items with failed commands.
4. `decision` items.
5. `followup` items older than 3 days.
6. `work_summary` items.

Default daily batch size: 3. Maximum daily interactive items: 10.

## Memory Wiki And Fallback OpenKB Strategy

The primary target is OpenClaw `memory-wiki` with an Obsidian-friendly Git
vault. FastAPI produces deterministic Markdown payloads; OpenClaw writes them
into the vault and owns compile/lint/git push.

The fallback OpenKB export should use Markdown as the canonical export artifact:

```text
knowledge/codex-review/
  sessions/
  pitfalls/
  decisions/
  followups/
  blockers/
```

FastAPI can also write Markdown files under a configured memory export root. A later adapter can call OpenKB CLI/API to add or compile the documents. This keeps the accepted memory portable and auditable even if OpenClaw memory-wiki integration changes.

Recommended env vars:

```env
CODEX_REVIEW_MEMORY_ENABLED=false
CODEX_REVIEW_MEMORY_EXPORT_ROOT=api/data/openkb/codex-review
CODEX_REVIEW_MEMORY_TARGET=openclaw_wiki
OPENKB_BASE_URL=
OPENKB_TOKEN=
OPENKB_SYNC_ENABLED=false
```

## Security And Trust Boundaries

1. FastAPI authenticates outbound calls to OpenClaw with a service identity and scoped token.
2. OpenClaw queues commands; FastAPI validates and applies them locally before changing local state.
3. OpenClaw receives bounded evidence, not raw transcripts.
4. Paths should be workspace-relative when possible.
5. External paths should be collapsed to basename or `[external_path]`.
6. Secret redaction happens before evidence leaves FastAPI.
7. memory-wiki/OpenKB receives accepted memory only.
8. Every decision writes `confirmed_by`, `confirmed_at`, and original `source_review_item_id`.

## Error Handling

OpenClaw draft generation:

- network/timeout/5xx: retry with bounded backoff,
- invalid JSON/schema: mark failed and require manual retry,
- empty response: mark failed,
- partial valid items: save valid items when top-level contract is valid.

Daily review:

- OpenClaw unavailable: drafts remain in FastAPI,
- FastAPI snapshot missing/stale: OpenClaw reports that it is waiting for local MMD/FastAPI sync,
- user says "later": write `snoozed`,
- conflicting duplicate decisions: FastAPI returns current item status and does not create duplicate memory.

memory publish / fallback OpenKB sync:

- sync failure does not undo accepted memory,
- failed exports remain retryable,
- Markdown file is the canonical export fallback.

## Testing Strategy

Backend tests should cover:

- listing draft items by priority,
- accepting a draft creates one memory row,
- edited acceptance stores edited content,
- ignored items do not create memory,
- snoozed items disappear until due,
- duplicate accept does not create duplicate memory,
- Markdown export contains required frontmatter,
- memory-wiki/OpenKB sync failure marks export failed without losing memory,
- FastAPI outbound service auth is enforced.

Integration tests should cover:

- FastAPI outbound worker pushes a daily snapshot, polls OpenClaw decision commands, applies decisions locally, and posts results,
- accepted memory becomes publishable through the memory-wiki payload mock,
- Codex execution remains gated by existing FastAPI approval/sandbox rules.

## Implementation Phases

### Phase 1: FastAPI Review Memory

Add review decision APIs, `codex_review_memory`, Markdown export, and tests. OpenClaw cron can be simulated by manual calls.

### Phase 2: OpenClaw Daily Review Cron

Add OpenClaw scheduled job or FastAPI-trigger fallback, rank snapshot drafts, run daily review conversation, queue decisions, and accept FastAPI command results.

### Phase 3: memory-wiki Publish + OpenKB Fallback

Add memory-wiki publish integration through OpenClaw outbound sync. Keep Markdown export and optional OpenKB adapter as fallback paths.

### Phase 4: OpenClaw-Facing Codex Tool Facade

Expose a cleaner local Codex Tool facade over existing `/codex/interactive/*`, with scoped auth and bounded status responses, then connect it to the OpenClaw command queue through a FastAPI outbound worker.

## Implemented Slice

As of 2026-06-09, FastAPI implements:

- review draft listing, daily summary, decisions, memory creation, append-only versions, wiki payload, Markdown export, and optional OpenKB adapter sync;
- `codex_review_memory` and `codex_review_memory_versions`;
- local Codex session creation, bounded status, and approval decision facade for OpenClaw command execution;
- `x-user-id` admin enforcement for review and OpenClaw tool APIs, plus existing Codex allowlist enforcement for tool session creation.

OpenClaw native cron implementation and memory-wiki Git/Obsidian publication remain outside this repository.

## Open Questions

1. OpenClaw daily review starts with Feishu first; Web can reuse the same FastAPI APIs later.
2. Review memory is workspace-scoped through `workspace_id`.
3. Markdown is the canonical artifact; OpenKB API sync is optional behind `OPENKB_SYNC_ENABLED`.
4. v1 service identity is `x-user-id` matching `ADMIN_USER_IDS`.
5. Accepted memory edits create append-only versions.
