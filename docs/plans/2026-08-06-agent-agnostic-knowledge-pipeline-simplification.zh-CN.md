# Agent 无关的知识管线简化方案（v3）

- 状态：方向已由用户确认，待人工决策点拍板后实施
- 日期：2026-08-06
- 位置：`C:\w\kh-05`，分支 `codex/kh-05-cutover`
- 修订对象：`docs/plans/2026-08-05-codex-author-knowledge-handoff-pipeline-v2.zh-CN.md`
  中 OpenClaw 双审核/Publisher 部分

## 1. 一页结论

OpenClaw 不再实现复杂审核/发布状态机。知识管线收敛为：

```text
Codex（作者，3+N 包）
  → Pet（运输）
    → FastAPI（唯一权威控制面：接收 / Evidence / Gate / 候选账本 /
       审核队列 / 发布执行 / 回执审计）
        ├─ 审核界面层（可替换）：
        │    OpenClaw 对话 / Hermes / Web / Pet
        │    → 只做“展示候选 → 用户决策 → 回传决定”
        ├─ 发布适配器层（可替换）：
        │    Obsidian MCP / memory-wiki / 本地 Git Vault 适配器
        │    → 只做“写入精确 Markdown + lint + commit + push”
        └─ Obsidian Vault（唯一规范知识落盘点）
```

关键原则：

1. FastAPI 是唯一权威：所有候选、审核状态、批准、发布记录、回执都在 FastAPI；
2. 任何 agent 都不拥有知识语义，只负责“把候选给用户看、把用户决定传回来”；
3. 发布不绑定 OpenClaw：优先使用 Obsidian MCP / 本地 Git Vault 适配器，
   memory-wiki 作为可选后端；
4. 未来 Hermes 或其他 agent 接入时，只需实现一个很薄的审核界面适配器，
   不需要理解 Vault 主题、diff 或发布逻辑。

## 2. 为什么放弃 OpenClaw sidecar 复杂实现

原方案（KH-04 / 07-14 spec）要求 OpenClaw 侧实现：

- project-knowledge candidates/commands/publish-payloads/publish-status 状态机；
- 内容审核 + 发布审核 + Change Set 冻结 + memory-wiki 发布；
- 持久化 review runs、proposals、receipts。

这带来三个问题：

1. **绑定 OpenClaw**：发布语义、审核状态、Change Set 都长在 OpenClaw 侧，
   Hermes 或其他 agent 无法复用；
2. **双端复杂**：FastAPI 和 OpenClaw 各自维护状态机，还要对齐两套契约；
3. **运维重**：远程 sidecar 需要升级、重启、部署 Skill，且实测端点缺失。

新方案把这些职责收回 FastAPI，agent 只做“人工决策的搬运工”。

## 3. 新职责模型

| 层 | 职责 | 持有方 |
|---|---|---|
| 作者契约 | 3+N 包、marker、candidate 正文 | Codex |
| 运输 | 扫描、上传、幂等、ACK | Pet |
| 事实与 Gate | 接收、Evidence、确定性 Gate、候选 revision | FastAPI |
| 审核队列 | 待审核候选、审核状态、决定记录 | FastAPI |
| 人工决策 | 展示候选、内容确认、发布方案确认 | 用户（经任意 agent/UI） |
| 精确发布 | 生成 exact Markdown、lint、commit、push | FastAPI（经适配器） |
| 知识落盘 | Obsidian Vault + Git 历史 | Obsidian / Vault Git |
| 审计 | 回执、hash、不可变记录 | FastAPI |

## 4. 审核流程（简化后）

```text
1. FastAPI Gate 通过后，候选进入“待审核”队列；
2. 任意 agent（OpenClaw/Hermes）或 Web/Pet 拉取待审核候选：
   GET /codex/knowledge/reviews?status=pending
3. agent 向用户展示：
   - 作者主张（问题、方案、边界）
   - 证据摘要（文件、符号、测试）
   - 建议的发布方案（由 FastAPI 或 agent 生成，用户确认）
4. 用户决策后回传 FastAPI：
   POST /codex/knowledge/reviews/{candidate_id}/decision
   {
     "decision": "accept | edit_accept | reject | needs_evidence",
     "approved_knowledge": {...},      // accept 时必填
     "publication_proposal": {...},     // 发布方案，用户确认
     "reviewer": {"agent": "openclaw|hermes|web", "user_id": "..."}
   }
5. FastAPI 校验决定，生成 Accepted Wiki Change Set（FastAPI 冻结）；
6. FastAPI 发布执行器调用发布适配器：
   exact write → lint → compile → commit → push；
7. receipt 写入 FastAPI 审计表；
8. 状态机推进：pending → review_requested → content_approved →
   publication_approved → publishing → published | failed | conflict。
```

