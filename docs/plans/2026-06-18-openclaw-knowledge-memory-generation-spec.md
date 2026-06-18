# OpenClaw Knowledge Memory Generation Spec

Date: 2026-06-18

## Purpose

This spec defines the OpenClaw-side content generation work required to turn
FastAPI Codex review candidates into actionable, reusable knowledge memory.

The design goal is explicit:

```text
review draft != long-term knowledge
```

`codex_review_items` remain review-time candidates for discussion and triage.
OpenClaw must generate a second-layer knowledge draft that explains what
happened, when to use the lesson, how to reproduce the fix, and how to verify
it.

This spec is about content generation, not vault publishing mechanics. Vault
publish flow remains covered by:

- `docs/plans/2026-06-15-openclaw-codex-review-consumption-spec.md`
- `docs/plans/2026-06-09-openclaw-memory-wiki-obsidian-execution-spec.md`

---

## Problem Statement

The current OpenClaw review output is optimized for review summaries:

- `work_summary`
- `pitfall`
- `decision`
- `followup`
- `blocker`

This is useful for daily review, but it is not sufficient for a knowledge base.
Typical gaps:

- it says what happened, but not the exact recovery steps;
- it identifies a root cause, but not the validation procedure;
- it points to a lesson, but not the commands, files, or checks needed to apply
  that lesson later;
- it reads like a retrospective note, not like a reusable SOP or runbook.

If OpenClaw continues to generate only review summaries, the wiki becomes a
graveyard of postmortems instead of a usable engineering memory system.

---

## Scope

This spec covers OpenClaw responsibilities for:

1. selecting which review candidates are worth knowledge generation,
2. generating a structured knowledge draft from bounded FastAPI review data,
3. presenting that draft to the user for confirmation,
4. sending the confirmed structured draft back through the FastAPI control-plane
   contract,
5. ensuring the generated content is suitable for memory-wiki publication.

---

## Non-Goals

OpenClaw must not:

- read raw local Codex JSONL files or local project files directly,
- invent evidence that was not present in the FastAPI snapshot,
- write unconfirmed knowledge content into memory-wiki,
- treat the review draft itself as the final knowledge article,
- collapse the knowledge draft back into one free-form summary paragraph.

---

## Source of Truth

FastAPI remains the source of truth for:

- draft state,
- evidence refs,
- bounded evidence excerpts,
- local session metadata,
- accepted memory persistence,
- memory export state.

OpenClaw owns:

- candidate ranking,
- knowledge-draft generation,
- user-facing review conversation,
- confirmation/edit loop,
- publication orchestration after FastAPI confirms local state.

---

## Inputs Available To OpenClaw

OpenClaw receives bounded data from the daily snapshot:

```json
{
  "drafts": [],
  "work_units": [],
  "learning_candidates": [],
  "rollup": {}
}
```

For knowledge generation, OpenClaw should use inputs in this precedence order:

1. `learning_candidates[*]`
2. `drafts[*]`
3. `work_units[*]`
4. `rollup`
5. user edits made during the OpenClaw review conversation

Within a candidate, OpenClaw should trust fields in this precedence order:

1. `problem`
2. `root_cause`
3. `fix`
4. `prevention`
5. `lesson`
6. `summary`
7. `bounded_evidence`
8. `evidence_refs`

OpenClaw must not infer operational detail from unrelated work units or other
candidates unless the relationship is explicit.

---

## Candidate Eligibility Rules

OpenClaw should generate a knowledge draft only when at least one of these is
true:

1. candidate type is `pitfall`, `decision`, or `blocker`,
2. `priority_score >= 80`,
3. `problem`, `fix`, or `prevention` is non-empty,
4. `bounded_evidence` is present,
5. the user explicitly says the item should become reusable knowledge.

OpenClaw should de-prioritize:

