# 桌面 MMD Codex Pet 设计

**日期：** 2026-06-03

**状态：** 已确认

**范围：** 新增独立 `desktop-pet` 前端子项目，复用现有 MMD 资产/API，并通过 VSCode 与 Codex CLI 形成状态提醒链路。

## 目标

把当前 MMD 模型做成常驻桌面的 Codex Pet。第一版目标不是把完整 `/companion` 页面搬到桌面，而是提供一个轻量、透明、置顶的 MMD 小组件，用来显示 Codex 工作状态、提醒用户处理审批、完成或失败事件，并允许用户从右键菜单恢复由 pet 管理过的 Codex 会话。

用户仍然主要在 VSCode 集成终端里使用 Codex CLI。pet 只负责启动、恢复、观察和提醒，不在第一版里直接发送 prompt、查看完整摘要或处理审批。架构上为这些能力预留接口。

## 已确认决策

- 第一版为 Codex Pet 版，不只是 idle MMD 小组件。
- Codex 交互仍发生在 VSCode 集成终端。
- pet 需要能拉起 VSCode，打开对应 workspace，并启动或恢复 Codex CLI。
- 为了获得接近 Codex Pet 的运行状态，Codex CLI 使用 `codex --remote ...` 连接由 pet/relay 启动的本地 `codex app-server`。
- 不使用裸 `codex` 作为第一版状态源，因为裸终端进程无法稳定提供结构化 turn/approval/command/file-change 状态。
- 右键菜单支持选择恢复历史 session。
- session 菜单展示要可读，不直接堆 UUID。
- 恢复行为为 A+C：优先复用已打开 VSCode workspace 窗口，在对应终端运行恢复命令；找不到窗口时再打开新 VSCode 窗口。
- 提醒详细度支持右键切换：低打扰、中等详细、高详细。
- 审批第一版只提醒并聚焦 VSCode，不在 pet 内直接 approve/deny。
- MMD 动作由 Codex 状态驱动。
- pet 跟随 companion 的模型、render pipeline、favorite VMD 配置。
- pet 相机独立维护，不和 `/companion` 主舞台共用。
- 项目中可以新增一个小型 VSCode bridge extension，用于稳定复用窗口和控制集成终端。
- `desktop-pet` 是一个独立前端子项目，可按需启动。
- `desktop-pet` 启动时自动拉起 API 服务；如果 API 已存在，则复用已有 API。

## 推荐架构

第一版由四个运行面组成：

```text
desktop-pet/
  Electron main process
  Vite + React renderer
  Codex relay client
  VSCode bridge launcher

api/
  MMD/VMD assets API
  shared companion config API
  pet session registry API

VSCode bridge extension
  open/reuse workspace terminal
  run codex remote/resume command

codex app-server
  local event source for Codex thread/turn state
```

`desktop-pet` 不依赖 Next.js 页面。它直接作为独立 Vite + React + Electron 项目运行。这样桌面小组件可以按需启动，构建和打包也与现有 `web/` 主站分离。

MMD 渲染不重写。第一阶段可以通过路径 alias 复用 `web/src/features/stage/MMDStage.tsx` 和 `web/src/features/stage/mmdCompanionRuntime.js`，后续再抽成共享包，例如 `packages/mmd-stage`。这样可以保留现有 PMX/VMD 加载、透明背景、点击命中、口型和材质处理能力。

## 服务生命周期

`desktop-pet` 启动时由 Electron 主进程管理 API 可用性：

```text
desktop-pet start
  -> check http://127.0.0.1:8000/healthz
  -> if ready, reuse existing API
  -> if unavailable, start FastAPI
  -> poll /healthz until ready
  -> create transparent always-on-top pet window
  -> renderer loads shared config, models, VMD assets
  -> MMDStage starts idle interaction
```

需要记录 runtime ownership：

```text
api_started_by_pet: boolean
api_pid: number | null
api_url: string
started_at: string
```

关闭 pet 时只停止由 pet 自己启动的 API。若 API 原本已存在，不停止外部服务。Codex relay/app-server 也独立管理：恢复中的 Codex session 不因 pet 窗口关闭而强杀，除非用户明确选择关闭会话。

## Codex 启动与状态源

pet 使用 Codex app-server 作为结构化状态源。官方 Codex manual 说明 app-server 是 rich clients 使用的接口，支持 conversation history、approvals 和 streamed agent events；CLI 也支持 `--remote` 连接到 app-server。

新建会话：