两次人工确认仍然保留（这是原方案的价值）：

- 第一次：确认“知识内容正确”；
- 第二次：确认“具体写哪个页面、最终 Markdown 和 diff 正确”。

两次确认可以合并为一次交互中的两个步骤，但 FastAPI 账本必须分别记录。

## 5. 发布适配器（可替换）

FastAPI 定义统一发布端口：

```text
vault_status()
vault_search(query)
vault_get(path)
vault_apply_exact(files, expected_revision)
vault_restore_exact(snapshots, expected_revision)
vault_lint(paths)
vault_compile()
vault_commit_push(paths, message, trailers)
```

实现候选（已收敛，2026-08-06 澄清）：

| 适配器 | 优点 | 条件 |
|---|---|---|
| Obsidian MCP | 语义化读写/搜索/链接，agent 可复用 | 需要确认 MCP server 部署与工具面（read/write/search） |
| Git CLI 适配器 | 发布事务：status / allowlist add / commit / push / 失败不自动回滚 | FastAPI 能访问 Vault 的 Git 工作区（本机、网络挂载或 git clone 工作流） |
| 轻量 lint 脚本（可选） | frontmatter 必填、wikilink 可解析、Markdown 结构 | 自写校验脚本，不依赖 memory-wiki |
| ~~memory-wiki~~ | ~~已启用、CLI 可用~~ | **退役：内容操作交给 Obsidian MCP，发布事务交给 Git CLI** |

推荐组合：

```text
Obsidian MCP（内容读写/搜索）
+ Git CLI（status → add allowlist → commit → push）
+ FastAPI（幂等/审计/回执）
+ 可选轻量 lint（frontmatter/wikilink）
```

memory-wiki 不再进入主路径。

### 5.1 Git CLI 与远程 Vault 的三种访问方式

如果 Vault 不在 FastAPI 所在机器（当前 OpenClaw/Obsidian 在远程），选一种：

| 方式 | 说明 | 条件 |
|---|---|---|
| 共享/网络挂载 | FastAPI 直接访问远程 Vault 目录 | 远程目录可挂载、Git 工作区可访问 |
| git clone 工作流 | FastAPI 本地 clone Vault，Obsidian MCP 写远程工作区后由 FastAPI push | MCP 与 clone 指向同一目录；或 MCP 写后同步 |
| 远程薄执行器 | 远程运行一个只执行 Git 命令的小服务/脚本 | 需要部署一个最小执行器（不绑定 OpenClaw） |

注意：Obsidian MCP 写的文件必须与 Git CLI 操作的是同一个工作区，否则会发布
“另一个目录”的内容。这是 D4/D3 决策的一部分。

### 5.2 memory-wiki 退役边界

memory-wiki 的 `wiki_status/search/get/apply/lint/compile` 职责按以下方式接管：

| memory-wiki 能力 | 接管者 |
|---|---|
| search/get（内容查询） | Obsidian MCP |
| apply（写入页面） | Obsidian MCP |
| lint | 轻量自校验脚本（可选） |
| compile | Obsidian 自动索引（打开时）；不阻塞发布 |
| status（Vault 脏状态） | Git CLI `git status --porcelain` |
| Git commit/push | Git CLI |

## 6. OpenClaw 的角色（大幅简化）

OpenClaw 只做两件事：

1. 审核对话：读取待审核候选（或接收 FastAPI 推送的 bounded review request），
   向用户展示并回传决定；
2. 不再承担发布后端：memory-wiki 退出主路径，发布事务由 Git CLI 接管。

不再需要：

- project-knowledge candidates/commands/publish-payloads/publish-status；
- OpenClaw 侧持久化 review runs、proposals、receipts；
- Change Set 冻结（改由 FastAPI 冻结）；
- OpenClaw Skill 里的复杂发布状态机。

## 7. Hermes 及其他 agent 接入方式

接入一个新的 agent（如 Hermes）只需要实现一个薄适配器：

```text
1. 拉取待审核候选：GET /codex/knowledge/reviews?status=pending
2. 展示给用户（内容 + 证据 + 发布方案）
3. 回传决定：POST /codex/knowledge/reviews/{candidate_id}/decision
```

agent 不需要：

- 理解 Obsidian Vault 结构；
- 生成/校验 diff；
- 执行发布；
- 维护审核状态。

这就是“agent 无关”的实现方式：审核界面可替换，权威和发布留在 FastAPI。

## 8. 对已实现代码的影响

### 保留

- KH-01：作者契约、Hook、validator、3+N 样例；
- KH-02：Pet 扫描与运输；
- KH-03：FastAPI 接收、Evidence、Gate、candidate revision、独立账本；
- SQLite P0 备份与副本恢复工具（`scripts/sqlite_recovery.py`）。

### 改造

