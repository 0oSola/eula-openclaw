# KH-05 运行时接线盘点与决策清单

- 状态：只读盘点快照（2026-08-06，Asia/Shanghai）
- 文档位置：本文件
- worktree：`C:\w\kh-05`
- 分支：`codex/kh-05-cutover`
- 前置清单：`docs/plans/2026-08-06-codex-author-knowledge-pipeline-progress.zh-CN.md`

> 本文件只记录已实际观察的事实。所有探测均为只读 GET 或只读 SQLite 查询，
> 没有触发任何写操作，也没有触碰真实数据库文件内容。

## 1. 结论摘要

KH-05 不能直接开工，有三个真实运行时缺口必须先有人决策或实现：

```text
1. OpenClaw Control Plane 服务可达，但 author-knowledge / project-knowledge /
   codex-review 三个命名空间端点实测全部 404，OpenClaw 侧服务端实现缺失或未注册。

2. memory-wiki 的规格 Vault 路径 D:/Obsidian/OpenClaw Wiki 在本机不存在；
   真实 Vault 在哪台机器、是否已配置 memory-wiki 插件，需要 OpenClaw 侧确认。

3. trace.db 确实损坏（integrity_check=malformed，quick_check 报 Tree 19 双重引用
   和游离页），但 51 张表和核心表可读；2026-07-10 已有一次成功恢复实验记录。
```

## 2. OpenClaw Control Plane 探测事实

服务地址（来自主工作区 `api/.env`）：

```text
OPENCLAW_CONTROL_PLANE_BASE_URL=http://10.11.252.164:8765
```

实测（只读 GET）：

| 路径 | 结果 |
|---|---|
| `GET /healthz` | 404 |
| `GET /` | 404 |
| `GET /v1/apps/mmd/codex-author-knowledge/workspaces/mmd-project/deliveries` | 404 |
| `GET /v1/apps/mmd/project-knowledge/runs` | 404 |
| `GET /v1/apps/mmd/codex-review/runs` | 404 |

含义：

- 服务进程存在且可连接；
- 但上述三个命名空间在 GET 下都不存在；
- 未测试 POST（会触发服务端副作用，超出只读盘点范围）；
- 本仓库 `openclaw/` 目录只有库、Skill 和测试，没有任何 HTTP 路由实现；
- `docs/plans/2026-07-14-openclaw-project-domain-knowledge-review-publish-spec.md`
  是 OpenClaw 侧实现的契约，但没有说明“已部署在哪、由谁维护”。

需要决策：OpenClaw 侧服务端实现由谁负责？是独立仓库/部署，还是本仓库需要新增
一个可挂载的 OpenClaw 运行时适配包？

## 3. memory-wiki 与 Obsidian Vault 事实

执行规格：`docs/plans/2026-06-09-openclaw-memory-wiki-obsidian-execution-spec.md`

规格中配置的 Vault：

```text
D:/Obsidian/OpenClaw Wiki
```

本机实测：

```text
D:/Obsidian/OpenClaw Wiki   不存在
D:/Obsidian                  不存在
```

含义：

- 该 Vault 不在本项目机器上，或从未创建；
- OpenClaw 运行在 `10.11.252.164`，Vault 可能只存在于 OpenClaw 侧机器；
- memory-wiki 插件（`wiki_status/search/get/apply/lint`）是否已配置，本仓库无法
  确认，需要 OpenClaw 侧提供状态证明。

需要决策：真实 Vault 在哪台机器？由谁创建 Git 仓库？`projects/{workspace_id}/domains/`
的 canonical 根目录由谁初始化？

## 4. SQLite P0 事实

目标库：`api/data/sqlite/trace.db`

文件状态：

```text
trace.db       961,359,872 字节（约 917 MiB），2026-08-06 15:07 仍在更新
trace.db-wal    4,132,392 字节
trace.db-shm       32,768 字节
```

只读检查结果：

```text
PRAGMA integrity_check
=> database disk image is malformed

PRAGMA quick_check
=> Tree 19 page 174806 cell 0: 2nd reference to page 174780
   Page 174785 ... 174805: never used
```

