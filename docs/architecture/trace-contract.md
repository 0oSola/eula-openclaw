# Trace Contract

## Purpose
This project uses a single `trace_id` for each chat round-trip so frontend, backend, and OpenClaw interactions can be correlated for debugging and iteration.

## Headers
- `x-trace-id`: generated in frontend before `/chat` request; backend keeps it unchanged.
- `x-user-id`: current user identity used for access control and trace partitioning.

## Event Stages
- `ingress`: frontend message accepted by backend.
- `egress`: normalized response returned to frontend.
- `error`: upstream failure or parse failure path.

## Storage
- SQLite tables:
  - `trace_events`
  - `chat_mirror`
  - `retry_jobs`
- NDJSON files:
  - `api/data/logs/YYYY-MM-DD.ndjson`
  - compressed to `.ndjson.gz` after 7 days.

## API
- `GET /trace/events`
- `GET /trace/mirrors`

Admin users can query all users via `user_id` query parameter. Non-admin users are restricted to their own records.

## Retention
- DB retention: 30 days.
- NDJSON compression: after 7 days.
- Cleanup trigger: runs after chat processing.
