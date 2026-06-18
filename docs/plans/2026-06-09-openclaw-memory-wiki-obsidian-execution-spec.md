# OpenClaw Memory Wiki + Obsidian Execution Spec

Date: 2026-06-09

## Purpose

This spec defines what OpenClaw must execute when the chosen long-term memory target is the bundled `memory-wiki` plugin with a Git-synced, Obsidian-friendly vault.

The key idea is:

```text
FastAPI = local facts, review decisions, audit, memory promotion
OpenClaw = scheduled orchestration, structured synthesis, wiki publication
memory-wiki = durable knowledge vault + compile/search/get/apply/lint
Obsidian = human-facing vault UI
Git remote = cross-device sync and review history
```

This is the target execution spec. It supersedes the earlier OpenKB target for this branch of the design. OpenKB-compatible Markdown export can remain as a fallback adapter, but OpenClaw memory-wiki is the primary target.

References:

- OpenClaw memory-wiki docs: https://docs.openclaw.ai/plugins/memory-wiki
- OpenClaw wiki CLI docs: https://docs.openclaw.ai/cli/wiki

## Selected Mode

Use:

```json5
{
  "plugins": {
    "entries": {
      "memory-wiki": {
        "enabled": true,
        "config": {
          "vaultMode": "isolated",
          "vault": {
            "path": "D:/Obsidian/OpenClaw Wiki",
            "renderMode": "obsidian"
          },
          "obsidian": {
            "enabled": true,
            "useOfficialCli": true,
            "vaultName": "OpenClaw Wiki",
            "openAfterWrites": false
          },
          "bridge": {
            "enabled": false,
            "readMemoryArtifacts": true,
            "indexDreamReports": true,
            "indexDailyNotes": true,
            "indexMemoryRoot": true,
            "followMemoryEvents": true
          },
          "ingest": {
            "autoCompile": true,
            "maxConcurrentJobs": 1,
            "allowUrlIngest": true
          },
          "search": {
            "backend": "shared",
            "corpus": "wiki"
          },
          "render": {
            "preserveHumanBlocks": true,
            "createBacklinks": true,
            "createDashboards": true
          }
        }
      }
    }
  }
}
```

Reasoning:

- `isolated` keeps the wiki self-contained and portable.
- Obsidian render mode gives a human-editable vault.
- The vault path is a Git repository with a configured remote.
- Bridge mode stays off for v1 because FastAPI already owns source facts.
- `autoCompile` lets OpenClaw publish deterministic pages and dashboards after updates.

## What OpenClaw Must Execute

OpenClaw owns the control loop, not raw storage. It must not require inbound
HTTP access to the local FastAPI service. The production cross-machine link is
FastAPI outbound to OpenClaw.

1. Run the daily review cron.
2. Create or resume the daily review run and wait for FastAPI's outbound snapshot.
3. Rank items and ask the user to confirm 1 to 3 items at a time.
4. Queue user decisions for FastAPI to pull and apply locally.
5. Receive accepted memory wiki payloads pushed by FastAPI.
6. Publish the accepted memory into the memory-wiki vault.
7. Compile, lint, and refresh dashboards.
8. Commit the day's generated wiki changes once.
9. Push the daily commit to the vault remote.
10. Make the updated pages available in Obsidian.

OpenClaw must not:

- write unconfirmed draft content into the wiki,
- bypass FastAPI for decision state,
- read raw local Codex transcripts,
- treat the wiki as the source of truth for review decisions,
- keep publishing if lint or provenance checks fail.

## Required Runtime Calls

### OpenClaw Review Sync API

OpenClaw must expose a durable review sync interface that FastAPI calls
outbound. Suggested HTTP shape:

- `POST /v1/apps/mmd/codex-review/runs/{session_key}/snapshot`
- `GET /v1/apps/mmd/codex-review/runs/{session_key}/commands?cursor=...`
- `POST /v1/apps/mmd/codex-review/commands/{command_id}/result`
- `POST /v1/apps/mmd/codex-review/runs/{session_key}/memory-payloads`
- `GET /v1/apps/mmd/codex-review/runs/{session_key}/publish-status?cursor=...`

