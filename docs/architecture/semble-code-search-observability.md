# Semble Code Search Observability

更新时间：2026-05-18

Semble CLI 用于项目内语义代码检索。它不替代 `rg`：精确字符串、接口路径、函数名和文件名仍优先用 `rg`；当问题是“某个业务意图在哪里实现”且关键词不确定时，再用 Semble。

## 使用方式

PowerShell 下使用项目 wrapper，避免 Semble 输出 Unicode 时触发 GBK 编码错误：

```powershell
scripts\semble-search.ps1 "message bridge auto tts greeting storage audio" api\app -TopK 5
scripts\semble-search.ps1 "where companion right rail renders trace card" web\src -TopK 3
scripts\semble-search.ps1 "podcast latest audio proxy route" api\app -TopK 5
scripts\semble-savings.ps1
```

搜索范围先限定到 `api/app`、`web/src` 或 `docs`。只有需要跨全仓库定位时才搜索 `.`，否则首次建索引会比较慢。

## 观测方法

每次 Semble 对排障或开发有明显帮助时，记录：

- 查询语句、范围、模式、TopK
- 命中是否直接指向要读的文件
- 后续实际打开的文件数量
- 如果用传统 `rg + read`，预计需要读多少文件或多少片段
- `scripts\semble-savings.ps1` 的累计估算

Semble 自带 `savings` 是估算值，用于趋势观察，不作为精确 token 账单。

## 观测记录

| 日期 | 查询 | 范围 | 结果 | 耗时/备注 | Savings 读数 |
| --- | --- | --- | --- | --- | --- |
| 2026-05-18 | `message bridge auto tts greeting storage audio` | `api/app` | 直接命中 `services/message_tts_reference.py`、`services/message_bridge.py`、`routes/message_service.py` | 首次索引用时约 107s；适合后续缓存后复用；wrapper 复测约 2s | 当前总计 5 次 search，约 `66.1k tokens`，`92%` |
| 2026-05-18 | `where companion right rail renders trace card` | `web/src` | 直接命中 `app/companion/CompanionRightRail.tsx` | 设置 `PYTHONIOENCODING=utf-8` 后正常输出；未设置时 PowerShell GBK 报 UnicodeEncodeError | 同上 |

## 当前限制

- Windows PowerShell 直接运行 `semble ...` 可能因 GBK 编码失败；使用 `scripts\semble-search.ps1` 和 `scripts\semble-savings.ps1`。
- 首次搜索某个大目录会慢；后续命中缓存后再观察真实收益。
- 当前只接入 CLI，没有接入 Codex 全局 MCP。