只读表访问：

```text
sqlite_master 可读，共 51 张表
codex_knowledge_extraction_outbox = 6 行（可读）
desktop_pet_sessions             = 182 行（可读）
```

历史恢复证据（`api/data/sqlite/backups/`）：

```text
trace-db-pre-repair-20260710-115910/
  trace-latest-corrupt.db
  trace-latest-recovered.db
  trace-latest-recovered.report.json   integrity_check=[ok]
  trace-online.db
  trace-recovered.db
  trace-recovered.report.json          integrity_check=[ok]
  trace.db

trace-db-corrupt-20260715/
  trace.db
```

2026-07-10 的报告显示恢复成功：

- `codex_review_items`：1479 / 1479 恢复；
- `trace_events`：1,350,224 行；
- `integrity_check`：ok；
- `foreign_key_check_count`：0。

当前运行状态：

- FastAPI 正在 `127.0.0.1:8100` 监听（PID 49560），是写库进程；
- 多个 Electron（Pet）进程在运行；
- 因此 SQLite P0 的第 1 步“停止 FastAPI、Pet 和所有写库进程”尚未执行。

含义：

- 损坏范围有限（不是整库不可读），但仍在增长中的生产库上；
- 已有可复用的恢复实验流程，但没有当前库的恢复报告；
- 必须在停止写库进程后，对当前 DB/WAL/SHM 做新备份并重新做副本恢复实验。

## 5. Feature Flag 与 Worker 启动事实

主工作区 `api/.env`（token 值不在此记录）：

```text
CODEX_KNOWLEDGE_EXTRACTION_ENABLED=false
CODEX_OPENCLAW_CONTROL_PLANE_ENABLED=true
OPENCLAW_CONTROL_PLANE_BASE_URL=http://10.11.252.164:8765
```

未设置（默认关闭）：

```text
CODEX_AUTHOR_KNOWLEDGE_HANDOFF_ENABLED
CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_DELIVERY_ENABLED
DOMAIN_KNOWLEDGE_CONTROL_PLANE_ENABLED
CODEX_AUTHOR_KNOWLEDGE_HANDOFF_TOKEN
CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_TOKEN
```

`api/app/config.py` 事实：

- `OPENCLAW_CONTROL_PLANE_TOKEN` 未设置时回退到 `OPENCLAW_TOKEN`（已设置），
  因此 token 条件满足；
- `CODEX_OPENCLAW_CONTROL_PLANE_ENABLED=true` 时，v1 control-plane worker
  会启动（main.py 判定），但目前对端 `codex-review` 端点返回 404，实际调用会失败
  并重试；
- 新 author-knowledge delivery worker 需要同时满足：
  `CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_DELIVERY_ENABLED=true`、
  handoff store 存在、control-plane client 存在、token 非空。

## 6. 缺口清单（缺陷 → 影响 → 需要谁决策）

| # | 缺口 | 已观察证据 | 影响 | 需要决策 |
|---|---|---|---|---|
| 1 | OpenClaw 服务端无 author-knowledge 端点 | `GET /v1/apps/mmd/codex-author-knowledge/...` 404 | 即使打开 flag，delivery 也无法被 OpenClaw 接收 | 谁实现/部署 OpenClaw 侧路由 |
| 2 | OpenClaw 服务端无 project-knowledge 端点 | `GET /v1/apps/mmd/project-knowledge/runs` 404 | 无法执行双审核/Change Set 流程 | 是否沿用 07-14 spec 新建实现 |
| 3 | v1 codex-review 端点 404 | `GET /v1/apps/mmd/codex-review/runs` 404，但 v1 flag=true | 现有 v1 worker 持续失败 | 是否先停用 v1 flag |
| 4 | 真实 Vault 不存在于本机 | `D:/Obsidian/OpenClaw Wiki` 缺失 | 无法确认 memory-wiki 指向哪里 | OpenClaw 侧提供 Vault 位置与 Git 状态 |
| 5 | memory-wiki 插件状态未知 | 本仓库无插件配置或连通性证据 | exact publish 无法落地 | OpenClaw 侧提供 `wiki_status` 证据 |
| 6 | trace.db 当前损坏 | integrity_check=malformed | KH-05 启用前必须恢复 | 批准停止写库进程并做副本恢复 |
| 7 | 恢复流程需复跑 | 历史报告为 2026-07-10，当前库 961MB | 需要新的备份 + 副本实验 | 确认恢复目标表和废弃表清单 |
| 8 | 四条分支未合并 | worktree 各自独立 | 真实端到端无法在一条链上跑 | 确定合并策略 |
| 9 | OpenClaw Skill 注册方式未定 | 新 Skill 只有 `SKILL.md`，无 agents 元数据 | 无法确认审核工作流如何被 OpenClaw 加载 | OpenClaw 团队确认加载机制 |

