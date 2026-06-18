# Review Decision `memory_draft` Contract Spec

Date: 2026-06-18

## Purpose

This spec defines the protocol extension for carrying a structured knowledge
draft from OpenClaw back to FastAPI during Codex review decisions.

The current `review_decision` contract supports:

- `edited_title`
- `edited_summary`

That is sufficient for summary editing, but not for preserving a reusable
knowledge article with actionable steps and verification.

This spec adds:

- `memory_draft`

to the `review_decision` command payload.

---

## Problem

Without a structured return channel, OpenClaw can only send back one edited
summary string. That loses:

- step ordering,
- per-step commands,
- per-step file refs,
- explicit verification procedure,
- cautions,
- prerequisites,
- open questions,
- structured evidence mapping.

If OpenClaw generates a proper knowledge draft but FastAPI only receives
`edited_summary`, most of the value is discarded at the protocol boundary.

---

## Scope

This contract applies to:

- `GET /v1/apps/mmd/codex-review/runs/{session_key}/commands`
- `type=review_decision`
- actions `accept` and `edit_accept`

It does not change the meaning of:

- `ignore`
- `snooze`
- `request_evidence`
- `refresh_snapshot`
- `cancel_run`

---

## Backward Compatibility

The existing payload remains valid:

```json
{
  "id": "openclaw_review_cmd_1",
  "type": "review_decision",
  "item_id": "codex_review_1",
  "action": "edit_accept",
  "edited_title": "...",
  "edited_summary": "...",
  "target": "openclaw_wiki"
}
```

FastAPI must continue to accept this legacy shape.

However, this legacy shape is now considered:

```text
summary-only compatibility mode
```

It is not the preferred path for actionable memory preservation.

---

## Preferred Command Shape

OpenClaw should send:

```json
{
  "id": "openclaw_review_cmd_1",
  "session_key": "codex-review-daily:2026-06-18",
  "type": "review_decision",
  "item_id": "codex_review_1",
  "action": "edit_accept",
  "target": "openclaw_wiki",
  "edited_title": "Persist Pet 窗口绑定并在启动时恢复",
  "edited_summary": "兼容旧字段的简短摘要",
  "memory_draft": {
    "knowledge_kind": "pitfall",
    "problem": "任务栏有缩略图，但桌面上没有真正可恢复的 Pet 窗口。",
    "root_cause": "session-hwnd 绑定只保存在内存里，Pet 重启后丢失。",
    "when_to_use": "当 restore 只能命中任务栏缩略图或目标 hwnd 已失效时使用。",
    "prerequisites": [
      "可以识别当前 Pet session id",
      "restore 流程可以读取持久化绑定"
    ],
    "steps": [
      {
        "order": 1,
        "instruction": "在 Pet 退出前持久化 session-hwnd 绑定，并在启动时先恢复该映射。",
        "commands": [],
        "file_refs": ["desktop-pet/src/..."],
        "evidence_refs": ["event_restore_failed_1"]
      }
    ],
    "verification": [
      {
        "order": 1,
        "instruction": "重启 Pet 后执行 restore，确认恢复的是实际桌面窗口而不是仅有任务栏缩略图。",
        "commands": [],
        "expected_signal": "桌面窗口可见、可聚焦、缩略图与实际窗口一致。",
        "evidence_refs": ["event_restore_failed_1"]
      }
    ],
    "cautions": [
      "不要跨 session 复用旧 hwnd。"
    ],
    "source_summary": "Persist the session-window binding before Pet restart.",
    "open_questions": [],
    "confidence": 0.87
  },
  "notes": "Confirmed by user in OpenClaw knowledge review.",
  "snooze_until": null,
  "decided_by": "admin-1",
  "decided_at": "2026-06-18T10:15:00+08:00"
}
```

---

## Field Definitions

### Command Level

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | globally unique command id |
| `session_key` | yes | run key, e.g. `codex-review-daily:YYYY-MM-DD` |
| `type` | yes | must be `review_decision` |
| `item_id` | yes | target FastAPI review item id |
| `action` | yes | `accept`, `edit_accept`, `ignore`, `snooze` |
| `target` | yes | currently `openclaw_wiki` |
| `edited_title` | optional | still supported |
| `edited_summary` | optional | still supported |
| `memory_draft` | preferred for `accept`/`edit_accept` | structured knowledge payload |
| `notes` | optional | user or system notes |
| `snooze_until` | required only for `snooze` | unchanged |
| `decided_by` | optional | operator identity |
| `decided_at` | optional | ISO datetime |

### `memory_draft`

| Field | Required | Type |
| --- | --- | --- |
| `knowledge_kind` | yes | string |
| `problem` | yes | string |
| `root_cause` | optional | string |
| `when_to_use` | yes | string |
| `prerequisites` | optional | string[] |
| `steps` | yes | object[] |
| `verification` | yes | object[] |
| `cautions` | optional | string[] |
| `source_summary` | yes | string |
| `open_questions` | optional | string[] |
| `confidence` | optional | number |

### `steps[*]`

| Field | Required | Type |
| --- | --- | --- |
| `order` | yes | integer |
| `instruction` | yes | string |
| `commands` | optional | string[] |
| `file_refs` | optional | string[] |
| `evidence_refs` | optional | string[] |

