# Message Bridge 后续补齐 Todo

- [x] 前端消息列表自动同步后端新增消息。
- [x] 设置面板支持查看 Feishu session 并切换默认绑定。
- [x] Bridge 设置变更后支持运行时禁用/关闭连接。
- [x] 切换默认绑定时释放旧订阅，避免旧 session 继续写入。
- [x] OpenClaw WebSocket RPC 等待响应时不丢实时事件。
- [x] 完成定向测试、基础检查和前端构建验证。
- [ ] Daily podcast 完成后，回头评估旧的 Voice Workflow 音频链路是否统一优先消费 `audio/ogg` 来提升浏览器播放速度。实时 TTS/chunk 先不改，等确认 Voice 服务格式支持并完成首音频延迟 benchmark 后再决定；当前安全策略先记为：`audio/ogg` 优先、`audio/wav` 兜底、用 ranged `GET bytes=0-1023` 探测。
