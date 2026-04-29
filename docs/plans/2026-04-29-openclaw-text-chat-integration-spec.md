# OpenClaw Text Chat Integration Spec

**Date:** 2026-04-29

**Status:** Current-state spec for follow-up development

**Scope:** `/companion` text chat request path from web UI to local API to OpenClaw Gateway

## Goal

Describe the current OpenClaw text chat integration precisely enough that future work can extend or refactor it without rediscovering the request path, protocol assumptions, fallback behavior, or configuration surface.

This document is intentionally about the current implementation and the development constraints it creates. It is not a step-by-step implementation plan.

## Current Architecture

The current text chat flow is a three-hop path:

1. The web client sends a JSON request to the local project API.
2. The local FastAPI backend normalizes request metadata, records trace data, and forwards the message to OpenClaw.
3. OpenClaw returns model output, which the backend normalizes into the frontend-facing `ChatResponse`.

Current runtime endpoints:

- Web API base URL: `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8100`
- OpenClaw base URL: `OPENCLAW_BASE_URL=http://10.11.252.164:18789`

Current web-to-backend contract:

- Route: `POST /chat`
- Payload fields:
  - `user_id`
  - `message`
  - `session_id`
  - `history`

Current backend-to-OpenClaw contract:

- Active text chat endpoint: `POST /v1/responses`
- Text chat requests are non-streaming

Observed successful runtime evidence from local logs:

- `2026-04-29T07:57:46+00:00` used `/v1/responses`
- `2026-04-29T08:16:16+00:00` used `/v1/responses`
- `2026-04-28T17:23:04+00:00` used `/v1/responses`

Those records appear in:

- `api/data/logs/2026-04-29.ndjson`
- `api/data/logs/2026-04-28.ndjson`

## Source of Truth

Current implementation is primarily defined by:

- `web/src/lib/api.ts`
- `web/src/app/companion/page.tsx`
- `api/app/routes/chat.py`
- `api/app/models/chat.py`
- `api/app/services/openclaw_client.py`
- `api/app/config.py`
- `api/app/main.py`
- `api/tests/test_chat_route.py`
- `api/tests/test_openclaw_client.py`

If behavior observed at runtime conflicts with this document, those files are authoritative.

## Request Flow

### 1. Web client

The web app does not call OpenClaw directly.

`postChat()` in `web/src/lib/api.ts` sends the chat payload to the local backend at `/chat`. The helper also attaches trace headers and `x-user-id`. The frontend therefore depends on the local API as a stable integration boundary and should continue to treat OpenClaw as a backend concern.

The `/companion` page constructs `history` from the recent visible assistant and user messages and passes it to `postChat()`. This means the frontend is currently responsible for sending conversational context, while the backend is responsible only for serialization and upstream forwarding.

### 2. FastAPI chat route

`api/app/routes/chat.py` owns the application-level chat transaction.

Current responsibilities:

- accept `ChatRequest`
- generate or preserve `trace_id`
- generate `session_id` when absent
- record ingress and egress trace events
- call `OpenClawClient.generate_reply()`
- normalize raw assistant text via `normalize_assistant_reply()`
- persist chat mirrors and retry jobs
- return degraded fallback output when upstream invocation fails

This route is the current place where product-level behavior begins. Upstream HTTP transport details are intentionally pushed down into `OpenClawClient`.

### 3. OpenClaw client

`api/app/services/openclaw_client.py` owns protocol adaptation to OpenClaw.

Current behavior:

- builds OpenClaw-specific headers
- resolves model and agent targeting rules
- sends text chat through `/v1/responses`
- extracts plain text from the `responses` payload shape
- raises `OpenClawInvocationError` when `/v1/responses` fails or returns empty content

This service is the transport adapter between project-specific chat semantics and the single OpenClaw text-chat surface currently in use.

## Current OpenClaw Protocol Assumptions

### Headers

