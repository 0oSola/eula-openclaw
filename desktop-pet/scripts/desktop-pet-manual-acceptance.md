# Desktop Pet Manual Acceptance Checklist

更新时间：2026-06-04

本清单用于补齐需要真实桌面、真实鼠标或用户视觉确认的 desktop-pet 交互验收。执行前先启动 API、主站和 desktop-pet，并确认 Pet 窗口中已经加载真实 MMD 模型。

## 准备

- [ ] 在 `desktop-pet` 目录运行 `.\start-pet.ps1`；如已有 Pet 正在运行，脚本会直接返回现有 PID，不重复启动。
- [ ] 需要强制新开实例时运行 `.\start-pet.ps1 -ForceNew`。
- [ ] 需要前台查看 Vite/Electron 日志时，可手动分两步运行：`npm run dev`，再另开终端执行 `$env:MMD_PET_DEBUG_EVENTS="1"; $env:MMD_PET_DEBUG_EVENTS_LOG="D:\workspace\MMD project\.worktrees\desktop-mmd-codex-pet\desktop-pet-debug-events.ndjson"; npm run dev:electron`。
- [ ] 确认 Pet 窗口可见，右键菜单可打开，日志文件持续写入 `context-menu:*` 事件。

## 自动脚本

这些脚本会控制真实鼠标。默认不执行真实输入，必须显式传 `-AllowMouseControl`，并建议在空闲桌面会话中运行；脚本结束或失败时会释放鼠标按钮、恢复鼠标位置，并把 Pet 窗口恢复到测试前位置。

### PET-INT-024 屏幕边缘右键菜单

运行短烟测：

```powershell
.\scripts\stress-pet-right-click.ps1 -AllowMouseControl -EdgePlacement BottomRight -SequentialClicks 5 -BurstClicks 0 -MaxWindowDriftPx 16
```

通过标准：

- [ ] 脚本输出 `edgePlacement=BottomRight`。
- [ ] `contextMenuPopupCount` 大于等于 `sequentialClicks`。
- [ ] `contextMenuClosedCount` 大于等于 `sequentialClicks`。
- [ ] `contextMenuErrorCount=0`。
- [ ] `before` 与 `after` 的 x/y 漂移不超过 `MaxWindowDriftPx`，width/height 不变。
- [ ] 过程中 Pet 位于屏幕右下边缘，菜单仍在可见屏幕内打开，Electron 进程没有退出。

长压力版本：

```powershell
.\scripts\stress-pet-right-click.ps1 -AllowMouseControl -EdgePlacement BottomRight -SequentialClicks 20 -BurstClicks 3 -MaxWindowDriftPx 16
```

## 固定手工清单

### 启动

- [ ] `npm run dev` 后 renderer 固定在 `http://127.0.0.1:5174` 或当前覆盖端口。
- [ ] `npm run dev:electron` 后 Pet BrowserWindow 为透明 frameless 小窗，模型加载完成。
- [ ] 状态条没有持续显示启动失败、模型加载失败或 API 连接错误。

### 右键

- [ ] 在 Pet 中央右键，菜单打开在 Pet 附近。
- [ ] 连续右键打开、关闭菜单 5 次，菜单不跑到窗口左上角或屏幕远端。
- [ ] 执行 PET-INT-024 短烟测后，日志中无 `context-menu:error`。

### 拖动

- [ ] 右键菜单选择 `Interaction Mode` -> `Drag Whole App`。
- [ ] 左键按住 Pet 空白或角色区域拖动，窗口随鼠标移动。
- [ ] 松开后窗口尺寸保持 320x420 附近，不发生 resize/maximize/fullscreen。
- [ ] 右键按下不会启动窗口拖动。

### PET-INT-025 相机

- [ ] 右键菜单选择 `Interaction Mode` -> `Adjust Camera`。
- [ ] 鼠标滚轮 zoom in / zoom out，角色缩放可见且窗口不移动。
- [ ] 左键拖动 rotate，角色视角变化可见且窗口不移动。
- [ ] 使用 OrbitControls pan 操作方式进行 pan，角色在窗口内平移可见且窗口不移动。
- [ ] 右键菜单切回 `Interaction Mode` -> `Drag Whole App`。
- [ ] 切回后左键拖动会移动整个 Pet，不再调整相机。
- [ ] 切回时保存镜头：关闭并重启 desktop-pet 后，同一模型和 render pipeline 恢复到刚才保存的 zoom/pan/rotate 结果。
- [ ] 切换到不同模型或 render pipeline 时，不复用上一模型的 Pet camera snapshot。

### 同步

- [ ] 在主站 `/companion` 选择模型与 render pipeline，并点击保存到桌面 Pet。
- [ ] 在 Pet 右键菜单点击 `Sync from Main Site` / `从主站同步`。
- [ ] Pet remount 后显示主站保存的模型与 render pipeline。
- [ ] 同步后再执行 PET-INT-025，确认同一模型/管线的镜头仍按 Pet 本地 snapshot 规则保存与恢复。

### Codex 新建

- [ ] 右键菜单打开 `Workspace`，确认当前 workspace 名称正确。
- [ ] 点击 `New Codex Session`。
- [ ] VSCode 打开或聚焦当前 workspace，并在内置终端 `Codex Pet` 执行 `codex`。
- [ ] Pet 常驻状态条从 `starting` / `launched` 进入 running 类状态。

### Codex 恢复

- [ ] 右键菜单打开 `Recent Sessions` 或 `More Sessions...`。
- [ ] 选择一条最近 session。
- [ ] VSCode 内置终端执行 `codex resume --cd <workspace> <session_id>`。
- [ ] Pet 常驻状态条显示恢复中的 session 状态，且没有创建外部 `cmd.exe`。

## 记录

- 执行人：
- 日期：
- Electron 版本：
- Windows 显示器布局：
- PET-INT-024 脚本输出摘要：
- PET-INT-025 重启恢复结果：
- 异常与日志路径：
