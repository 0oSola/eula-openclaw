# 04 — 运行时增强与活跃状态生命周期

**What to build:** Pet 持续发现已经运行的 Agent，并结合文件、事件、进程和运行时信号判断 running、idle、completed、failed 和 disconnected。

**Blocked by:** 02 — 本地 Codex 全局会话发现；03 — Claude 与 Pet 运行时会话融合

**Status:** ready-for-agent

- [ ] Pet 启动后自动刷新全局会话，不要求用户先打开右键菜单或先选择工作区。
- [ ] 进程观察能够补充 runtime、pid 和 startedAt，但不能凭孤立进程伪造 session。
- [ ] 活跃状态使用集中计算规则和可注入时钟。
- [ ] 支持多个工作区、多个 Agent、多个并发会话。
- [ ] workspace/agent 切换不会让旧异步结果覆盖全局发现快照。
- [ ] 扫描与刷新不进入原生菜单 popup 临界路径。