The backend currently sends these headers when available:

- `Authorization: Bearer <token>`
- `x-openclaw-scopes`
- `x-openclaw-agent-id`
- `x-openclaw-message-channel`
- `x-openclaw-session-key`

Current scope header value is a fixed operator scope bundle:

- `operator.admin`
- `operator.read`
- `operator.write`
- `operator.approvals`
- `operator.pairing`

This means the integration assumes the provided token is not only valid, but also allowed to act as an operator-scoped OpenClaw client.

### Model targeting

Current model resolution behavior is more subtle than the `.env` suggests:

- Default request payload model is `openclaw`
- `OPENCLAW_AGENT_ID` defaults to `main`
- If `OPENCLAW_MODEL` starts with `openclaw:` or `agent:`, that raw value is sent as the request model
- If `OPENCLAW_MODEL` is exactly `openclaw` or `agent`, the configured agent id is still applied through headers
- If `OPENCLAW_MODEL` starts with `openclaw/`, the suffix is treated as a legacy agent selector
- Any other non-empty `OPENCLAW_MODEL` currently becomes `backend_model`, but that resolved value is not used in the outgoing payload

This last point matters: with the current code, a value such as `minimax-portal/MiniMax-M2.7` is stored in config but is not actually forwarded as the request `model`. The outgoing request still uses `model: "openclaw"` unless the value matches one of the special OpenClaw-prefixed forms above.

That is the most important current-state nuance for future development.

## Current Fallback Behavior

The backend now has one application-level fallback layer.

### Product response fallback

Inside `api/app/routes/chat.py`:

- if `/v1/responses` invocation fails, return a degraded `ChatResponse`
- mark `endpoint_used="fallback"`
- include `fallback_reason`
- insert trace and retry records

This is a user-facing resilience fallback.

Future changes should keep transport errors and product fallback conceptually separate, but there is no longer a text-chat endpoint fallback inside `OpenClawClient`.

## Current Data Contracts

### Request

`ChatRequest` currently contains:

- `user_id: str`
- `message: str`
- `session_id: str | None`
- `history: list[ChatMessage]`

`ChatMessage` currently contains:

- `role: str`
- `content: str`

### Response

`ChatResponse` currently contains:

- `trace_id`
- `text`
- `emotion`
- `action`
- `motion_plan`
- `memory_ops`
- `parse_mode`
- `endpoint_used`
- `degraded`
- `fallback_reason`

This response is not a thin proxy of OpenClaw output. It is an application-specific normalized contract expected by the `/companion` UI and motion system.

Any future change to upstream model format should preserve this normalized response boundary unless the frontend is intentionally being redesigned.

## Configuration Surface

Current backend configuration fields:

- `OPENCLAW_BASE_URL`
- `OPENCLAW_TOKEN`
- `OPENCLAW_AGENT_ID`
- `OPENCLAW_MODEL`
- `OPENCLAW_MESSAGE_CHANNEL`
- `OPENCLAW_PROXY_URL`
- `OPENCLAW_VERIFY_SSL`
- `OPENCLAW_TIMEOUT_SECONDS`

Current frontend configuration field:

- `NEXT_PUBLIC_API_BASE_URL`

Important operational implications:

- the frontend can be pointed at a different backend without changing chat UI code
- the backend can be pointed at a different OpenClaw Gateway without changing web code
- proxy and TLS behavior are backend-only concerns

## Trace and Persistence Behavior

The text chat integration is not only an inference call. It is also a traceable transaction.

Current backend side effects include:

- trace event insertion
- chat mirror persistence
- retry job insertion on failure
- retention cleanup after chat processing

That means future refactors must preserve observability. Any replacement transport or streaming path that bypasses these hooks would be a regression even if messages still appear in the UI.

## Constraints for Future Development

### Keep the backend as the integration boundary

Do not move OpenClaw credentials, agent selection, or Gateway-specific headers into the frontend.