```text
Right-click "New Codex Session"
  -> choose workspace/mode
  -> relay starts codex app-server --listen ws://127.0.0.1:<port>
  -> pet writes session registry record
  -> VSCode bridge opens/reuses workspace terminal
  -> terminal runs:
     codex --remote ws://127.0.0.1:<port> --cd "<workspace>"
  -> relay mirrors/normalizes app-server events
  -> pet updates status, action, notification
```

恢复会话：

```text
Right-click recent session
  -> relay starts a new app-server port
  -> VSCode bridge opens/reuses workspace terminal
  -> terminal runs:
     codex resume <SESSION_ID> --remote ws://127.0.0.1:<port> --cd "<workspace>"
  -> pet updates registry last_seen/status
  -> pet resumes status tracking
```

端口不需要固定。恢复的关键是 `SESSION_ID`、`CODEX_HOME`、workspace 和 Codex 本地 session 存储一致。

## VSCode Bridge Extension

需要一个小型 VSCode extension，避免直接用命令行猜测窗口和终端状态。

职责：

- 接收 pet 的 workspace 和命令请求。
- 判断当前 VSCode window 是否匹配目标 workspace。
- 创建或复用名为 `Codex Pet` 的 integrated terminal。
- 发送 `codex --remote ...` 或 `codex resume ... --remote ...`。
- 聚焦 VSCode 窗口和 terminal。
- 避免重复创建多个同名 terminal。
- 向 pet 返回启动结果。

如果 bridge 不可用，降级为：

```text
code -n "<workspace>"
```

然后 pet 展示需要手动运行的命令。

## Session Registry

Codex 自己的 transcript 和 resume 数据仍由 Codex 本地存储维护。pet 额外保存一份轻量 registry，用来展示可读菜单和恢复入口。

建议字段：

```text
pet_session_id
codex_session_id
workspace_path
display_title
first_prompt_preview
last_summary
last_status
last_seen_at
codex_home
launch_mode
remote_mode
api_started_by_pet
```

右键菜单默认只展示由 pet 启动或恢复过的 session，避免把本机所有 Codex 历史都扫进桌面菜单。

展示格式：

```text
继续：MMD project · 昨晚 23:18 · 等待审批
继续：web 登录布局修复 · 6月2日 21:04 · 已完成
继续：Codex Console 集成 · 5月30日 · 运行中
```

详情页或二级菜单展示：

```text
标题：web 登录布局修复
工作区：D:\workspace\MMD project
状态：已完成
最近活动：2026-06-02 21:04
会话：7f9f9a2e...d12a
模式：workspace-write / on-request
上次摘要：修改 loginV2 布局，build 通过，未 apply
```

标题来源优先级：

1. 用户自定义标题。
2. Codex thread title 或 summary。
3. 首条 prompt 前 24-36 个字符。
4. workspace 名称加最近状态。

排序按 `last_seen_at` 倒序。主菜单只显示最近 8-10 个，底部提供 `更多会话...`、`清理已失效会话`、`打开 Codex sessions 目录`。

## 共享配置与 Pet 独立配置

共享配置来自 API，用于让 desktop pet 跟随 companion 当前角色和动作配置：

```text
selected_model_path
render_pipeline
favorite VMD assets
current user/session basics
```

pet 独立配置：

```text
pet_camera_snapshot
window size
window position
notification detail profile
Codex session registry
VSCode/terminal launch preference
```

相机必须独立。桌面 pet 是小窗口，构图与 `/companion` 主舞台不同；共享相机会导致主舞台和 pet 至少一个场景裁切不佳。

## 提醒详细度

右键菜单支持切换：

```text
Codex Pet
  提醒详细度
    低打扰
    中等详细
    高详细
```

默认使用低打扰。

低打扰：

- 运行中只改变 MMD 动作或状态点。
- 只在等待审批、失败、完成、断开时弹气泡。
- 不显示命令、文件名、prompt 内容。

中等详细：

- 显示阶段，例如正在思考、正在运行命令、正在修改文件、已生成 diff、检查中。
- 可显示文件数量，例如 `已修改 3 个文件`。
- 不显示具体文件名。

高详细：

- 显示命令名、文件名、检查名等简短信息。
- 示例：`运行：npm test`、`修改：web/src/app/companion/page.tsx`、`等待审批：git push`。
- prompt、命令输出、路径都要截断。
- secret-like 字段必须脱敏。
- 不在桌面气泡里展示完整输出，只提供打开详情或聚焦 VSCode。

内部结构：

```text
Codex event
  -> CodexStatusNormalizer
  -> NotificationPolicy(profile)
  -> Pet UI
```

## MMD 状态动作映射

MMD 动作由 Codex 状态驱动，但需要节流，不能每个事件都打断当前动作。

默认映射：

