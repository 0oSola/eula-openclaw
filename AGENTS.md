# Project Agent Notes

## Superpowers System

Superpowers skills are discovered natively from:

- `~/.agents/skills/superpowers` (junction/symlink)

No bootstrap command is required.

## Architecture Documentation

When changing project functionality, service topology, external integrations, environment variables, data storage, API contracts, or runtime behavior, update:

- `docs/architecture/current-system-topology.md`

Keep this document aligned with the current running system so it can be used both for project understanding and for handing context to OpenClaw, TTS, frontend, or rendering services during optimization work.

## Code Search Tooling

Semble CLI is available as a project-level semantic code search helper installed through `uv tool install semble`.

Use it when the task is cross-module or intent-based and exact keywords are uncertain, for example:

- "where companion right rail renders the trace card"
- "message bridge auto tts greeting storage audio"
- "MMD stage click motion state machine"

Continue to use `rg` first for exact identifiers, endpoint paths, filenames, and known strings. Scope Semble searches narrowly (`api/app`, `web/src`, `docs`) before searching the repository root, because generated/runtime data can make first indexing slow.

On Windows PowerShell, use the wrappers so Unicode output is safe:

```powershell
scripts\semble-search.ps1 "message bridge auto tts greeting storage audio" api\app -TopK 5
scripts\semble-search.ps1 "podcast audio proxy route" api\app -TopK 5
scripts\semble-savings.ps1
```

When Semble materially reduces file reading, update `docs/architecture/semble-code-search-observability.md` with the query, scope, elapsed time, follow-up files read, and `semble savings --verbose` output.
