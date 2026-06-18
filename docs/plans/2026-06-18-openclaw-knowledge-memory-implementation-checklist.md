# OpenClaw Knowledge Memory Implementation Checklist

> **Context:** This repository does not contain the OpenClaw source tree. This checklist is therefore organized by OpenClaw ownership area, API surface, and acceptance gate rather than by concrete in-repo file paths.

**Goal:** Give the OpenClaw team a direct execution checklist for landing structured knowledge-draft generation and the `review_decision.memory_draft` contract.

**References:**
- `docs/plans/2026-06-15-openclaw-codex-review-consumption-spec.md`
- `docs/plans/2026-06-18-openclaw-knowledge-memory-generation-spec.md`
- `docs/plans/2026-06-18-review-decision-memory-draft-contract-spec.md`
- `docs/plans/2026-06-09-openclaw-memory-wiki-obsidian-execution-spec.md`

---

## 0. Outcome Definition

OpenClaw work is done only when all of these are true:

1. OpenClaw can turn `learning_candidates` into structured `knowledge_draft` objects.
2. User review flow can show and edit `problem`, `root_cause`, `when_to_use`, `steps`, and `verification`.
3. OpenClaw can queue `review_decision` commands with `memory_draft`.
4. FastAPI can later return memory wiki payloads that preserve the same structure under `memory.details`.
5. OpenClaw publishes actionable memory pages, not only summary paragraphs.

---

## 1. Run Store And Snapshot Layer

### Checklist

- [ ] Confirm the durable run store already persists:
  - `drafts`
  - `learning_candidates`
  - `work_units`
  - `rollup`
  - `cursor`
- [ ] Extend the run store so each review candidate can optionally hold:
  - `knowledge_draft_status`
  - `knowledge_draft_json`
  - `knowledge_draft_updated_at`
  - `knowledge_draft_error`
- [ ] Keep `knowledge_draft_json` separate from raw FastAPI snapshot payload.
- [ ] Ensure snapshot replay/idempotency does not wipe a user-edited knowledge draft unless the candidate itself is replaced.

### Acceptance Gate

- Snapshot re-ingest with unchanged cursor is idempotent.
- Snapshot re-ingest with changed cursor updates candidate source data but does not silently drop already reviewed structured drafts.

---

## 2. Knowledge Draft Generator

### Checklist

- [ ] Add a dedicated OpenClaw prompt for `knowledge_draft` generation.
- [ ] Keep this prompt separate from the existing review-summary prompt.
- [ ] Validate generated output against the required schema:
  - `kind`
  - `schema_version`
  - `source`
  - `article.knowledge_kind`
  - `article.title`
  - `article.problem`
  - `article.when_to_use`
  - `article.steps`
  - `article.verification`
  - `article.source_summary`
- [ ] Reject generation output that has:
  - empty `steps`
  - empty `verification`
  - fabricated commands or file paths
  - missing problem statement
- [ ] Preserve `evidence_refs` through generation.
- [ ] If evidence is too weak, emit `open_questions` instead of fabricating procedure detail.

### Acceptance Gate

- For a high-quality `pitfall` candidate, OpenClaw generates a valid `knowledge_draft`.
- For a vague title-only draft, OpenClaw does not invent a fake runbook.

---

## 3. Candidate Ranking And Trigger Rules

### Checklist

- [ ] Default to `learning_candidates` before raw `drafts`.
- [ ] Rank by:
  1. type priority: `blocker`, `pitfall`, `decision`, `followup`, `work_summary`
  2. `priority_score`
  3. presence of `problem`, `fix`, `prevention`, `bounded_evidence`
- [ ] Only auto-trigger knowledge generation when at least one is true:
  - candidate type is `pitfall`, `decision`, or `blocker`
  - `priority_score >= 80`
  - non-empty `problem`, `fix`, or `prevention`
  - non-empty `bounded_evidence`
  - user explicitly asks to keep the item as reusable knowledge
- [ ] De-prioritize management-only items and evidence-empty drafts.

### Acceptance Gate

- The first 1-3 presented candidates are the highest-value reusable items, not arbitrary summary rows.

---

## 4. User Review Conversation And Editing Surface

### Checklist

- [ ] Add a review mode that shows:
  - title
  - problem
  - root cause
  - when to use
  - steps
  - verification
  - cautions
- [ ] Do not ask the user to review only a single summary paragraph for knowledge acceptance.
- [ ] Allow user actions:
  - accept as-is
  - edit before accept
  - ignore
  - snooze
  - request more evidence
- [ ] If the user edits a structured field, persist the edited structure in the run store before queueing the command.
- [ ] Preserve legacy summary editing for fallback mode.

### Acceptance Gate

- User can inspect and modify the operational content, not only the title and summary.

---

## 5. `review_decision.memory_draft` Contract

### Checklist

- [ ] Extend the command serializer for `type=review_decision`.
- [ ] Keep legacy fields:
  - `edited_title`
  - `edited_summary`
