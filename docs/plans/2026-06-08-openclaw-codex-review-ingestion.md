# OpenClaw Codex Review Ingestion 接入文档

日期：2026-06-08

## 阶段说明

本文描述的是已实现的第一版 `FastAPI -> OpenClaw -> FastAPI draft review` 同步链路，用于把 desktop-pet 管理的 Codex 会话转成结构化 draft。

后续总控形态以 `docs/plans/2026-06-08-openclaw-control-plane-codex-review-memory-spec.md` 为准：OpenClaw 是系统 control plane，MMD 项目是 OpenClaw 的一个应用 channel/domain；LLM 是 OpenClaw 可用的模型后端，不是这里定义的 channel。Codex 通过 FastAPI 作为受控工具接入，OpenKB 只保存用户确认后的长期记忆。

## 目标

MMD 项目希望把 desktop-pet 管理的 Codex 会话转成结构化回顾，用于记录工作总结、踩坑、决策和后续事项。OpenClaw 不直接读取本机 Codex 文件，也不作为事实源；它只接收 FastAPI 生成的脱敏 `evidence_pack`，做结构化归纳，并把 JSON 结果返回给 FastAPI。

## 调用模式

第一版采用“FastAPI 异步 worker + OpenClaw HTTP 同步响应”：

```text
desktop-pet
  -> FastAPI /desktop-pet/sessions
  -> FastAPI build evidence_pack
  -> FastAPI codex_openclaw_sync_outbox pending
  -> worker POST OpenClaw /v1/responses
  -> OpenClaw 返回结构化 JSON 文本
  -> FastAPI 解析并写入 codex_review_items(status=draft)
```

这里的“异步”指 FastAPI 后台 outbox worker 异步执行，不阻塞 desktop-pet。OpenClaw 端不需要实现 webhook/callback，也不需要主动拉取数据。

## OpenClaw 接收入口

复用现有 Gateway HTTP Responses API：

```http
POST /v1/responses
Authorization: Bearer <OPENCLAW_TOKEN>
Content-Type: application/json
x-openclaw-agent-id: codex-manager
x-openclaw-message-channel: codex-pet
x-openclaw-session-key: codex-review:<pet_session_id>
x-openclaw-scopes: operator.admin,operator.read,operator.write,operator.approvals,operator.pairing
```

请求体：

```json
{
  "model": "openclaw",
  "user": "admin-1",
  "stream": false,
  "input": "<review extraction prompt + evidence_pack JSON>"
}
```

`x-openclaw-session-key` 必须稳定。同一个 Codex/Pet 会话的多次回顾请求使用同一个 session key，方便 OpenClaw 侧做会话级上下文管理。该 key 不应混用 Feishu Bridge session。

## 建议 Agent

建议 OpenClaw 配置一个独立 agent：

```text
agent_id: codex-manager
channel: codex-pet
role: Codex 会话回顾助手
```

Agent 行为要求：

- 只根据 `evidence_pack` 归纳，不补充未出现的事实。
- 输出必须是单个 JSON object，不要 Markdown，不要解释文字。
- 无法判断时使用 `null`、空数组或 `confidence < 0.5`，不要编造。
- 保留 `evidence_refs`，让 FastAPI 和用户能追溯来源。
- 不返回 secret、完整 transcript、完整 diff、环境变量或绝对敏感路径。

## FastAPI 发送的 input 格式

`input` 是一段指令加一个 JSON evidence pack。建议模板：

```text
你是 Codex 会话回顾助手。
请只根据下面的 evidence_pack 生成结构化 JSON。
不要补充未出现的事实；不要输出 Markdown；不要输出 JSON 以外的文字。
如果证据不足，请把字段置空或降低 confidence。

必须返回：
{
  "schema_version": 1,
  "work_summary": {...},
  "pitfalls": [...],
  "decisions": [...],
  "followups": [...],
  "blockers": [...],
  "management": {...}
}

evidence_pack:
{...}
```

示例 `evidence_pack`：

```json
{
  "kind": "codex_review_evidence_pack",
  "schema_version": 1,
  "session": {
    "pet_session_id": "codex:abc",
    "codex_session_id": "abc",
    "workspace_label": "MMD project",
    "display_title": "OpenClaw Codex 回顾同步设计",
    "status": "completed",
    "first_goal": "设计 Pet 管理的 Codex 会话如何同步给 OpenClaw",
    "last_event_at": "2026-06-08T13:01:38Z"
  },
  "facts": {
    "changed_files": [],
    "failed_commands": [],
    "successful_checks": [],
    "pending_approvals": [],
    "apply_failed": false,
    "last_error": null,
    "last_output_excerpt": "形成 FastAPI outbox 异步同步 OpenClaw 的方案。"
  },
  "evidence": [
    {
      "id": "ev_1",
      "source": "desktop_pet_sessions",
      "type": "first_prompt_preview",
      "excerpt": "我希望 pet 管理的这些 codex 会话同步到 openclaw..."
    },
    {
      "id": "ev_2",
      "source": "assistant_design",
      "type": "decision",
      "excerpt": "本地规则提取事实 -> evidence pack -> OpenClaw 做结构化归纳 -> 本地保存 draft"
    }
  ]
}
```

## OpenClaw 返回 JSON 契约

OpenClaw 返回的文本必须能解析为以下 JSON：