## 7. 建议的 KH-05 实施顺序（按依赖）

```text
阶段 A（外部协调，阻塞项）
  A1 确认 OpenClaw 侧由谁实现/部署 author-knowledge + project-knowledge 端点
  A2 确认真实 Vault 位置、Git 状态、memory-wiki 插件状态
  A3 确认 Skill 注册方式

阶段 B（本地 P0，可在 A 并行）
  B1 停止 FastAPI/Pet 等写库进程
  B2 备份 DB/WAL/SHM
  B3 在副本上复跑 2026-07-10 的恢复流程
  B4 产出当前库恢复报告（integrity_check=ok）
  B5 确认废弃 v1 派生表清单

阶段 C（代码切断）
  C1 Review accept 去知识副作用
  C2 v1 派生链停用（先关 CODEX_OPENCLAW_CONTROL_PLANE_ENABLED）
  C3 分阶段打开新 flag

阶段 D（端到端验收）
  D1 合并四条分支并回归
  D2 真实 Codex -> Pet -> FastAPI -> OpenClaw -> Obsidian 证书
```

## 8. 开放问题（需要用户/OpenClaw 回答）

1. OpenClaw Control Plane 服务端代码在哪个仓库？谁负责新增
   `codex-author-knowledge` 和 `project-knowledge` 路由？
2. `10.11.252.164:8765` 上 404 是“未实现”还是“路径/前缀不同”？能否提供
   当前 OpenClaw 服务端路由清单？
3. 真实 Obsidian Vault 的位置和 Git remote 是什么？
4. 是否授权在 KH-05 阶段停止本机 FastAPI 与 Pet 进程做 SQLite 恢复？
5. v1 `CODEX_OPENCLAW_CONTROL_PLANE_ENABLED=true` 是否可以现在关闭？
6. 四条 KH 分支的合并策略由谁确认（逐条合并 vs 集成分支）？

## 9. OpenClaw 侧实现确认单（新增 2026-08-06）

> 用途：把“OpenClaw 需要做什么”转成远程机器负责人可以直接回答的问题。
> 回答后，KH-05 才能确定交付物是“可部署应用包 + Skill + 插件配置”，
> 还是需要 OpenClaw 团队改服务端。

### 9.1 实现方式

**问题 O1：OpenClaw 平台支持哪些扩展方式？**

- 能否挂载自定义 HTTP 应用/路由（例如 `POST /v1/apps/mmd/...`）？
- 是否支持 MCP、插件或外部服务注册？
- 还是只能通过 Skill + 对话（`/v1/responses`）执行？

**问题 O2：如果支持挂载自定义应用，挂载在哪里？**

- OpenClaw 部署环境是否有应用/插件目录？
- 新增一个 HTTP 服务需要改 OpenClaw 核心源码，还是只新增外部应用包？
- 新增应用后是否需要重新构建/重启整个 OpenClaw？

### 9.2 现有端点状态

**问题 O3：请提供当前 Control Plane 已注册的路由清单。**

本项目实测（2026-08-06，只读 GET）：

```text
GET /healthz                                                    404
GET /                                                           404
GET /v1/apps/mmd/codex-author-knowledge/workspaces/mmd-project/deliveries  404
GET /v1/apps/mmd/project-knowledge/runs                         404
GET /v1/apps/mmd/codex-review/runs                              404
```

