# OpenClaw Knowledge Memory Spec Index

Date: 2026-06-18

## Purpose

This index explains the reading order and dependency relationship between the
OpenClaw knowledge-memory specs prepared for the Codex review workflow.

The target reader is:

- OpenClaw engineer
- OpenClaw product / workflow owner
- FastAPI integrator coordinating the contract

---

## Recommended Reading Order

### 1. Main System Contract

Read first:

- `docs/plans/2026-06-15-openclaw-codex-review-consumption-spec.md`

Why:

- This is the top-level OpenClaw contract.
- It explains the end-to-end review run lifecycle.
- It defines the durable run, snapshot ingestion, command queue, command
  result, memory payload ingestion, publish flow, and acceptance criteria.

What changed recently:

- It now includes structured `knowledge_draft` generation.
- It now treats `memory_draft` as the preferred `review_decision` payload.

---

### 2. Content Generation Rules

Read second:

- `docs/plans/2026-06-18-openclaw-knowledge-memory-generation-spec.md`

Why:

- This is the content-generation spec for OpenClaw itself.
- It explains what OpenClaw must generate from FastAPI review candidates.
- It defines the difference between:

```text
review draft
vs
knowledge draft
```

Use this spec when implementing:

- prompt design
- output schema
- ranking rules
- conversation structure
- content quality rules

---

### 3. Queue Contract Patch

Read third:

- `docs/plans/2026-06-18-review-decision-memory-draft-contract-spec.md`

Why:

- This is the protocol-level patch spec.
- It defines how OpenClaw sends structured accepted knowledge back to FastAPI.
- It extends `review_decision` with:

```text
memory_draft
```

Use this spec when implementing:

- command serializer
- queue payload validation
- backward compatibility
- FastAPI/OpenClaw integration tests

---

### 4. Execution Checklist

Read last:

- `docs/plans/2026-06-18-openclaw-knowledge-memory-implementation-checklist.md`

Why:

- This is the practical rollout list.
- It breaks the work into ownership areas and release gates.
- It is meant for engineering execution and delivery tracking.

Use this spec when implementing:

- task breakdown
- engineering sequencing
- rollout review
- release signoff

---

## Dependency Relationship

The relationship is:

```text
2026-06-15-openclaw-codex-review-consumption-spec
  -> defines overall OpenClaw system behavior and queue/publish lifecycle

2026-06-18-openclaw-knowledge-memory-generation-spec
  -> refines the content-generation responsibility inside that lifecycle

2026-06-18-review-decision-memory-draft-contract-spec
  -> defines the exact queue payload needed to return structured knowledge to FastAPI

2026-06-18-openclaw-knowledge-memory-implementation-checklist
  -> turns the above three specs into an implementation sequence
```

In short:

- the 2026-06-15 spec is the main contract,
- the 2026-06-18 generation spec defines what OpenClaw should generate,
- the 2026-06-18 contract spec defines how OpenClaw sends it back,
- the checklist defines how to ship it.

---

## FastAPI Boundary

OpenClaw should treat FastAPI as source of truth for:

- review item state
- evidence refs
- accepted memory persistence
- exported memory payloads

OpenClaw owns:

- knowledge-draft generation
- user review UX / conversation
- command queue payload creation
- memory-wiki publication orchestration

The key boundary is:

```text
OpenClaw generates structured knowledge
FastAPI persists structured knowledge
OpenClaw publishes structured knowledge
```

---

## Minimal Handoff Set

If the OpenClaw team only wants the minimum set, send these three:

1. `docs/plans/2026-06-15-openclaw-codex-review-consumption-spec.md`
2. `docs/plans/2026-06-18-review-decision-memory-draft-contract-spec.md`
3. `docs/plans/2026-06-18-openclaw-knowledge-memory-implementation-checklist.md`

If they are also designing prompt/schema behavior, include:

4. `docs/plans/2026-06-18-openclaw-knowledge-memory-generation-spec.md`

---

## Short Version

Use this order:

1. main behavior
2. content generation
3. payload contract
4. rollout checklist

That is the intended reading path.
