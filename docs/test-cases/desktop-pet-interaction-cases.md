# Desktop Pet Interaction Test Cases

更新时间：2026-06-04

本文维护 `desktop-pet` 的用户交互测试用例目录。每次修改 Pet 窗口拖动、右键菜单、相机调整、透明命中层、Codex 状态提示或 MMDStage pointer 行为时，需要同步更新本目录，并补充对应自动化测试。

| ID | 交互域 | 用例 | 预期行为 | 自动化状态 | 对应测试 |
|---|---|---|---|---|---|
| PET-INT-001 | 窗口拖动 | `Drag Whole App` 模式左键按下 | 只有左键可启动整窗拖动 | 已覆盖 | `desktop-pet/src/window/petWindowEvents.test.ts` |
| PET-INT-002 | 窗口拖动 | 右键按下 | 不启动窗口拖动，保留给右键菜单 | 已覆盖 | `desktop-pet/src/window/petWindowEvents.test.ts` |
| PET-INT-003 | 窗口拖动 | `Adjust Camera` 模式任意鼠标按钮 | 不启动窗口拖动，让 MMDStage/OrbitControls 接管 | 已覆盖 | `desktop-pet/src/window/petWindowEvents.test.ts` |
| PET-INT-004 | 窗口拖动 | 拖动窗口移动 | 按 cursor delta 移动窗口位置 | 已覆盖 | `desktop-pet/electron/windowDrag.test.ts` |
| PET-INT-005 | 窗口拖动 | 拖动过程中窗口尺寸 | 拖动只改变 x/y，不改变 width/height | 已覆盖 | `desktop-pet/electron/windowDrag.test.ts` |
| PET-INT-006 | 窗口拖动 | native 与 IPC 同时触发 drag start | 第一条到达的 source 持有 drag 状态，另一 source 不覆盖起点 | 已覆盖 | `desktop-pet/electron/windowDrag.test.ts` |
| PET-INT-007 | 窗口拖动 | native 与 IPC 同时触发 drag move | 只有持有 drag 状态的 source 可移动窗口 | 已覆盖 | `desktop-pet/electron/windowDrag.test.ts` |
| PET-INT-008 | 窗口拖动 | mouse-up 后 Windows/Electron 报告 1px 尺寸舍入 | drag end 保留当前位置，并恢复 drag 起点 width/height | 已覆盖 | `desktop-pet/electron/windowDrag.test.ts` |
| PET-INT-009 | 窗口配置 | 创建 frameless transparent BrowserWindow | Pet 固定 320x420，禁用 resize/maximize/fullscreen 尺寸变化 | 已覆盖 | `desktop-pet/electron/petWindowOptions.test.ts` |
| PET-INT-010 | 透明命中层 | whole-window drag 模式下 DOM pointer event | shell/stage/canvas 保持 `no-drag`，DOM 能收到 contextmenu/pointer 事件 | 已覆盖 | `desktop-pet/src/window/dragRegion.test.ts` |
| PET-INT-011 | 透明命中层 | Windows 全透明像素鼠标穿透 | `.pet-input-hit-surface` 覆盖 WebGL 上方，提供真实可命中像素 | 已覆盖 | `desktop-pet/src/window/dragRegion.test.ts` |
| PET-INT-012 | 相机调整 | `Adjust Camera` 模式下 MMD stage | stage/canvas 保持可交互，允许 zoom/pan/rotate | 已覆盖 | `desktop-pet/src/window/dragRegion.test.ts` |
| PET-INT-013 | MMDStage pointer | 关闭角色点击捕获 | 不捕获 pointer，避免阻断相机控制 | 已覆盖 | `desktop-pet/src/mmd/stagePointerCapture.test.ts` |
| PET-INT-014 | MMDStage pointer | 启用角色点击捕获 | 只捕获左键，不捕获右键 | 已覆盖 | `desktop-pet/src/mmd/stagePointerCapture.test.ts` |
| PET-INT-015 | 右键菜单 | renderer 传入合法窗口内坐标 | 坐标 normalize 为非负整数 | 已覆盖 | `desktop-pet/electron/contextMenuPosition.test.ts` |
| PET-INT-016 | 右键菜单 | renderer 传入非法坐标 | 丢弃非法坐标，改用 fallback 坐标 | 已覆盖 | `desktop-pet/electron/contextMenuPosition.test.ts` |
| PET-INT-017 | 右键菜单 | screen/window 坐标转换 | 坐标转换不会超出 Pet window bounds | 已覆盖 | `desktop-pet/electron/contextMenuPosition.test.ts` |
| PET-INT-018 | 右键菜单 | 同一次物理右键触发 native + renderer IPC | 延迟重复 popup 被去重 | 已覆盖 | `desktop-pet/electron/contextMenuDedup.test.ts` |
| PET-INT-019 | 右键菜单 | 极短时间内重复 popup 请求 | 立即重复 popup 被去重 | 已覆盖 | `desktop-pet/electron/contextMenuDedup.test.ts` |
| PET-INT-020 | 右键菜单 | 用户稍后再次右键 | 超出去重窗口后允许再次打开菜单 | 已覆盖 | `desktop-pet/electron/contextMenuDedup.test.ts` |
| PET-INT-021 | 右键菜单 | native popup 后 renderer fallback 延迟到达且坐标失真 | 在去重窗口内压掉 renderer/webcontents fallback，避免第二个菜单出现在窗口左上角 | 已覆盖 | `desktop-pet/electron/contextMenuDedup.test.ts` |
| PET-INT-022 | 右键菜单 | 在透明命中层远离角色的位置右键 | 菜单 popup 使用窗口内坐标并 clamp 到 Pet window bounds，避免屏幕坐标被当成窗口 offset 导致菜单跑远 | 已覆盖 | `desktop-pet/electron/contextMenuPosition.test.ts` |
| PET-INT-023 | 右键菜单 | native/system hook 收到 Pet window 外的 screen 坐标 | 丢弃该右键，不 clamp 到窗口边缘，也不打开菜单 | 已覆盖 | `desktop-pet/electron/contextMenuPosition.test.ts` |
| PET-INT-024 | 右键菜单 | Pet 位于屏幕右侧或底部边缘 | 菜单锚点应 clamp 在 Pet window 内，并尽量避免离开可见屏幕 | 已覆盖脚本 | `desktop-pet/scripts/stress-pet-right-click.ps1`, `desktop-pet/scripts/desktop-pet-manual-acceptance.md` |
| PET-INT-025 | 相机调整 | `Adjust Camera` 模式真实 zoom/pan/rotate | 用户能放大缩小并拖动角色位置，可切回整窗拖动并在重启后恢复镜头 | 已覆盖清单 | `desktop-pet/scripts/desktop-pet-manual-acceptance.md` |
| PET-INT-026 | Codex 状态 | 常驻状态条显示最新 Codex 状态 | 菜单 toast 消失后仍显示运行/完成/审批等状态 | 已覆盖 | `desktop-pet/src/codex/codexStatus.test.ts` |
| PET-INT-068 | Codex 状态 | 常驻状态卡显示最新 Codex 输出预览 | JSONL scanner 抽取最新 assistant 文本或 command output；状态卡最多显示 3 行输出并脱敏 token/key；点击状态卡通过 `pet:vscode:focus({ workspacePath })` 聚焦对应 VSCode workspace | 已覆盖 | `desktop-pet/src/codex/codexStatus.test.ts`, `desktop-pet/electron/codexSessionFiles.test.ts`, `desktop-pet/src/App.integration.test.ts`, `desktop-pet/electron/preloadModuleFormat.test.ts` |
| PET-INT-027 | 右键菜单 | native 菜单仍处于 active/popup 生命周期时再次右键 | 新的 popup 请求被抑制，只记录 dedupe，不重入 `Menu.popup` | 已覆盖 | `desktop-pet/electron/contextMenuDedup.test.ts` |
| PET-INT-028 | 右键菜单 | 连续多次真实右键打开并关闭菜单 | Electron 主进程保持存活，新增日志中 open/popup/closed 数量匹配且无 `context-menu:error`；脚本必须显式 `-AllowMouseControl` 才控制真实鼠标，退出时释放鼠标按钮、恢复鼠标位置和 Pet 窗口位置；脚本关闭菜单时只向 Pet owner window 投递消息，不向全局前台窗口发送 `Esc` | 已覆盖脚本 | `desktop-pet/scripts/stress-pet-right-click.ps1`, `desktop-pet/scripts/stressPetRightClickScript.test.ts` |
| PET-INT-029 | 相机调整 | 从 `Adjust Camera` 切回 `Drag Whole App` | 捕获当前 Pet MMD camera snapshot，按当前模型与 render pipeline 写入 Pet 本地存储 | 已覆盖 | `desktop-pet/src/mmd/petCameraState.test.ts` |
| PET-INT-030 | 相机初始化 | Pet 重新初始化同一模型与 render pipeline | 使用 Pet 本地存储的 camera snapshot 初始化 MMDStage，不复用其他模型/管线的镜头 | 已覆盖 | `desktop-pet/src/mmd/petCameraState.test.ts` |
| PET-INT-031 | 角色点击动作 | `Drag Whole App` 模式点击 MMD 角色 | 使用主站 `resolveStageCharacterClickInteraction()` 规则切换到 click reaction 动作，并显示点击 ripple | 已覆盖 | `desktop-pet/src/mmd/petStageState.test.ts`, `desktop-pet/src/window/dragRegion.test.ts` |
| PET-INT-032 | 角色点击动作 | 连续点击角色 | 优先选择 greeting/soft/strong 分类动作，且有其他可用动作时不重复上一次 click VMD | 已覆盖 | `desktop-pet/src/mmd/petStageState.test.ts` |
| PET-INT-033 | 角色点击动作 | 点击动作播放完成或失败 | 自动恢复当前模型的 Pet idle/autoplay loop | 已覆盖构建/类型 | `desktop-pet/src/App.tsx`, `desktop-pet/src/mmd/petStageState.test.ts` |
| PET-INT-067 | 启动待机动作 | desktop-pet 启动并加载当前模型 favorite VMD | renderer 首次可播放状态进入 `autoplay` idle loop，优先播放当前模型 `00_idle_loop` favorite VMD；无可播放 VMD 时才回退 procedural idle | 已覆盖 | `desktop-pet/src/mmd/petStageState.test.ts`, `desktop-pet/src/App.integration.test.ts` |
| PET-INT-034 | 窗口拖动 | `Drag Whole App` 模式下左键点击角色 | pointerdown/pointerup 继续传递给 MMD stage/hit-test，pointermove 才拦截用于拖动 | 已覆盖 | `desktop-pet/src/window/petWindowEvents.test.ts` |
| PET-INT-035 | 右键菜单 | 菜单按当前窗口置顶状态渲染 | `Always on Top` / `固定在顶部` 显示为 checkbox，勾选态等于主进程当前 `alwaysOnTop` 状态 | 已覆盖 | `desktop-pet/electron/petMenuModel.test.ts`, `desktop-pet/electron/electronMenuTemplate.test.ts` |
| PET-INT-036 | 窗口配置 | 点击右键菜单 `Always on Top` / `固定在顶部` | 主进程切换 `BrowserWindow.setAlwaysOnTop`，开启时使用 `floating` level，关闭时取消置顶并显示状态提示 | 已覆盖 | `desktop-pet/electron/petAlwaysOnTop.test.ts`, `desktop-pet/src/menu/menuActionStatus.test.ts` |
| PET-INT-037 | Codex 启动 | 右键 `New Codex Session` | 主进程写入 VSCode terminal request；development helper 模式用 `code --new-window --extensionDevelopmentPath <helper> <workspace>` 确保 helper 加载，并在 VSCode 内置终端 `Codex Pet` 执行 `codex`，不启动外部 `cmd.exe` | 已覆盖 | `desktop-pet/electron/codexLauncher.test.ts`, `desktop-pet/vscode-helper/extensionCore.test.ts` |
| PET-INT-038 | Codex 恢复 | 右键最近会话恢复 | 主进程写入 resume request，helper extension 在 VSCode 内置终端执行 `codex resume --cd <workspace> <session_id>`，保留原 `CODEX_HOME` session 存储 | 已覆盖 | `desktop-pet/electron/codexLauncher.test.ts`, `desktop-pet/vscode-helper/extensionCore.test.ts` |
| PET-INT-039 | Codex 启动 | workspace/helper 路径包含空格 | Windows shell 启动 VSCode 时对 CLI 路径参数加引号，确保 VSCode 打开 folder 而不是把路径片段作为 open editors | 已覆盖 | `desktop-pet/electron/codexLauncher.test.ts` |
| PET-INT-040 | Codex 启动 | VSCode helper 读取过期 terminal request | 超过 TTL 的 request 不执行，并删除 request 文件，避免后续打开 workspace 误启动 Codex | 已覆盖 | `desktop-pet/vscode-helper/extensionCore.test.ts` |
| PET-INT-041 | Workspace 选择 | 右键菜单打开 `Workspace` 子菜单 | 菜单显示当前 workspace 的可读名称，并提供 `Select Workspace...` / `选择工作区...` | 已覆盖 | `desktop-pet/electron/petMenuModel.test.ts` |
| PET-INT-042 | Workspace 持久化 | 用户选择新的 Codex workspace | 选择结果写入 Electron `userData/pet-settings.json`，下次启动优先使用该路径，缺失时回退 env/cwd 默认 workspace | 已覆盖 | `desktop-pet/electron/petSettingsStore.test.ts` |
| PET-INT-043 | Workspace 选择 | 选择 workspace 后触发 Codex 新建、恢复、打开 VSCode、session 扫描 | 主进程统一使用当前选中 workspace；恢复 session 时优先使用 session 自带 workspace，避免把历史会话恢复到错误目录 | 已覆盖构建/类型 | `desktop-pet/electron/main.ts`, `desktop-pet/electron/petSettingsStore.test.ts`, `desktop-pet/electron/codexLauncher.test.ts` |
| PET-INT-044 | 更多会话 | 右键点击 `More Sessions...` | 主进程拉取最多 50 条 session，renderer 在 Pet 内显示可搜索列表，不再显示 not-wired 状态 | 已覆盖 | `desktop-pet/src/codex/sessionPicker.test.ts`, `desktop-pet/src/menu/menuActionStatus.test.ts` |
| PET-INT-045 | 更多会话 | 在更多会话面板搜索 title/workspace/status | 搜索支持多关键词匹配，列表展示 title、workspace、状态和最近时间，不暴露原始 UUID-heavy 标签 | 已覆盖 | `desktop-pet/src/codex/sessionPicker.test.ts` |
| PET-INT-046 | 更多会话 | 点击更多会话面板中的 session | renderer 通过 `pet:sessions:restore` IPC 请求主进程恢复，主进程复用右键最近会话的 VSCode integrated terminal resume 流程 | 已覆盖构建/类型 | `desktop-pet/src/App.tsx`, `desktop-pet/electron/main.ts`, `desktop-pet/electron/codexLauncher.test.ts` |
| PET-INT-047 | Codex 状态 | 本地 JSONL 状态推断 | scanner 能从 rollout JSONL 推断 running、command_running、file_changed、waiting_approval、completed、failed、disconnected，并把未知/空事件视为 running | 已覆盖 | `desktop-pet/electron/codexSessionFiles.test.ts` |
| PET-INT-048 | VSCode helper | `MMD_PET_VSCODE_HELPER_MODE=installed` | Pet 新建/恢复 Codex terminal request 后执行 `code --new-window <workspace>`，不传 `--extensionDevelopmentPath`，由已安装 helper extension 处理 request；prompt fallback 仍复用 `code --reuse-window <workspace>` | 已覆盖 | `desktop-pet/electron/codexLauncher.test.ts` |
| PET-INT-072 | VSCode helper | VSCode/helper 未消费 terminal request | Pet 主进程在超时后检查同一 request id 是否仍残留，残留时记录 `codex-launch:terminal-request-unhandled` 并发布 failed 状态 | 已覆盖 | `desktop-pet/electron/mainIntegration.test.ts` |
| PET-INT-049 | VSCode helper | 未设置或设置未知 helper mode | Pet 回退 development 模式，传 `--new-window --extensionDevelopmentPath <desktop-pet/vscode-helper>`，避免复用未加载 helper 的 VSCode 窗口导致 request 文件残留 | 已覆盖 | `desktop-pet/electron/codexLauncher.test.ts` |
| PET-INT-050 | Prompt 发送 | 右键点击 `Send Prompt...` / `发送 Prompt...` | renderer 打开 Pet 内 prompt 面板，面板不会触发整窗拖动 | 已覆盖 | `desktop-pet/electron/petMenuModel.test.ts`, `desktop-pet/src/window/dragRegion.test.ts` |
| PET-INT-051 | Prompt 发送 | 在 prompt 面板发送非空文本且 relay/API 可用 | preload 通过 `pet:prompt:send` 请求主进程；主进程优先登记 workspace、创建/复用 Codex interactive session、打开 websocket，并发送 `{ type: "user_message", text, mode }`；状态源标记为 `app-server-relay` | 已覆盖 | `desktop-pet/electron/codexInteractiveRelay.test.ts`, `desktop-pet/electron/mainIntegration.test.ts`, `desktop-pet/electron/preloadModuleFormat.test.ts` |
| PET-INT-052 | Prompt 发送 | 发送空白 prompt | launcher 拒绝空白请求并返回 `prompt is required`，不会写入 terminal request | 已覆盖 | `desktop-pet/electron/codexLauncher.test.ts` |
| PET-INT-071 | Prompt fallback | relay/API 不可用或 websocket 连接失败 | 主进程记录 relay fallback，并退回 `mode=prompt` terminal request；VSCode helper 发送到 `Codex Pet` 内置终端，不改写 CLI `CODEX_HOME` session 存储 | 已覆盖 | `desktop-pet/electron/codexLauncher.test.ts`, `desktop-pet/electron/mainIntegration.test.ts` |
| PET-INT-053 | 更多会话 | 查看更多会话面板中的 session 摘要详情 | 每行显示 title、workspace、状态、最近时间、首条 prompt 预览和最近摘要；prompt/summary 可搜索、长文本截断，明显 token/password/secret/key 形式脱敏，点击行仍恢复对应 session，面板不触发整窗拖动 | 已覆盖 | `desktop-pet/src/codex/sessionPicker.test.ts`, `desktop-pet/src/window/dragRegion.test.ts` |
| PET-INT-054 | 主站同步 | 右键点击 `Sync from Main Site` / `从主站同步` | renderer 重新读取 shared config、模型和 VMD 资产；同步成功后显示模型名和 render pipeline，并递增 stage reload revision 让 MMDStage remount；真实主站保存流程按手工清单验收 | 已覆盖 | `desktop-pet/src/App.integration.test.ts`, `desktop-pet/src/menu/menuActionStatus.test.ts`, `desktop-pet/scripts/desktop-pet-manual-acceptance.md` |
| PET-INT-061 | Codex 状态动作 | JSONL scanner 发布 `running` / `command_running` / `file_changed` / `waiting_approval` / `completed` / `failed` / `disconnected` | renderer 纯函数映射为 motion intent、status tone、是否打断 idle；App 接入该结果，MMD 层把 intent 映射为 procedural status interaction | 已覆盖 | `desktop-pet/src/codex/codexStatus.test.ts`, `desktop-pet/src/mmd/petStageState.test.ts`, `desktop-pet/src/App.integration.test.ts` |
| PET-INT-062 | Codex 状态动作 | Codex 状态更新到达时角色正在播放 click reaction | Codex 状态动作不覆盖当前 click interaction，纯函数返回 `click-interaction` 优先级和 blocked reason | 已覆盖 | `desktop-pet/src/mmd/petStageState.test.ts` |
| PET-INT-069 | Codex 状态动作 | 活跃 Codex 状态的 procedural 动作播完 | `running`、`command_running`、`file_changed`、`waiting_approval` 等进行中状态会 replay 当前状态动作，不会在一个动作周期后长期落回待机；`completed`、`failed`、`vscode-opened` 只播放一次后可恢复待机 | 已覆盖 | `desktop-pet/src/mmd/petStageState.test.ts`, `desktop-pet/src/App.integration.test.ts` |
| PET-INT-070 | Codex 状态动作 | Codex 状态 motion intent 对应的 procedural action 没有 runtime 可播放命中 | App 用当前模型 `petAutoplayIdleState.interaction` 作为兜底，优先进入 favorite idle/autoplay VMD loop；如果兜底本身也没有可播放 VMD，则不向 MMDStage 应用新的 procedural idle，保留当前 stage interaction，避免重置到 T-pose/base pose | 已覆盖 | `desktop-pet/src/mmd/petStageState.test.ts`, `desktop-pet/src/App.integration.test.ts` |
| PET-INT-063 | Codex 审批 | JSONL scanner 推断 `waiting_approval` | Pet 只显示审批 fallback message 和 `Open VSCode` 动作；preload 通过 `pet:vscode:focus` 聚焦 VSCode；由于没有 approval id，不能显示或执行 approve/deny | 已覆盖 | `desktop-pet/src/codex/approvalFallback.test.ts`, `desktop-pet/src/App.integration.test.ts`, `desktop-pet/electron/preloadModuleFormat.test.ts` |
| PET-INT-072 | Codex 审批 | relay 状态收到 `approval_required` 且带 approval id | Pet 状态条显示 direct `Approve`/`Deny`；点击后 preload 调 `pet:approval:decide`，主进程调用 `POST /codex/interactive/{session_id}/approvals/{approval_id}`，成功后移除该 pending approval | 已覆盖 | `desktop-pet/electron/codexInteractiveRelay.test.ts`, `desktop-pet/src/codex/approvalFallback.test.ts`, `desktop-pet/src/App.integration.test.ts`, `desktop-pet/electron/preloadModuleFormat.test.ts` |
| PET-INT-073 | Codex 状态 | relay websocket 收到 text/command/file/approval/completion/failure 事件 | 主进程把 relay event 折叠为 `running`、`command_running`、`file_changed`、`waiting_approval`、`completed`、`failed`、`disconnected`，并保留最多若干行最近输出供 renderer 状态卡显示最多 3 行 | 已覆盖 | `desktop-pet/electron/codexInteractiveRelay.test.ts`, `desktop-pet/src/codex/codexStatus.test.ts`, `desktop-pet/src/App.integration.test.ts` |
| PET-INT-064 | Codex 通知详情 | Notification Detail 为 `low` / `medium` / `high` | low 只显示短状态，不包含 workspace/path/session id；medium 显示可读 session/workspace basename 或错误；high 可包含完整 workspace path、session id、更新时间等诊断信息，App 状态条按当前菜单配置使用该格式 | 已覆盖 | `desktop-pet/src/codex/notificationDetail.test.ts`, `desktop-pet/src/App.integration.test.ts` |
| PET-INT-057 | 偏好持久化 | 重启 desktop-pet | `Language / 语言`、`Notification Detail`、`Always on Top` 和当前 workspace 从 Electron `userData/pet-settings.json` 初始化，菜单勾选态与语言使用持久化值 | 已覆盖 | `desktop-pet/electron/petSettingsStore.test.ts`, `desktop-pet/electron/petMenuModel.test.ts` |
| PET-INT-058 | 偏好持久化 | 写入新的 workspace 或菜单偏好 | settings 写入采用 merge，更新 `selectedWorkspacePath` 不丢失 language、notification、always-on-top 或 window bounds | 已覆盖 | `desktop-pet/electron/petSettingsStore.test.ts` |
| PET-INT-059 | 偏好持久化 | settings 文件缺失、legacy workspace-only 或损坏 | 缺失/损坏文件容错回退默认；旧版只含 workspace 的文件继续可读，不强行补写新偏好默认值 | 已覆盖 | `desktop-pet/electron/petSettingsStore.test.ts` |
| PET-INT-060 | 窗口位置持久化 | 保存/恢复 Pet window bounds | drag end 或关闭时保存当前位置；恢复时只使用 x/y，width/height 固定归一为 320x420，避免异常 resize 跨重启保留 | 已覆盖 | `desktop-pet/electron/petSettingsStore.test.ts`, `desktop-pet/electron/petWindowOptions.test.ts` |
| PET-INT-065 | API runtime | FastAPI API 未运行且未开启 autostart | Electron helper 返回 `state=unavailable`、`available=false`、health URL、失败原因、attempts 和 checkedAt；主进程启动时调用 helper 并发布 runtime status；renderer 显示 API unavailable 与 Retry，后续继续使用本地 session fallback | 已覆盖 | `desktop-pet/electron/apiRuntime.test.ts`, `desktop-pet/electron/mainIntegration.test.ts`, `desktop-pet/electron/preloadModuleFormat.test.ts`, `desktop-pet/src/App.integration.test.ts` |
| PET-INT-066 | API runtime | `MMD_PET_API_AUTOSTART=1` 且配置启动命令 | Electron helper 为 API 启动命令创建 stdout/stderr 日志路径，用 hidden detached background process 启动，并重试 `/healthz`；含空格路径保持为单条 shell command；可用时通过 `pet:api-runtime:changed` 通知 renderer 自动重载 Pet MMD 状态 | 已覆盖 | `desktop-pet/electron/apiRuntime.test.ts`, `desktop-pet/electron/mainIntegration.test.ts`, `desktop-pet/src/App.integration.test.ts` |

## 更新规则

- 修改交互行为前，先在本目录新增或更新对应用例。
- 对已自动化的用例，`自动化状态` 标为 `已覆盖`，并写明测试文件。
- 对需要真实桌面、真实鼠标或视觉确认的行为，标为 `已覆盖清单`，并写明固定脚本或清单路径；可脚本化时优先转为 `已覆盖脚本`。
- 若实际测试文件删除、重命名或移动，需要同步修正本目录。