```json
{
  "schema_version": 1,
  "work_summary": {
    "title": "string",
    "summary": "string",
    "goal": "string|null",
    "work_done": ["string"],
    "result": "string|null",
    "evidence_refs": ["ev_1"],
    "confidence": 0.0
  },
  "pitfalls": [
    {
      "title": "string",
      "symptom": "string|null",
      "root_cause": "string|null",
      "fix": "string|null",
      "prevention": "string|null",
      "severity": "low|medium|high",
      "tags": ["string"],
      "evidence_refs": ["ev_1"],
      "confidence": 0.0
    }
  ],
  "decisions": [
    {
      "title": "string",
      "context": "string|null",
      "decision": "string",
      "reason": "string|null",
      "alternatives": ["string"],
      "tags": ["string"],
      "evidence_refs": ["ev_2"],
      "confidence": 0.0
    }
  ],
  "followups": [
    {
      "title": "string",
      "description": "string|null",
      "priority": "low|medium|high",
      "status": "open",
      "tags": ["string"],
      "evidence_refs": ["ev_1"],
      "confidence": 0.0
    }
  ],
  "blockers": [
    {
      "title": "string",
      "description": "string|null",
      "severity": "low|medium|high",
      "suggested_action": "string|null",
      "evidence_refs": ["ev_1"],
      "confidence": 0.0
    }
  ],
  "management": {
    "importance": "low|medium|high",
    "review_status": "draft",
    "needs_human_review": true,
    "suggested_next_action": "string|null",
    "tags": ["string"]
  }
}
```

字段约束：

- `schema_version` 当前固定为 `1`。
- `confidence` 范围是 `0.0` 到 `1.0`。
- `review_status` 固定返回 `draft`。
- `evidence_refs` 只能引用输入 `evidence[].id`。
- 没有对应内容时返回空数组，不要省略字段。

## FastAPI 如何解析 OpenClaw 响应

FastAPI 使用现有 `/v1/responses` 文本提取方式：

1. 优先读取响应 JSON 的 `output_text`。
2. 如果没有 `output_text`，读取 `output[].content[].text` 中 `type=output_text` 的文本。
3. 去掉可能包裹的 Markdown fence。
4. `json.loads()` 解析为 object。
5. 校验 `schema_version` 和必需顶层字段类型：`work_summary` 为 object，`pitfalls` / `decisions` / `followups` / `blockers` 为 array，`management` 为 object。
6. 每个可识别 item 写入 `codex_review_items`，状态为 `draft`；item 内部字段第一版按 best-effort 保存到 `details_json`。

解析失败处理：

- 非 2xx：outbox 记录 `last_error`，第一版标记 `failed`，后续可由人工或手动接口重新入队。
- 文本为空：标记 `failed`。
- 非 JSON：保存前 1000 字符 raw excerpt 到 outbox error，失败不落 review item。
- JSON 顶层契约不合法：标记 `failed`，需要人工查看。
- 部分 item 缺字段：合法可识别 item 仍落 draft，原始 item 保存到 `details_json`。

## Payload 大小和 debug 文件

FastAPI 发送给 OpenClaw 前会按 `CODEX_OPENCLAW_REVIEW_MAX_PAYLOAD_CHARS` 做 best-effort 裁剪。裁剪顺序是先压缩 excerpt，再从低优先级 evidence/facts 列表尾部移除，最后只保留最小 session/error 事实。被裁剪的请求会带：

```json
{
  "transport": {
    "truncated_for_openclaw": true,
    "max_payload_chars": 8000,
    "original_payload_chars": 12345
  }
}
```

当 `CODEX_OPENCLAW_REVIEW_DUMP_DEBUG_FILES=true` 时，FastAPI 会把发送请求和解析后的响应写到：

```text
api/data/openclaw/codex-review/<outbox_id>-request.json
api/data/openclaw/codex-review/<outbox_id>-response.json
```

该开关默认关闭，debug 文件仍只包含脱敏/裁剪后的 evidence pack，不包含完整 transcript。

## 幂等与去重

FastAPI 负责幂等，不要求 OpenClaw 去重：

```text
payload_hash = sha256(redacted_evidence_pack)
dedupe_key = pet_session_id + payload_hash
```

同一个 `pet_session_id` 和 `payload_hash` 已成功同步时，不重复调用 OpenClaw。OpenClaw 返回的 item 可使用：

```text
item_dedupe_key = sha256(item_type + title + evidence_refs)
```

避免同一次会话多次同步生成重复坑点。

## 安全边界

FastAPI 在调用 OpenClaw 前必须完成：

- secret redaction。
- 文本截断。
- 路径降敏，例如保留 workspace label 和 repo-relative path，不发送完整敏感绝对路径。
- 不发送完整 Codex transcript。
- 不发送完整 diff/patch。
- 不发送 `codex_home`、环境变量、token、cookie、私钥。

OpenClaw 侧收到的内容已经是脱敏 evidence pack，但仍应避免在日志中长时间保留完整请求体。

## 可选增强

如果 OpenClaw 未来支持原生结构化输出，可以增加：

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "codex_review_result",
      "schema": {}
    }
  }
}
```

第一版不要依赖该能力；以“prompt 要求 JSON + FastAPI 严格解析校验”为准。

如果 OpenClaw 未来支持异步任务接口，也可以扩展为：

```text
POST /v1/review-jobs
GET /v1/review-jobs/{job_id}
```

但当前推荐继续复用 `/v1/responses`，减少 OpenClaw 侧改造成本。

## 验收标准

1. FastAPI 能向 `/v1/responses` 提交 `codex_review_evidence_pack`。
2. OpenClaw 使用 `x-openclaw-agent-id=codex-manager` 路由到专用回顾 agent。
3. OpenClaw 返回内容是单个 JSON object。
4. FastAPI 能解析 `work_summary`、`pitfalls`、`decisions`、`followups`、`blockers`。
5. 解析后的内容只以 `draft` 状态落库，必须经用户确认后进入长期知识库。
6. OpenClaw 不需要读取本地 Codex 文件，也不需要实现回调。