| 现有实现 | 新方案中的处理 |
|---|---|
| `codex_author_knowledge_openclaw_delivery.py`（T1/T2 project-knowledge 收敛） | 改造为“审核队列 + 审核 API”而非推送给 OpenClaw；回执轮询不再需要，改为 FastAPI 发布器直接写 receipt |
| `openclaw/project_knowledge/review_publisher.py` | 降级为参考实现，不进入生产主链 |
| `openclaw/skills/codex-author-knowledge-review-publisher/SKILL.md` | 简化为“审核对话 + 回传决定”契约，删除发布状态机与 memory-wiki 依赖说明 |
| FastAPI `POST /publication-receipts` | 保留为审计/兼容入口 |

### 新增

- 审核队列与审核 API（FastAPI）；
- 发布执行器与 `Accepted Wiki Change Set` 冻结（FastAPI）；
- Obsidian MCP 适配器（内容读写/搜索）；
- Git CLI 发布适配器（status/add/commit/push，allowlist + 审计 trailer）；
- 可选轻量 lint 脚本；
- 审核界面薄适配器（第一版可先用 OpenClaw 对话）。

## 9. 需要人工决策的点

以下决策由你拍板，拍板后我再更新任务清单并开始实施：

**D1：审核界面第一版用哪个？**

- A. OpenClaw 对话（推荐，已有用户习惯，先做薄适配器）；
- B. Web/Pet 页面（FastAPI 自带审核 UI，agent 无关但开发量大）；
- C. 两者都要。

**D2：发布适配器第一版用哪个？**

- A. Obsidian MCP（内容读写/搜索）+ Git CLI（发布事务）（推荐，已澄清）；
- B. 仅 Git CLI + 文件路径（不用 MCP，最简）；
- C. 保留 memory-wiki 仅做 Git 事务（不推荐，绑定 OpenClaw）。

**D3：Obsidian MCP 是否已部署？**

- 当前仓库内没有 Obsidian MCP 配置；本地只有 `obsidian-vault` skill（直接操作
  `D:\Obsidian Vault\AI Research` 路径）。如果已有 MCP server，请提供配置/工具清单；
  如果没有，第一版先走本地 Git Vault 适配器。

**D4：生产 Vault 用哪个？**

- 本机 `D:\Obsidian Vault\AI Research`（现有 skill 指向）；
- OpenClaw 远程 `/Users/sola/.openclaw/wiki/main`（非 Git）；
- Obsidian 默认 vault（Git 无 remote）；
- 新建专用 Git vault。

**D5：刚提交的 T1/T2（project-knowledge 收敛）如何处理？**

- A. 改造为“FastAPI 审核队列 + 发布器”（推荐，符合新方向）；
- B. 保留推送 OpenClaw 的 delivery 作为可选审核通道，新增审核 API 并存。

**D6：内容审核与发布审核是否保持两次确认？**

- A. 保持两次（推荐，保留原方案价值）；
- B. 合并为一次确认（更快，但发布风险更高）。

**D7：Hermes 接入范围？**

- A. 只做审核展示/回传（推荐）；
- B. 允许 Hermes 也执行发布（不推荐，权威分散）。

**D8：轻量 lint 是否纳入第一版？**

- A. 纳入（推荐：frontmatter 必填 + wikilink 存在性 + Markdown 结构）；
- B. 第一版不做，只靠 Git CLI + 人工确认。

**D9：远程 Vault 的 Git 访问方式？**

- A. Obsidian MCP 与 Git CLI 指向同一远程工作区（需确认部署方式）；
- B. git clone 工作流；
- C. 远程薄执行器；
- D. Vault 实际在本机可访问（需确认）。

## 10. 简化后的实施任务（D1-D7 拍板后细化）

```text
S1 FastAPI 审核队列与审核 API（候选入队、状态机、决定回传）
S2 FastAPI Accepted Wiki Change Set 冻结与发布执行器
S3 发布适配器（按 D2/D3/D9：Obsidian MCP + Git CLI）
S4 审核界面薄适配器（按 D1：OpenClaw 对话第一版）
S5 OpenClaw Skill 简化与部署（展示 + 回传，不碰发布、不依赖 memory-wiki）
S6 清理 project-knowledge 依赖（按 D5）
S7 SQLite 生产切换（备份/副本已就绪，切换需确认）
S8 v1 切断、flags 分阶段启用、真实端到端验收
```

## 11. 与旧方案的关系

- 保留：作者契约、Pet 运输、FastAPI Gate、两次人工确认、exact 发布、
  receipt 审计、SQLite P0；
- 废弃：OpenClaw sidecar 双审核状态机、project-knowledge 控制面依赖、
  OpenClaw-owned Change Set（改为 FastAPI 冻结）、memory-wiki 主路径；
- 新增：agent 无关的审核界面端口、可替换发布适配器。