The exact OpenClaw route names can change, but the direction must not: FastAPI
initiates every network connection to OpenClaw. OpenClaw stores review runs,
decision commands, publish status, and user-facing conversation state.

### Local FastAPI APIs

FastAPI may continue to expose these local APIs for Web/Pet/manual tools and
for its own worker implementation:

- `GET /codex/reviews/daily-summary`
- `GET /codex/reviews/drafts`
- `POST /codex/reviews/items/{item_id}/decision`
- `GET /codex/reviews/memory/{memory_id}/wiki-payload`

They are not a remote dependency for OpenClaw. In production, FastAPI calls
these services internally and then pushes the resulting snapshot, decision
result, or wiki payload to OpenClaw.

### memory-wiki

OpenClaw must use:

- `wiki_status`
- `wiki_search`
- `wiki_get`
- `wiki_apply`
- `wiki_lint`

Optional operational commands:

- `openclaw wiki status`
- `openclaw wiki search`
- `openclaw wiki get`
- `openclaw wiki apply`
- `openclaw wiki lint`
- `openclaw wiki obsidian status`
- `openclaw wiki obsidian daily`
- `git status --porcelain`
- `git add <generated wiki paths>`
- `git commit -m "codex review memory: YYYY-MM-DD"`
- `git push`

## Execution Flow

### 1. Cron Start

At the configured daily time, OpenClaw should:

1. call `wiki_status`,
2. create or resume `session_key=codex-review-daily:YYYY-MM-DD`,
3. mark the run `awaiting_snapshot`,
4. start or update the review conversation once a FastAPI snapshot arrives.

OpenClaw should not call the local FastAPI machine directly.

### 2. FastAPI Snapshot Push

The FastAPI outbound worker should:

1. build the daily summary and draft list from local state,
2. call `POST /v1/apps/mmd/codex-review/runs/{session_key}/snapshot`,
3. include bounded item summaries, priority scores, evidence refs, and counts,
4. avoid sending full transcripts, local absolute paths, or secret-like values.

### 3. User Review

For each item:

- `accept` -> OpenClaw queues a decision command with `target=openclaw_wiki`,
- `edit_accept` -> OpenClaw queues edited title/body plus `target=openclaw_wiki`,
- `ignore` -> OpenClaw queues an ignore command,
- `snooze` -> OpenClaw queues a snooze command with `snooze_until`.

FastAPI polls commands, applies each decision locally, and posts a command
result. OpenClaw must treat FastAPI's command result as authoritative.

### 4. Wiki Publish

For accepted memory, OpenClaw must:

1. wait for FastAPI to push the `codex_review_memory_wiki_payload`,
2. write a source page into the wiki vault,
3. attach claims and evidence refs from the payload,
4. add provenance and confirmation metadata,
5. compile the vault,
6. lint the updated pages,
7. update dashboards / daily note,
8. expose publish status for FastAPI to poll.

### 5. Git Sync

After all accepted memories in the daily batch are published and linted, OpenClaw must:

1. run `git status --porcelain` in the vault,
2. stage only memory-wiki generated paths,
3. create one daily commit with message `codex review memory: YYYY-MM-DD`,
4. run `git push`.

If the vault has unrelated dirty files, push is rejected, or any conflict occurs, OpenClaw must stop and notify the user. It must not run automatic merge, rebase, reset, or conflict resolution.

### 6. Obsidian Surface

After a successful publish and push:

- keep the vault readable in Obsidian,
- optionally open the updated page or daily note,
- do not auto-open on every write.

## FastAPI Wiki Payload Contract

FastAPI creates the canonical payload after it applies an `accept` or
`edit_accept` decision locally. It may render the payload through the existing
local route, but the cross-machine delivery is a FastAPI outbound push to
OpenClaw.