- 这些是“尚未实现”，还是“路径/前缀不同”？
- 现有 `codex-review` 端点实际挂在哪里？v1 worker 一直调用失败的根因是什么？

**问题 O4：author-knowledge 端点由谁实现？**

需要实现的端点至少包括：

```text
POST /v1/apps/mmd/codex-author-knowledge/workspaces/{workspace_key}/deliveries
GET  /v1/apps/mmd/codex-author-knowledge/workspaces/{workspace_key}/publish-status
```

- 由 OpenClaw 团队实现，还是由本项目提供一个可部署包？
- 实现语言/运行环境是否必须是 OpenClaw 内置技术栈，还是允许独立 Python 进程？

### 9.3 memory-wiki 与 Obsidian

**问题 O5：远程机器的 memory-wiki 插件是否已启用？**

- 能否提供 `wiki_status` 的实际输出？
- `wiki_search`、`wiki_get`、`wiki_apply`、`wiki_lint` 是否可用？

**问题 O6：真实 Obsidian Vault 在哪里？**

- Vault 路径、Git 仓库地址、远程 remote 是什么？
- 是否已初始化 `projects/{workspace_id}/domains/` 目录？
- Obsidian 侧是否能看到 Vault 并正常编译？

### 9.4 Skill 注册

**问题 O7：新 Skill 如何注册到 OpenClaw？**

- 需要交付物是 `SKILL.md` 目录（含 agents 元数据），还是由 OpenClaw 侧从
  `openclaw/skills/` 同步？
- 当前 `codex-author-knowledge-review-publisher/SKILL.md` 缺少 `agents/openai.yaml`，
  是否需要补齐？
- OpenClaw 加载 Skill 后，审核交互是在对话中完成，还是由 HTTP 应用驱动？

### 9.5 回执与网络方向

**问题 O8：发布回执如何回到 FastAPI？**

当前 KH-04 实现是 OpenClaw 主动 `POST /codex/knowledge/publication-receipts`
到本机 FastAPI，但：

- OpenClaw 在远程，本机 FastAPI 是 `127.0.0.1:8100`；
- 既有规格要求“所有网络连接由 FastAPI 发起，OpenClaw 不反连本机”。

请确认采用哪种方式：

- 方式 A：FastAPI 主动轮询 OpenClaw 的 `publish-status`/receipt 端点（推荐，符合
  既有网络方向约束）；
- 方式 B：允许 OpenClaw 通过内网可路由地址访问 FastAPI（会推翻“不反连本机”约束）；
- 方式 C：其他现有机制。

### 9.6 交付与验收

**问题 O9：OpenClaw 侧实现完成后，如何验收？**

- OpenClaw 能否提供一个“shadow 模式”测试端点，让 FastAPI 推送候选但不写真实
  Vault？
- 是否能提供测试 Vault（disposable Git Vault）做 lint/commit/push 演练？
- 验收时 OpenClaw 侧由谁确认“双审核通过”？

### 9.7 优先级

**问题 O10：OpenClaw 侧实现的排期和依赖？**

- 是否依赖本仓库先合并 KH-01~KH-04 分支？
- 是否依赖 SQLite 恢复完成？
- 是否依赖 v1 `codex-review` 端点先修复或停用？

### 9.8 回答后应更新的交付物

回答以上问题后，本清单应更新为：

```text
1. OpenClaw 侧实现方式（O1/O2）→ 确定交付物形态；
2. 端点实现方与端点清单（O3/O4）→ 确定 OpenClaw 应用包范围；
3. memory-wiki/Vault 状态（O5/O6）→ 确定远程部署清单；
4. Skill 注册方式（O7）→ 确定需要补齐的文件；
5. 回执网络方向（O8）→ 确定 FastAPI 侧新增轮询 worker 还是允许反连；
6. 验收方式（O9/O10）→ 确定 KH-05 阶段 D 的端到端验收步骤。
```
