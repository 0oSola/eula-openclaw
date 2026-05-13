# Message Bridge OpenClaw Feishu 设计方案

## 1. 背景

当前本地 Message Service 已经支持：

- 前端发送消息到本地后端。
- 后端调用 OpenClaw `/v1/responses`。
- 请求头带 `x-openclaw-message-channel: feishu`。
- 本地 SQLite 持久化 session、messages、TTS 引用、motion resolution 和 trace。

但当前缺口是：飞书侧或 OpenClaw 中已有的会话消息不能自动回流到本地 Chatbox。

经过连通性探索，确认 OpenClaw Gateway `http://10.11.252.164:18789` 可用：

- `/health`、`/healthz` 正常。
- `/v1/models` 正常。
- `/openapi.json` 返回 404。
- OpenClaw WebSocket RPC 可连接，服务版本为 `2026.4.11`。
- Feishu channel 已配置并运行，bot 为 `eula`。
- RPC 方法包含：
  - `sessions.list`
  - `chat.history`
  - `sessions.messages.subscribe`
  - `sessions.messages.unsubscribe`
  - `sessions.send`
- RPC 事件包含：
  - `session.message`

因此第一版不采用 HTTP webhook 推送模式，而采用后端主动连接 OpenClaw WebSocket RPC 的方式同步 Feishu 消息。

## 2. 目标

第一版目标：

- 新增后端内置 Message Bridge Service。
- 当前 provider 实现 OpenClaw Gateway。
- 自动发现最新 Feishu session。
- 默认绑定到第一个 admin 用户的本地 workspace/session。
- 启动或绑定时拉取最近 100 条历史消息。
- 订阅实时 `session.message`。
- 断线后指数退避重连，并在重连成功后拉最近 20 条 history 补漏。
- 同步消息写入本地 SQLite，页面刷新后可恢复。
- Chatbox 改为虚拟列表，支持至少 1000 条消息顺畅滚动。
- Bridge 状态进入后台/设置面板，admin 可见可改。
- Bridge 链路写入 trace，便于排查。

非目标：

- 第一版不切换现有发送路径。
- 前端发送仍走 Message Service -> OpenClaw `/v1/responses`。
- 第一版不实现 Hermes Agent provider，只预留 provider 抽象。
- 同步进来的消息不自动生成 TTS。
- 同步进来的无 TTS 消息不显示语音按钮。
- history 恢复不驱动人物动作。

## 3. 总体架构

```text
Frontend Chatbox
  -> Local Message Service API
    -> SQLite message ledger
    -> OpenClaw /v1/responses 发送

Message Bridge Service
  -> MessageBridgeProvider
      -> OpenClawGatewayProvider 当前实现
      -> HermesAgentProvider 后续实现
  -> SQLite message ledger
  -> Trace Store
```

Bridge 第一版作为 FastAPI 后台 worker 随 API 启动，但代码结构上独立于现有 Message Service。

这样可以复用：

- SQLite 连接和表结构。
- 现有 account/workspace/session 隔离。
- trace 日志。
- FastAPI 生命周期。
- OpenClaw 连接配置。

同时避免把 OpenClaw Web Control RPC 协议直接写进消息路由。

## 4. Provider 抽象

定义通用 provider 接口，第一版只实现 OpenClaw。

```python
class MessageBridgeProvider:
    async def connect(self) -> None: ...
    async def close(self) -> None: ...
    async def list_external_sessions(self) -> list[ExternalSession]: ...
    async def fetch_history(self, session_key: str, limit: int) -> list[ExternalMessage]: ...
    async def subscribe(self, session_key: str) -> None: ...
```

OpenClaw provider 映射：

```text
connect                 -> WebSocket RPC connect
list_external_sessions  -> sessions.list
fetch_history           -> chat.history
subscribe               -> sessions.messages.subscribe({ key })
events                  -> session.message
```

Hermes Agent 后续只需要实现同一接口，不应影响 Chatbox、SQLite ledger、TTS、motion resolution 和 trace。

## 5. OpenClaw WebSocket RPC

连接地址：

```text
ws://10.11.252.164:18789
```

鉴权：

- 复用现有 `OPENCLAW_TOKEN`。
- role 使用 `operator`。
- scopes 使用：

```text
operator.admin
operator.read
operator.write
operator.approvals
operator.pairing
```

注意：OpenClaw Gateway 对 WebSocket RPC 有 Origin 校验。后端 worker 需要设置：

```http
Origin: http://10.11.252.164:18789
```

或者由 OpenClaw 侧配置允许本地服务 Origin。

## 6. SQLite 数据模型

新增 `message_bridge_bindings`：

```text
id
workspace_id
account_id
local_session_id
provider
channel
external_session_key
external_display_name
is_default
status
last_history_sync_at
last_message_at
created_at
updated_at
```

字段说明：