### `verification[*]`

| Field | Required | Type |
| --- | --- | --- |
| `order` | yes | integer |
| `instruction` | yes | string |
| `commands` | optional | string[] |
| `expected_signal` | optional | string |
| `evidence_refs` | optional | string[] |

---

## Validation Rules

### OpenClaw Must Enforce Before Queueing

For `action in {"accept", "edit_accept"}`:

- if `memory_draft` is present, it must satisfy:
  - `knowledge_kind` non-empty,
  - `problem` non-empty,
  - `when_to_use` non-empty,
  - `source_summary` non-empty,
  - `steps` is a non-empty array,
  - `verification` is a non-empty array,
  - every `steps[*].order` is a positive integer,
  - every `verification[*].order` is a positive integer,
  - `confidence`, if present, is `0 <= confidence <= 1`.

OpenClaw must not queue:

- fabricated commands,
- fabricated file paths,
- empty `memory_draft` placeholders.

### FastAPI Must Enforce On Apply

When `memory_draft` is present:

1. reject malformed payloads with a failed command result,
2. preserve legacy `edited_title` / `edited_summary` behavior when
   `memory_draft` is absent,
3. persist validated `memory_draft` into `codex_review_memory.details_json`,
4. render `codex_review_memory.body` from `memory_draft`,
5. persist the same `details_json` into `codex_review_memory_versions`,
6. include the same structured payload in later memory wiki exports.

FastAPI may normalize:

- missing optional arrays to `[]`,
- blank optional strings to `""`,
- `knowledge_kind` to the accepted review item's `item_type` when omitted in a
  backward-compatibility migration path.

FastAPI should not silently fabricate:

- `steps`,
- `verification`,
- `commands`,
- `file_refs`.

---

## Action Semantics

### `accept`

Allowed shapes:

1. legacy summary-only:

```json
{
  "action": "accept"
}
```

2. preferred structured accept:

```json
{
  "action": "accept",
  "memory_draft": { "...": "..." }
}
```

Meaning:

- item is accepted without necessarily changing title/summary,
- if `memory_draft` exists, FastAPI should persist it as the canonical accepted
  knowledge structure.

### `edit_accept`

Allowed shapes:

1. legacy:

```json
{
  "action": "edit_accept",
  "edited_title": "...",
  "edited_summary": "..."
}
```

2. preferred:

```json
{
  "action": "edit_accept",
  "edited_title": "...",
  "edited_summary": "...",
  "memory_draft": { "...": "..." }
}
```

Meaning:

- user accepted the item with edits,
- `memory_draft` is the structured accepted form,
- `edited_summary` remains as compatibility text and quick summary.

### `ignore`

`memory_draft` must not be present.

### `snooze`

`memory_draft` must not be present.

---

## Command Result Expectations

FastAPI result shape remains:

```json
{
  "session_key": "codex-review-daily:2026-06-18",
  "command_id": "openclaw_review_cmd_1",
  "status": "succeeded",
  "result": {
    "item_id": "codex_review_1",
    "item_status": "accepted",
    "memory_id": "codex_review_memory_1"
  },
  "error": null,
  "completed_at": "2026-06-18T10:16:00+08:00"
}
```

Additional expectation:

- if the command included `memory_draft`, OpenClaw should expect the later
  memory payload pushed by FastAPI to preserve that structure under
  `memory.details`.

---

## Downstream Memory Payload Expectation

After a successful accepted decision with `memory_draft`, the pushed memory wiki
payload should contain:

```json
{
  "memory": {
    "id": "codex_review_memory_1",
    "title": "...",
    "body": "...",
    "details": {
      "knowledge_kind": "pitfall",
      "problem": "...",
      "root_cause": "...",
      "when_to_use": "...",
      "steps": [],
      "verification": []
    }
  }
}
```

If the later payload drops the structured content, OpenClaw should treat that
as a contract regression.

---

## Error Cases

| Case | Required Behavior |
| --- | --- |
| `memory_draft` missing required fields | FastAPI returns failed command result |
| `memory_draft.steps=[]` | reject for structured accept/edit_accept |
| `memory_draft.verification=[]` | reject for structured accept/edit_accept |
| `ignore` with `memory_draft` | reject |
| `snooze` with `memory_draft` | reject |
| malformed `confidence` | reject or normalize only if contract explicitly allows it |
| unknown fields | preserve if harmless, but do not treat them as substitutes for required fields |

---

## Acceptance Criteria

This protocol extension is complete when:

1. OpenClaw can queue `review_decision` commands with `memory_draft`.
2. Legacy summary-only commands still work.
3. FastAPI validates and persists structured `memory_draft`.
4. FastAPI versions `details_json` together with `body`.
5. Later memory wiki payloads preserve the same structured content.
6. `ignore` and `snooze` reject stray structured memory content.

---

## Recommended Rollout

1. Land OpenClaw-side generation schema and conversation UI.
2. Land FastAPI-side `memory_draft` parsing and persistence.
3. Enable dual-write mode:
   - keep `edited_summary`
   - add `memory_draft`
4. After both sides are stable, treat summary-only accept/edit_accept as
   compatibility mode, not the preferred path.