- title-only items,
- candidates with no `summary`, `problem`, `fix`, or evidence,
- items whose only value is management reporting,
- items that are obviously one-off without reusable operator value.

Default review order:

1. `blocker`
2. `pitfall`
3. `decision`
4. `followup`
5. `work_summary`

---

## Required OpenClaw Output

OpenClaw must generate a structured artifact called `knowledge_draft`.

Preferred schema:

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
    "title": "Persist pet window binding to disk before restore",
    "problem": "Taskbar thumbnail existed but the real Pet window could not be restored.",
    "root_cause": "The remote window binding lived only in memory and disappeared after restart.",
    "when_to_use": "Use when the Pet shows a stale taskbar thumbnail or restore targets a missing hwnd.",
    "prerequisites": [
      "Pet session id is known",
      "Window restore path can read persisted binding data"
    ],
    "steps": [
      {
        "order": 1,
        "instruction": "Persist the pet-session to hwnd binding before shutdown and reload it on startup.",
        "commands": [],
        "file_refs": ["desktop-pet/src/..."],
        "evidence_refs": ["event_turn_failed_1"]
      }
    ],
    "verification": [
      {
        "order": 1,
        "instruction": "Restart Pet and confirm restore targets a live hwnd instead of only a taskbar thumbnail.",
        "commands": [],
        "expected_signal": "Restored desktop window is visible and focusable.",
        "evidence_refs": ["event_turn_failed_1"]
      }
    ],
    "cautions": [
      "Do not reuse stale hwnd values across sessions."
    ],
    "source_summary": "Persist the session-window binding before Pet restart.",
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

Optional but preferred:

- `root_cause`
- `prerequisites`
- `cautions`
- `open_questions`
- `confidence`

---

## Content Rules

### 1. Output Style

User-facing prose must be Simplified Chinese, except:

- code identifiers,
- commands,
- file paths,
- API names,
- enum values,
- quoted error fragments.

The writing style must be operational, not retrospective.

Good:

- “在 Pet 启动时先恢复持久化 session-hwnd 映射，再执行 restore”
- “验证标准：重启后能在桌面看到窗口，而不只是任务栏缩略图”

Bad:

- “这次我们学到应该更注意窗口状态”
- “建议后续优化恢复逻辑”

### 2. Step Quality

Each item in `steps` must be:

- imperative,
- concrete,
- independently executable,
- limited to one action per step when possible.

OpenClaw should include `commands` only when the command is directly supported
by snapshot evidence. It must not invent shell commands.

### 3. Verification Quality

`verification` must describe observable success criteria, not vague intent.

Good:

- “运行 `pytest api/tests/test_desktop_pet_routes.py -q`，确认 restore 场景通过”
- “重启 Pet 后，桌面窗口可见且任务栏缩略图与实际窗口一致”

Bad:

- “确认应该没问题”
- “检查逻辑是否正常”

### 4. Evidence Discipline

Every non-trivial step or verification item should carry `evidence_refs` when
an evidence ref exists.

If evidence is insufficient, OpenClaw must:

- leave the field empty,
- or add an `open_questions` item,
- or ask the user for confirmation/edit,

but it must not fabricate a missing command, file path, or verification check.

---

## Conversation Flow

OpenClaw should not ask the user only “accept / ignore”.

For each high-value learning candidate, the preferred flow is:

1. summarize the candidate in 1-2 lines,
2. generate a structured `knowledge_draft`,
3. show the user the draft sections,
4. ask whether to:
   - accept as-is,
   - edit before accept,
   - ignore,
   - snooze,
   - request more evidence.

OpenClaw should present the generated draft in this order:

1. `title`
2. `problem`
3. `root_cause`
4. `when_to_use`
5. `steps`
6. `verification`
7. `cautions`

This makes the user review the reusable procedure, not just the summary.

---

## Required Control-Plane Contract Change

Current `review_decision` only supports:

- `edited_title`
- `edited_summary`