```text
idle / no_session      -> idle loop
starting               -> wave / prepare
running                -> focused idle / thinking
command_running        -> nod / work pulse
file_changed           -> short cheer
waiting_approval       -> reminder action + bubble
completed              -> cheer / wave
failed                 -> confused / low-energy action
disconnected           -> observe / question action
```

动作来源优先级：

1. 当前模型 favorite VMD 中匹配分类的动作。
2. 当前模型 safe favorite VMD。
3. procedural fallback。

建议分类映射：

```text
00_idle_loop         -> idle / running loop
02_greeting_social  -> starting / restored / completed
05_soft_emotion     -> waiting_approval / disconnected
06_strong_personality -> completed / failed
```

节流规则：

- `running` 不重复触发，只保持循环。
- `file_changed` 最多 10-20 秒触发一次。
- `waiting_approval` 立即打断并提醒。
- `completed` / `failed` 触发一次后回到 idle。

## 审批行为

第一版不在 pet 内直接审批。

等待审批时：

```text
Codex waiting approval
  -> pet bubble/右键项提醒
  -> click bubble / double click pet / "打开审批"
  -> focus matching VSCode workspace
  -> focus Codex Pet terminal
  -> user approves/denies in terminal
```

状态文案按提醒详细度变化：

```text
低打扰：Codex 等待审批
中等详细：Codex 等待命令审批
高详细：等待审批：npm --prefix web install
```

后续可在架构中复用 approval id 和详情，新增 pet 内审批 UI，但第一版不启用。

## 错误处理

- API 启动失败：pet 保持窗口，显示 `API unavailable`，右键提供 `Retry API`、`Open logs`。
- MMD 模型加载失败：不影响 Codex 提醒，显示轻量占位状态。
- Codex app-server 启动失败：只禁用 Codex session 功能，MMD idle 继续。
- remote 会话断开：registry 标记 `已断开`，右键可重新恢复。
- VSCode bridge 不可用：退化为打开 workspace，然后显示要运行的命令。
- session id 不存在：标记 `已失效`，允许从菜单移除。
- approval required：只提醒和聚焦 VSCode，不直接审批。
- 高详细提醒：所有 prompt、命令输出、路径都截断并脱敏。

## 测试策略

第一版至少覆盖：

- `desktop-pet` 单元测试：
  - status normalizer
  - notification profile
  - session title generation
  - MMD status action mapping
- API 测试：
  - shared companion config
  - pet session registry CRUD
- Electron smoke：
  - 启动透明窗口
  - 自动拉起 API
  - 加载模型列表
- VSCode bridge：
  - 给定 workspace 和命令，能创建或复用 terminal
  - 不重复创建 `Codex Pet` terminal
- Codex relay：
  - 使用 fake app-server JSON-RPC 事件流验证 running、approval、completed、failed
  - 真实 app-server 接入前不要依赖外部 Codex 网络状态
- 手工验收：
  - 新建会话
  - 恢复会话
  - 等待审批提醒
  - 失败提醒
  - 完成提醒
  - 关闭重启后 session 列表仍可读

## 落地阶段

1. 新建 `desktop-pet` 独立 Vite/Electron 骨架，支持透明置顶窗口和右键菜单。
2. Electron 主进程实现 API health check、自动启动和 runtime ownership。
3. API 增加 shared companion config 和 pet session registry。
4. pet renderer 复用 MMD 模型列表、favorite VMD 和 idle/click 交互。
5. Codex relay 先接 fake events，完成状态 normalizer、提醒 profile 和 MMD 动作映射。
6. VSCode bridge extension 支持打开/复用 workspace terminal。
7. 接入真实 `codex app-server --listen ws://...` 和 `codex --remote`。
8. 接入 `codex resume <SESSION_ID> --remote ...` 和右键 session 列表。
9. 完成日志、失败恢复、打包和手工验收。

## 主要风险

- Codex app-server WebSocket transport 在官方文档中标注为 experimental/unsupported，需要保留版本兼容和降级策略。
- VSCode 窗口/终端控制没有 bridge extension 时不稳定，因此 extension 是本设计的关键组件。
- 高详细提醒可能暴露路径、命令或 prompt 信息，必须默认低打扰并做脱敏。
- MMD runtime 常驻桌面需要控制 GPU 占用。pet preset 应禁用 postfx/backdrop，降低不必要的渲染成本。
- API 自动启动要准确区分 pet-owned 与 external-owned，避免关闭用户已有开发服务。

## 参考

- Codex CLI reference：`codex`、`codex resume`、`--remote`
- Codex App Server：JSON-RPC、thread/turn、streamed notifications、approvals
- Codex IDE extension：VSCode 中的 Codex surface 和 command palette 集成