- `provider`: `openclaw`，后续可为 `hermes`。
- `channel`: 第一版为 `feishu`。
- `external_session_key`: 例如 `agent:main:feishu:direct:ou_xxx`。
- `local_session_id`: 本地 Message Service 的 session id。
- `is_default`: 当前默认绑定。
- `status`: `active | paused | error`。

新增 `message_bridge_state`：

```text
provider
channel
enabled
realtime_drive_character
websocket_status
reconnect_attempts
last_connected_at
last_error
updated_at
```

字段说明：

- `enabled`: 默认 `true`。
- `realtime_drive_character`: 默认 `true`。
- `websocket_status`: `connected | reconnecting | disconnected`。

## 7. 默认绑定规则

Bridge 默认启用。

启动后：

1. 读取第一个 admin 用户作为默认归属账号。
2. 调用 `sessions.list`。
3. 过滤 Feishu session：
   - `origin.provider == "feishu"`，或
   - `lastChannel == "feishu"`，或
   - `deliveryContext.channel == "feishu"`。
4. 按 `updatedAt` 倒序排序。
5. 选择最新 Feishu session。
6. 如果当前没有默认 binding：
   - 自动创建本地 chat session。
   - session 标题使用 OpenClaw `displayName`。
   - 创建 `message_bridge_bindings` 默认绑定。
7. 只有绑定归属账号能看到该本地会话。

后台可以切换绑定。

切换绑定时：

- 取消旧 external session 订阅。
- 保留旧本地 session，不删除历史消息。
- 创建或选择新的本地 session。
- 订阅新的 external session。

## 8. 同步流程

### 8.1 启动或绑定

```text
Bridge start
  -> connect OpenClaw WebSocket
  -> sessions.list
  -> resolve latest Feishu session
  -> create or load binding
  -> chat.history(limit=100)
  -> normalize and dedupe messages
  -> insert SQLite
  -> sessions.messages.subscribe({ key })
```

### 8.2 实时订阅

```text
OpenClaw session.message
  -> normalize message
  -> filter non-chat roles
  -> dedupe
  -> insert SQLite
  -> update binding last_message_at
  -> optionally drive character if enabled
```

### 8.3 重连

断线后使用指数退避：

```text
1s -> 2s -> 5s -> 10s -> 30s
```

封顶 30 秒。

重连成功后：

1. 重新 `connect`。
2. 重新 `sessions.list`。
3. 确认当前绑定 external session 仍存在。
4. 重新 `sessions.messages.subscribe({ key })`。
5. 拉最近 20 条 `chat.history` 做补漏。
6. 依赖去重避免重复入库。

## 9. 消息规范化

只入库可展示对话消息：

- `user`
- `assistant`
- `system`

过滤：

- `toolResult`
- tool call 中间态
- 内部 system event
- cron/system 噪音

同步消息字段映射：

```text
role
content
trace_id
openclaw_message_id
emotion
action
motion_plan
memory_ops
metadata
created_at
```

`metadata` 至少保存：

```json
{
  "source": "message_bridge",
  "provider": "openclaw",
  "channel": "feishu",
  "external_session_key": "...",
  "external_message_id": "...",
  "synced_from": "history | realtime | reconnect_history"
}
```

## 10. 去重规则

优先使用 OpenClaw 稳定消息 id。

候选字段：

- `__openclaw.id`
- `responseId`
- `toolCallId`
- 其他 OpenClaw 消息内稳定 id

去重键：

```text
provider + external_session_key + external_message_id
```

如果没有稳定 id，使用内容指纹兜底：

```text
sha256(provider + external_session_key + role + timestamp + content)
```

SQLite 层应提供唯一约束或幂等插入能力，避免重连和 history 补漏导致重复消息。

## 11. 人物驱动规则

history 恢复只进入 Chatbox，不驱动人物状态。

实时 assistant 消息是否驱动人物，由后台开关控制：

```text
realtime_drive_character = true | false
```

默认 `true`。

当开启时：

- 实时 assistant 消息进入 Chatbox。
- 更新人物气泡文本。
- 如果消息包含 `emotion/action/motion_plan`，解析并驱动动作。
- 如果没有动作字段：
  - `emotion = neutral`
  - `action = idle`
  - `motion_plan = null`
  - `motion_resolution = fallback_idle`

当关闭时：

- 实时 assistant 消息只进入 Chatbox。
- 不更新人物气泡。
- 不驱动当前动作。
- 仍持久化可解析字段，供后续查看。

## 12. TTS 规则

同步进来的消息不自动生成 TTS。

同步进来的 assistant 消息如果没有 TTS：

- 不显示语音按钮。
- 不触发 TTS 任务。

现有本地发送消息的 TTS 行为保持不变。

## 13. 前端改动

### 13.1 Chatbox 虚拟列表

引入：

```text
@tanstack/react-virtual
```

目标：