That is not sufficient for full-fidelity knowledge generation.

### Compatibility Mode

If OpenClaw uses the current contract only, it may send:

```json
{
  "type": "review_decision",
  "action": "edit_accept",
  "edited_title": "...",
  "edited_summary": "..."
}
```

This is acceptable only as a temporary fallback.

Limitation:

- FastAPI can persist a better title/body, but cannot preserve structured
  `steps`, `verification`, `cautions`, `prerequisites`, or per-step evidence.

### Required Preferred Mode

OpenClaw should send a structured `memory_draft` together with the decision:

```json
{
  "id": "openclaw_review_cmd_...",
  "session_key": "codex-review-daily:2026-06-18",
  "type": "review_decision",
  "item_id": "codex_review_...",
  "action": "edit_accept",
  "target": "openclaw_wiki",
  "edited_title": "Persist Pet 窗口绑定并在启动时恢复",
  "edited_summary": "兼容旧字段的简短摘要",
  "memory_draft": {
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
  },
  "notes": "Confirmed by user in OpenClaw knowledge review."
}
```

FastAPI should then:

1. persist `memory_draft` into `codex_review_memory.details_json`,
2. render `body` from `memory_draft`,
3. version `details_json` in `codex_review_memory_versions`,
4. expose the same structure in memory wiki payloads.

Without this contract extension, OpenClaw content generation cannot be fully
preserved downstream.

---

## Publish Readiness Rules

A generated knowledge draft is publishable only when:

1. `title` is specific,
2. `problem` is concrete,
3. `steps` has at least one actionable item,
4. `verification` has at least one observable check,
5. no field contains fabricated commands or paths,
6. evidence refs are preserved when present.

If a draft fails these rules, OpenClaw should keep it in review conversation
state and ask the user to edit or defer it.

---

## Failure Handling

| Failure | Required Behavior |
| --- | --- |
| Candidate too vague | Do not generate a fake runbook. Keep it as review-only or ask for edit. |
| Missing evidence for steps | Leave steps generic only if still operationally true, otherwise ask for more evidence. |
| No verification signal | Mark `open_questions` and do not auto-publish as strong knowledge. |
| User accepts only summary value | Queue plain `accept` and let FastAPI keep baseline memory, but do not label it full knowledge generation success. |
| Structured draft conflicts with snapshot evidence | Prefer snapshot evidence; ask user to resolve mismatch. |

---

## Acceptance Criteria

OpenClaw-side content generation is complete when all of these are true:

1. OpenClaw consumes `learning_candidates` and ranks them for knowledge value.
2. OpenClaw generates a structured `knowledge_draft`, not only a summary.
3. Generated drafts contain concrete `steps` and `verification` when evidence supports them.
4. Generated drafts preserve `evidence_refs`.
5. User can review the knowledge draft before final acceptance.
6. Preferred contract sends `memory_draft` back to FastAPI with the decision.
7. FastAPI-published wiki payloads can include the structured draft without reconstructing it from one free-form summary.
8. OpenClaw never fabricates commands, paths, or checks that were not grounded in snapshot data or explicit user edits.

---

## Suggested Implementation Order

1. Add OpenClaw-side `knowledge_draft` prompt + JSON schema validation.
2. Add candidate ranking that prefers evidence-backed `learning_candidates`.
3. Add user review UI/conversation step for knowledge draft sections.
4. Extend `review_decision` command to carry `memory_draft`.
5. Extend FastAPI to persist returned `memory_draft`.
6. Update memory-wiki publish flow to preserve sectioned knowledge content and structured metadata.

---

## Short Version

OpenClaw should stop at “review summary” only for daily triage.

When an item is worth keeping, OpenClaw must generate a second artifact:

```text
knowledge draft = problem + root cause + when to use + steps + verification
```

That structured artifact must be reviewed by the user and sent back to FastAPI
as structured data, not squeezed into one `edited_summary` string.
