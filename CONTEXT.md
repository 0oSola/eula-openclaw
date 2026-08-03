# Project Domain Knowledge

This context defines the language used to turn project work and repository facts
into reviewed, durable domain knowledge for people and agents.

## Language

**Domain Term**:
A project-specific term whose meaning cannot be safely inferred from general software vocabulary.
_Avoid_: Keyword, token, jargon

**Concept Delta**:
A structured author explanation of a Domain Term that was introduced, clarified, renamed, deprecated, or superseded during a Codex session.
_Avoid_: Session summary, glossary guess

**Evidence Reference**:
A deterministic reference to an authoritative Contract, implementation, test, validation result, Git fact, or session provenance item.
_Avoid_: Link, citation hint

**Repository Evidence Resolver**:
A read-only fixed-revision resolver that turns bounded repository hints into canonical Evidence References.
_Avoid_: Repository browser, code-generating agent

**Deterministic Domain Knowledge Gate**:
A programmatic decision that reconciles a draft against canonical evidence and assigns needs-author-explanation, needs-evidence, or ready-for-review.
_Avoid_: Prompt quality score, human approval

**Topic Identity Resolver**:
A matcher that uses stable topic IDs, identity keys, aliases, and prior names to find canonical topic candidates without automatically merging them.
_Avoid_: Title slug generator, semantic auto-merge

**Domain Knowledge Candidate**:
An unreviewed proposal for one project domain topic and one primary retrieval intent.
_Avoid_: Review summary, memory draft, Wiki page

**Canonical Domain Note**:
The current reviewed Obsidian Note for one stable domain topic.
_Avoid_: Source note, session note, draft

**Wiki Change Proposal**:
A proposed action, target, affected page set, and complete diff for changing the canonical Domain Wiki.
_Avoid_: Patch suggestion, publish request

**Conflict Proposal**:
A non-publishable proposal that records incompatible definitions, boundaries, invariants, or authoritative evidence and requires a human decision.
_Avoid_: Merge conflict, automatic overwrite

**Accepted Wiki Change Set**:
The exact content and Wiki change approved by a human reviewer for publication.
_Avoid_: Accepted candidate, latest draft

**Publication Receipt**:
The durable result that binds a published Wiki change to its final content hash, path, lint result, and Git revision.
_Avoid_: Success message, publish log

**Incremental Extraction**:
Domain knowledge extraction triggered by a Codex session and its Concept Delta.
_Avoid_: Daily summary

**Baseline Scan**:
A fixed-revision repository scan used to establish or audit the initial Domain Wiki coverage.
_Avoid_: Full transcript scan, automatic Wiki import