- 支持至少 1000 条消息顺畅滚动。
- 支持动态高度消息气泡。
- 保留现有 Chatbox 列表视觉。
- 保留顶部/底部渐变罩。
- 保留 Latest 按钮。

滚动行为：

- 用户在底部时，新消息自动滚到底。
- 用户翻看历史时，不强制滚动。
- 用户不在底部时，新消息进入后显示 Latest。

### 13.2 后台/设置面板

Bridge 状态放后台/设置面板。

仅 admin 可见和可修改。

展示：

```text
Provider
Channel
WebSocket status
Bound session displayName
Bound external_session_key
Latest Feishu session
Last history sync time
Last message time
Reconnect attempts
Last error
Realtime drive character switch
Binding switch action
```

Chatbox 不承载 Bridge 管理信息。

Trace 页面继续用于排查消息链路。

## 14. API 草案

后台状态：

```text
GET /admin/message-bridge/status
```

返回：

```json
{
  "provider": "openclaw",
  "channel": "feishu",
  "enabled": true,
  "websocket_status": "connected",
  "realtime_drive_character": true,
  "binding": {
    "external_display_name": "用户746923",
    "external_session_key": "agent:main:feishu:direct:ou_xxx",
    "local_session_id": "..."
  },
  "last_history_sync_at": "...",
  "last_message_at": "...",
  "reconnect_attempts": 0,
  "last_error": null
}
```

列出可绑定 Feishu sessions：

```text
GET /admin/message-bridge/openclaw/feishu/sessions
```

切换绑定：

```text
POST /admin/message-bridge/bindings/default
```

请求：

```json
{
  "provider": "openclaw",
  "channel": "feishu",
  "external_session_key": "agent:main:feishu:direct:ou_xxx"
}
```

更新开关：

```text
PATCH /admin/message-bridge/settings
```

请求：

```json
{
  "enabled": true,
  "realtime_drive_character": true
}
```

## 15. Trace 事件

新增 Bridge trace stage：

```text
message_bridge.openclaw.connect
message_bridge.openclaw.sessions.list
message_bridge.openclaw.session.bind
message_bridge.openclaw.history.load
message_bridge.openclaw.subscribe
message_bridge.openclaw.message.received
message_bridge.openclaw.reconnect
message_bridge.openclaw.error
```

建议 payload 包含：

```json
{
  "provider": "openclaw",
  "channel": "feishu",
  "external_session_key": "...",
  "local_session_id": "...",
  "count": 100,
  "source": "history | realtime | reconnect_history"
}
```

错误记录：

```json
{
  "error": "...",
  "reconnect_attempts": 3,
  "next_retry_seconds": 10
}
```

## 16. 测试范围

后端测试：

- provider mock：
  - connect 成功。
  - `sessions.list` 返回 Feishu sessions。
  - 默认选择最新 `updatedAt` session。
  - `chat.history` 返回混合消息时过滤 toolResult。
  - `sessions.messages.subscribe` 成功。
  - 断线后指数退避重连。
  - 重连后拉最近 20 条 history 补漏。
- SQLite：
  - 创建默认 binding。
  - binding 只归属第一个 admin 用户。
  - message dedupe。
  - bridge state 更新。
- API：
  - admin 可读取状态。
  - 非 admin 拒绝读取和修改。
  - admin 可切换 binding。
  - admin 可修改 realtime drive switch。
- motion：
  - 有字段时解析 emotion/action/motion_plan。
  - 没字段时 fallback idle。
  - history 不驱动人物。

前端测试：

- `@tanstack/react-virtual` 已接入。
- Chatbox 虚拟列表仍渲染消息。
- 用户在底部时自动滚到底。
- 用户翻看历史时显示 Latest，不强制滚动。
- 后台面板展示 Bridge 状态。
- 后台开关存在。
- OpenClaw token 不出现在前端。

## 17. 实施顺序

建议按以下顺序实现：

1. 新增 SQLite 表和 store 方法。
2. 新增 provider 抽象与 OpenClawGatewayProvider。
3. 新增 Bridge worker 生命周期。
4. 实现默认绑定和 history 首次同步。
5. 实现实时订阅和重连。
6. 接入 trace。
7. 新增 admin API。
8. 前端后台状态面板。
9. Chatbox 改虚拟列表。
10. 补测试和构建检查。

## 18. 关键决策记录

- Bridge 第一版以内置后台 worker 形式运行。
- 代码上保持独立模块，为 Hermes Agent provider 预留接口。
- 默认启用。
- 默认绑定第一个 admin 用户。
- 默认选择最新 Feishu session。
- 第一版只订阅当前默认绑定的最新 Feishu session。
- 启动/绑定时拉最近 100 条 history。
- 重连成功后拉最近 20 条 history 补漏。
- 实时驱动人物做成后台开关，默认开启。
- 同步消息不自动生成 TTS。
- 无 TTS 的同步消息不显示语音按钮。
- 前端 Chatbox 使用 `@tanstack/react-virtual`。
