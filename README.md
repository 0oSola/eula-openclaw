# MMD Virtual Companion Monorepo

Browser-based MMD virtual companion with OpenClaw chat, interaction mapping, and full trace logging.  
基于浏览器的 MMD 虚拟陪伴项目，包含 OpenClaw 对话、交互映射和全链路 trace 日志。

## Repository Layout / 仓库结构

- `web/`: Next.js + TypeScript frontend; Next.js + TypeScript 前端
- `api/`: FastAPI backend proxy and trace gateway; FastAPI 后端代理与 trace 网关
- `MMD/`: local PMX and texture assets; 本地 PMX 与贴图资源
- `docs/plans/`: implementation planning docs; 实施计划文档
- `docs/architecture/trace-contract.md`: trace event contract; trace 事件协议文档

## Core Features / 核心功能

- Browser MMD rendering with Three.js + MMDLoader; 基于 Three.js + MMDLoader 的浏览器 MMD 渲染
- Chat through backend proxy to OpenClaw with `/v1/responses` and fallback to `/v1/chat/completions`; 通过后端代理接入 OpenClaw，优先走 `/v1/responses`，必要时回退到 `/v1/chat/completions`
- Mixed text/JSON reply normalization into `text`, `emotion`, `action`, and `memory_ops`; 将文本或 JSON 回复统一归一化为 `text`、`emotion`、`action`、`memory_ops`
- Interaction chain of user mapping -> global mapping -> procedural fallback; 交互链路为用户映射 -> 全局映射 -> 过程化兜底
- VMD upload and binding for 6 emotion slots; 支持上传 VMD 并绑定到 6 个情绪槽位
- Full-chain trace logging across frontend and backend; 前后端全链路 trace 记录
- SQLite + NDJSON dual-write with retention cleanup; SQLite + NDJSON 双写并带保留期清理
- Browser and server TTS modes; 同时支持浏览器与服务端 TTS 模式

## Local Run / 本地运行

### 1. API / 后端

```powershell
cd api
copy .env.example .env
python -m uvicorn app.main:app --reload --port 8000
```

OpenClaw setup notes / OpenClaw 配置说明:

- Point `OPENCLAW_BASE_URL` at the Gateway HTTP port. The default local port is `http://127.0.0.1:18789`.  
  将 `OPENCLAW_BASE_URL` 指向 Gateway 的 HTTP 端口，默认本地端口为 `http://127.0.0.1:18789`。
- Enable `gateway.http.endpoints.responses.enabled=true` and/or `gateway.http.endpoints.chatCompletions.enabled=true` on the OpenClaw Gateway.  
  在 OpenClaw Gateway 中启用 `gateway.http.endpoints.responses.enabled=true` 和/或 `gateway.http.endpoints.chatCompletions.enabled=true`。
- Set `OPENCLAW_AGENT_ID` to the target agent. `OPENCLAW_MODEL` is treated only as a legacy local model selector; it is not forwarded as `x-openclaw-model`.  
  将 `OPENCLAW_AGENT_ID` 设为目标 agent。`OPENCLAW_MODEL` 仅作为旧版本地模型选择器保留，不会作为 `x-openclaw-model` 转发。
- Set `OPENCLAW_MESSAGE_CHANNEL=feishu` to route OpenClaw messages through the Feishu channel.  
  设置 `OPENCLAW_MESSAGE_CHANNEL=feishu`，让 OpenClaw 消息走飞书 channel。
- If Python cannot reach OpenClaw directly on this machine, set `OPENCLAW_PROXY_URL` such as `http://127.0.0.1:7897`.  
  如果当前机器上的 Python 进程无法直连 OpenClaw，请设置 `OPENCLAW_PROXY_URL`，例如 `http://127.0.0.1:7897`。
- Current OpenClaw `2026.3.28` deployments may require explicit `x-openclaw-scopes` on HTTP requests even when using the shared gateway bearer token. The backend sends this header automatically now.  
  当前 OpenClaw `2026.3.28` 版本在使用共享 gateway bearer token 时，HTTP 请求可能仍需要显式带上 `x-openclaw-scopes`。后端现已自动补上该 header。
- Use `GET /healthz/openclaw` to inspect live OpenClaw connectivity, read/write probes, and remediation hints.  
  可通过 `GET /healthz/openclaw` 查看实时 OpenClaw 连通性、读写探测结果和修复建议。

### 2. Web / 前端

```powershell
cd web
copy .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.  
打开 `http://localhost:3000`。

## Verification / 验证

Use the bundled script:  
使用仓库自带脚本：

```powershell
powershell -File scripts/verify-demo.ps1
```

It currently validates:  
当前会验证：

- API test suite via `pytest`; 通过 `pytest` 运行 API 测试
- Web core logic checks via `node web/tests/run-basic-checks.mjs`; 通过 `node web/tests/run-basic-checks.mjs` 运行前端核心检查

## Dev Stack Script / 开发栈脚本

Use one script to manage both API and Web:  
使用同一个脚本同时管理 API 和 Web：

```powershell
# Start API(8100) + Web(3100)
powershell -File scripts/dev-stack.ps1 -Action start

# Check status
powershell -File scripts/dev-stack.ps1 -Action status

# Stop both processes
powershell -File scripts/dev-stack.ps1 -Action stop
```

Optional parameters / 可选参数:

```powershell
powershell -File scripts/dev-stack.ps1 -Action start -ApiPort 8200 -WebPort 3200 -AdminUserIds "admin-1,admin-2"
```

## API Endpoints (MVP) / API 接口（MVP）

- `POST /chat`
- `GET /trace/events`
- `GET /trace/mirrors`
- `GET|PUT /config/mapping/default`
- `GET|PUT /config/mapping/user/{user_id}`
- `GET /config/mapping/resolved/{user_id}`
- `POST|GET /assets/vmd`
- `DELETE /assets/vmd/{asset_id}`
- `GET /assets/vmd/file/{asset_id}`
- `GET /assets/mmd/models`
- `GET /assets/mmd/validate`
- `GET /assets/mmd/{file_path}`
- `POST /tts/speak`
- `GET /healthz`
- `GET /healthz/openclaw`