- [ ] Add preferred field:
  - `memory_draft`
- [ ] Enforce:
  - `memory_draft` allowed only for `accept` and `edit_accept`
  - forbidden for `ignore` and `snooze`
- [ ] Validate `memory_draft` before queueing:
  - `knowledge_kind` non-empty
  - `problem` non-empty
  - `when_to_use` non-empty
  - `source_summary` non-empty
  - `steps` non-empty
  - `verification` non-empty
  - step and verification `order` values are positive and increasing
  - optional `confidence` is `0..1`

### Acceptance Gate

- OpenClaw can queue:

```json
{
  "type": "review_decision",
  "action": "edit_accept",
  "item_id": "codex_review_1",
  "edited_title": "...",
  "edited_summary": "...",
  "memory_draft": {
    "knowledge_kind": "pitfall",
    "problem": "...",
    "when_to_use": "...",
    "steps": [{ "order": 1, "instruction": "..." }],
    "verification": [{ "order": 1, "instruction": "..." }],
    "source_summary": "..."
  }
}
```

---

## 6. FastAPI Compatibility Expectations

### Checklist

- [ ] Coordinate with FastAPI owner that `memory_draft` will be:
  - persisted to `codex_review_memory.details_json`
  - rendered into `codex_review_memory.body`
  - versioned in `codex_review_memory_versions`
  - returned later under `memory.details`
- [ ] Treat summary-only `accept` and `edit_accept` as compatibility mode, not the preferred steady state.
- [ ] Add contract tests or fixture-based integration tests across the queue/result boundary.

### Acceptance Gate

- OpenClaw sends `memory_draft`, FastAPI returns success, and the later memory payload still contains the structured fields.

---

## 7. Memory Payload Validation

### Checklist

- [ ] Update memory-payload ingestion validation so OpenClaw expects:
  - `memory.title`
  - `memory.body`
  - `memory.details`
  - `wiki.markdown`
- [ ] Verify `memory.details` preserves the accepted structured draft.
- [ ] Verify `wiki.markdown` renders actionable sections:
  - `Problem`
  - `Root Cause`
  - `When To Use`
  - `Steps`
  - `Verification`
  - `Source Summary`
- [ ] Hold publish if a structured accepted item comes back as a flat summary paragraph only.

### Acceptance Gate

- Structured decisions result in structured publish payloads.

---

## 8. Wiki Publish Rules

### Checklist

- [ ] Keep existing memory-wiki publish path and git hygiene rules.
- [ ] Ensure generated markdown reflects actionable structure, not only review prose.
- [ ] Preserve frontmatter and evidence refs.
- [ ] Preserve `memory.details` metadata in any internal OpenClaw store used for publish status or future retrieval.

### Acceptance Gate

- Published pages read like runbooks / knowledge notes, not retrospective one-paragraph summaries.

---

## 9. Error Handling

### Checklist

- [ ] If generation fails schema validation, do not queue command; mark candidate as generation-failed and show the reason.
- [ ] If the user accepts only summary value, allow legacy accept/edit_accept but mark it as summary-only mode.
- [ ] If FastAPI later drops `memory.details`, treat that as contract regression and block strong success claims.
- [ ] If evidence is insufficient, prefer `open_questions` or request-more-evidence flow over fabrication.

### Acceptance Gate

- OpenClaw fails closed on malformed structured memory rather than publishing degraded data silently.

---

## 10. Observability

### Checklist

- [ ] Add counters for:
  - knowledge drafts generated
  - knowledge drafts schema-failed
  - summary-only accepts
  - structured accepts
  - publish payloads missing `memory.details`
- [ ] Record whether a final accepted memory came from:
  - raw accept
  - edit_accept summary-only
  - edit_accept with `memory_draft`
- [ ] Record per-run counts for:
  - candidates shown
  - knowledge drafts produced
  - structured decisions queued

### Acceptance Gate

- OpenClaw team can tell whether the new path is actually being used, not just theoretically supported.

---

## 11. Rollout Sequence

### Phase 1

- [ ] Land `knowledge_draft` generator and schema validator.
- [ ] Keep output internal to OpenClaw review UI.

### Phase 2

- [ ] Land `memory_draft` in queued `review_decision`.
- [ ] Keep `edited_summary` dual-write for compatibility.

### Phase 3

- [ ] Verify FastAPI round-trip preserves `memory.details`.
- [ ] Verify published wiki pages render actionable sections.

### Phase 4

- [ ] Reclassify summary-only accept/edit_accept as compatibility mode in product and ops docs.

---

## 12. Done Means

Use this final release gate:

- [ ] OpenClaw generates structured knowledge drafts.
- [ ] User can review/edit structured operational content.
- [ ] Commands can carry `memory_draft`.
- [ ] FastAPI round-trip preserves structure.
- [ ] Wiki payload preserves structure.
- [ ] Published memory is actionable.
- [ ] Legacy summary-only path still works during migration.