### Preserve normalized `ChatResponse`

The stage, dialogue bubble, motion resolution, and fallback UI all expect a normalized response. Upstream format changes should be absorbed in backend adapters.

### Treat model resolution as a bug-prone area

`OPENCLAW_MODEL` currently looks configurable in `.env`, but generic provider model ids are not actually forwarded. Future work should make this behavior explicit:

- either support provider model passthrough intentionally
- or reject unsupported model forms early with a clear error

Silent partial configuration is the wrong long-term state.

### Keep traceability first-class

Any new transport mode such as streaming, SSE, WebSocket relay, or multi-turn server memory must still preserve:

- `trace_id`
- `session_id`
- endpoint attribution
- degraded/fallback reporting

### Keep transport fallback local to the OpenClaw client

The `/chat` route should not learn endpoint-specific logic. If text chat ever needs multiple upstream endpoint modes again, that logic still belongs in `OpenClawClient` or a successor adapter layer.

## Recommended Development Directions

### 1. Clarify model semantics first

Before adding features, decide what `OPENCLAW_MODEL` is supposed to mean:

- an OpenClaw router alias such as `openclaw`
- an explicit agent selector
- a provider-native backend model id

Then update implementation, config docs, and tests to match one definition.

### 2. Add explicit protocol-mode tests

Current tests should be extended so behavior is locked for:

- successful `/v1/responses` path
- responses failure without hidden endpoint fallback
- empty text from responses path
- unsupported or misleading model config
- missing scope or auth failures

### 3. Decide whether streaming is needed

The current implementation is entirely request/response and non-streaming. If future UX needs incremental assistant output, the design must specify:

- frontend streaming rendering contract
- backend trace semantics during partial output
- OpenClaw streaming API choice
- failure handling after partial tokens have already been sent

That should be treated as a separate design track, not an opportunistic patch.

### 4. Separate product parsing from transport more cleanly

Today the route invokes OpenClaw and then normalizes assistant output. If richer assistant schemas are introduced later, consider a three-layer split:

- route orchestration
- OpenClaw transport adapter
- assistant payload parser/validator

The current code is close to that shape already.

## Known Gaps

- `OPENCLAW_MODEL=minimax-portal/MiniMax-M2.7` is currently misleading because it is not forwarded as the outgoing request model under normal execution.
- The current message channel is hard-coded by config default to `feishu`, which may not match all future integration modes.
- The current request path is non-streaming only.
- The current fallback assistant text in `chat.py` appears to contain encoding corruption and should be normalized in a follow-up change.

## Interface Reduction Decision

The text chat path previously carried a `/v1/chat/completions` fallback in code, but current local evidence showed only `/v1/responses` succeeding in real usage.

That fallback has been removed from the text chat integration for these reasons:

- it was not the proven live path
- it complicated diagnosis and testing
- it made endpoint health ambiguous
- it encouraged silent protocol drift instead of explicit configuration fixes

Current expectation:

- text chat success means `/v1/responses` is healthy
- text chat failure should be fixed at configuration, token, scope, gateway, or payload level
- the backend should not silently switch text chat protocols

## Acceptance Criteria for Follow-Up Work

Any future work in this area should be considered complete only if it preserves or improves all of the following:

- `/companion` still sends chat requests only to the local API
- backend trace records still correlate a full chat round-trip
- `/v1/responses` remains the only text-chat endpoint unless a new spec approves otherwise
- unsupported configuration is explicit rather than silently ignored
- degraded fallback responses remain user-safe and machine-traceable
- frontend-facing `ChatResponse` remains stable unless a deliberate UI contract change is approved

## Recommended Next Step

The next spec or implementation plan should focus on one of these, in order:

1. define and fix `OPENCLAW_MODEL` semantics
2. add targeted tests for protocol fallback and config edge cases
3. decide whether chat should remain non-streaming or move to streaming