```http
POST /v1/apps/mmd/codex-review/runs/{session_key}/memory-payloads
Authorization: Bearer <fastapi-service-token>
Content-Type: application/json
```

Response shape:

```json
{
  "kind": "codex_review_memory_wiki_payload",
  "schema_version": 1,
  "memory": {
    "id": "codex_review_memory_...",
    "workspace_id": "mmd-companion",
    "memory_type": "pitfall",
    "title": "...",
    "body": "...",
    "tags": ["codex", "review"],
    "evidence_refs": ["event_turn_failed_1"],
    "source_review_item_id": "codex_review_item_...",
    "confirmed_by": "admin-1",
    "confirmed_at": "...",
    "current_version": 1
  },
  "wiki": {
    "path": "sources/codex-review/mmd-companion/YYYY-MM-DD/codex_review_memory_....md",
    "frontmatter": {},
    "markdown": "---\n..."
  },
  "evidence": [],
  "provenance": {}
}
```

FastAPI redacts secret-like values and returns bounded evidence excerpts only.

## Page Layout

Recommended vault structure:

```text
sources/codex-review/
  {workspace_id}/
    {yyyy-mm-dd}/
      {memory_id}.md

syntheses/
  codex-review/
    daily/{yyyy-mm-dd}.md

reports/
  codex-review/
    dashboard.md
```

The source page should be append-only and deterministic.

## Page Contract

Each accepted memory page should carry:

```yaml
---
id: codex-review-memory-...
workspace_id: mmd-companion
memory_type: pitfall
source_review_item_id: ...
pet_session_id: ...
codex_session_id: ...
confirmed_by: admin-1
confirmed_at: 2026-06-09T...
version: 1
status: accepted
tags: [codex, review]
evidence_refs: [...]
---
```

The body should contain:

- the confirmed title,
- the confirmed summary/body,
- bounded evidence excerpts,
- backlinks to related pages when available.

## Search And Retrieval Rules

OpenClaw should use `wiki_search` / `wiki_get` for:

- recalling prior accepted memories,
- checking for duplicate or contradictory claims,
- finding related review pages before creating a new synthesis.

OpenClaw should not search by raw transcript text when a structured claim or source id exists.

## Lint And Publish Rules

Before a page is considered published:

1. `wiki_apply` must succeed.
2. `wiki_lint` must report no blocking provenance gaps.
3. The page must not contain full transcript dumps.
4. The page must preserve human-authored blocks.
5. Dashboards must be refreshed after page updates.

If lint fails, OpenClaw should stop publishing and keep the page in a staging state.

## Failure Handling

| Failure | Behavior |
| --- | --- |
| FastAPI snapshot missing or stale | Keep the prior vault intact, tell the user OpenClaw is waiting for local MMD/FastAPI sync, and retry later. |
| FastAPI command result rejects change | Show the user the current item state and stop. |
| memory-wiki compile fails | Do not mark the page published. |
| `wiki_lint` fails | Block publication until corrected. |
| Obsidian CLI missing | Continue in native wiki mode; do not block the vault write. |
| Duplicate accepted memory | Reuse the same source id / memory id; do not create a second source page. |
| Unrelated dirty vault files | Stop before staging; notify the user. |
| `git push` rejected | Stop; do not merge or rebase automatically. |

## OpenClaw Acceptance Criteria

OpenClaw is done when all of these are true:

- daily cron starts from OpenClaw,
- FastAPI initiates all cross-machine review sync network calls outbound,
- FastAPI remains the source of truth for decisions,
- accepted memory is published into the memory-wiki vault,
- the vault compiles and lints cleanly,
- Obsidian can open and browse the published pages,
- one daily commit is created and pushed,
- no unconfirmed draft content leaks into the wiki.

## Notes

- Keep `memory-wiki` in `isolated` mode unless we explicitly decide to bridge into a separate active-memory plugin later.
- Use `bridge` only if the wiki must ingest public memory artifacts from another plugin.
- `unsafe-local` is intentionally excluded from the v1 execution path.
