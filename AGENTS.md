# Project Agent Notes

## Superpowers System

Superpowers skills are discovered natively from:

- `~/.agents/skills/superpowers` (junction/symlink)

No bootstrap command is required.

## Architecture Documentation

When changing project functionality, service topology, external integrations, environment variables, data storage, API contracts, or runtime behavior, update:

- `docs/architecture/current-system-topology.md`

Keep this document aligned with the current running system so it can be used both for project understanding and for handing context to OpenClaw, TTS, frontend, or rendering services during optimization work.
