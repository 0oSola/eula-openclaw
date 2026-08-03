# 工作流术语表

## Codex 启动目标

- 英文机器名：`CodexLaunchTarget`
- 设置字段：`codexLaunchTarget`
- 枚举值：
  - `vscode-cli`：通过 VSCode 内置终端启动 Codex CLI。
  - `codex-desktop`：通过 `codex://` 协议打开 Codex Desktop 新任务界面。
- 允许用法：描述 Desktop Pet 新建 Codex 会话时选择的宿主工具。
- 禁止用法：不得把它等同于“编程助手”；`agent=codex|claude` 决定助手类型，`codexLaunchTarget` 只决定 Codex 的新建入口。
- 路由影响：仅影响 `new-session` 且当前 `agent=codex` 的分支；恢复历史会话和 Claude 新建会话不受影响。
- 完整定义：见 `workflow/concepts/codex-launch-target.zh-CN.md`。
# Codex Desktop SSH 项目

- 英文机器名：`CodexDesktopProject`
- 含义：Codex Desktop 自己登记并通过 `remote-ssh-codex-managed:<name>` 管理的远程项目对象；远程 `path` 是远端 cwd，不得按本地目录处理。
- 允许用法：用于 `desktop-pet` 的项目发现、菜单选择和设置持久化。
- 禁止用法：不得把它等同于 VS Code Remote-SSH URI，也不得在未确认协议时伪造 Codex Desktop 私有 IPC。
- 路由影响：写入独立的 `selectedCodexDesktopProject`；远程新任务必须先显示 Pet 原生确认框，取消时不打开，确认后复制远程路径并打开 `codex://threads/new` 未绑定入口，再提示用户手工打开 Desktop 项目选择器并粘贴；无参数 `codex://new` 是空路由，外部快捷键模拟不可靠，两者都禁止作为降级入口。不能声称已把 `hostId` 或 `projectId` 传给 Desktop，也不能暗示 Desktop 会自动弹出项目选择器。
# 远程项目目录

- 英文机器名：`RemoteProjectCatalog`
- 含义：合并 Codex Desktop 正式项目、受限系统 SSH Git 扫描和最近成功缓存的远程项目选择目录。
- 允许用法：远程项目刷新、搜索、收藏、选择、状态展示和打开降级。
- 禁止用法：不得表示整机文件浏览；不得把猜测的 deeplink 当作正式项目打开链接。
- 路由影响：菜单只消费目录快照；日志解析、SSH 扫描、去重和缓存留在目录模块内部。
- 完整定义：见 `workflow/concepts/remote-project-catalog.zh-CN.md`。

# 受限远程 Codex 账号

- 英文机器名：`sola-codex` / `macCodex-pet`
- 含义：仅供 Desktop Pet 启动远端 Codex CLI 的 macOS 专用 SSH 账号和 Windows OpenSSH Host。该账号仅能读写 `/Users/sola/workspace/**` 与 `/Users/sola/Desktop/kscc/**`，拥有独立的 `~/.codex`。
- 允许用法：远程项目扫描与远端 Codex CLI 启动。
- 禁止用法：不得复用 `sola` 的 SSH Key、`~/.codex`、会话或账号权限；不得将任意 UI 输入直接作为 SSH Host、远端路径或 Shell 命令执行。
- 路由影响：远程项目选择保存 `sshHost=macCodex-pet`；`agent=codex` 且新建会话时，由 Windows Terminal 启动 `ssh -tt macCodex-pet`，在白名单项目目录执行受限账号自己的 Codex CLI。该路线不读取本机 `CODEX_HOME`，因此不启动本地会话 watcher。

# Reze Design 舞台配置

- 英文机器名：`reze-design`
- 含义：当前项目 `renderPipeline` 的独立枚举值；使用 MIT 许可的 `reze-engine` WebGPU 引擎加载 PMX/VMD，并采用用户指定的 Reze Design 灯光、泛光与相机构图，页面仍复用 MIO 星海背景。
- 允许用法：主站渲染模式选择、桌面 Pet 共享配置、校准页面 query 参数和 `RenderPipeline` 类型值。
- 禁止用法：不得把 WebGPU 兼容性失败静默伪装为 Three.js 成功渲染；不得把 reze-engine 的 IK/物理说成已复用 Three.js Grant solver、点击或口型链路；不得替代既有 `reze-npr` 配置。
- 路由影响：选择后由 `RezeWebGpuStage` 创建 `Engine`，真实执行 `init → loadModel → autoStyleGroups → runRenderLoop`；页面同时展示 MIO 星海背景。浏览器无 WebGPU 或 PMX 解析失败时在舞台内显示失败原因，用户可切换至 `reze-npr`（WebGL）恢复既有 Three.js 兼容路径。
- 调试影响：在主站的 `reze-design` 或 `reze-npr` 会话中，点击左侧主导航“工具 / 立方体”按钮打开“场景 / 材质”实时调试器。Dock 必须占满当前视口高度，长内容仅在编辑器主体内滚动。`reze-design` 的场景参数映射至引擎的 world、sun、bloom、ground 和 camera；`reze-npr` 映射至 Three.js 运行时的同类场景参数。材质预设分别写入当前运行时内存，且不写入 PMX、VMD、共享配置或动作资产。
- 透明合成影响：两种 Reze 舞台 canvas 均保持透明，由 MIO CSS 星海背景承接未绘制区域。`reze-npr` 不得启用会回填不透明黑底的 `UnrealBloomPass`；可保留 alpha 安全的调色和轮廓后处理。
- 本地导入影响：资产页可选择含单一 PMX 与完整贴图的本地目录；其 `File[]` 仅在当前浏览器会话内传给 reze-engine 文件映射加载器，刷新后失效，不上传服务器，不改变共享模型配置。
- 场景文档影响：按 `userId + renderPipeline + modelPath` 保存 Reze 场景 JSON，包含场景参数、调色、背景效果和可执行材质图预设；Reze Design 与 Reze NPR 的相机/灯光默认值不得跨管线复用。材质键采用 `mesh:<遍历序号>:material:<槽位>`，不得使用运行时 UUID。
- 资产与导出影响：编辑器资产页复用主站模型目录与 VMD 导入；渲染页当前导出 WebGPU canvas PNG，不包含 CSS 层的 MIO 星海背景。
- 完整定义：见 `workflow/concepts/reze-design-stage.zh-CN.md`。
