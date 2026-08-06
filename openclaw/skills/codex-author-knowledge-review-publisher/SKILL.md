---
name: codex-author-knowledge-review-publisher
description: Use when OpenClaw receives a bounded Codex author knowledge delivery and must perform Vault topic resolution, two independent reviews, exact Change Set freezing, and memory-wiki publication.
---

# Codex 作者知识审核与发布

## 外部链路

```text
Codex → Pet → FastAPI → OpenClaw → memory-wiki → Obsidian
```

OpenClaw 只接收 FastAPI 推送的候选级有界交付，不读取本地 Codex transcript、
仓库或绝对路径。

候选接收契约：

```http
POST /v1/apps/mmd/codex-author-knowledge/workspaces/{workspace_key}/deliveries
Authorization: Bearer <FastAPI service token>
```

请求使用：

```json
{
  "kind": "codex_author_knowledge_delivery_batch",
  "schema_version": 1,
  "workspace_key": "mmd-project",
  "items": [
    {
      "kind": "codex_author_knowledge_delivery",
      "schema_version": 1,
      "delivery_id": "delivery_...",
      "candidate_payload": {},
      "payload_sha256": "sha256:...",
      "idempotency_key": "codex-author-knowledge:delivery_..."
    }
  ]
}
```

同一 `delivery_id` 和相同 payload 只能返回 `duplicate`；相同 ID 搭配不同
payload 必须返回 `idempotency_conflict`，不能覆盖既有审核任务。

## 审核顺序

1. 保存候选、证据、候选 revision 和运行状态；
2. 使用 `wiki_status`、`wiki_search`、`wiki_get` 创建 Vault snapshot；
3. 进行内容审核：确认定义、边界、不变量、技术方案和证据；
4. 生成 `create/update/merge/supersede` 提案和完整 diff；
5. 进行独立发布审核：确认 action、目标文件、Markdown、affected files 和 diff；
6. 两次审核都通过后冻结 Accepted Wiki Change Set；
7. Publisher 只能执行冻结版本，不能重新生成正文或更换目标。

`multiple_matches`、`conflict`、`stale_or_invalid_page`、缺证据或内容审核
拒绝均不得产生可发布 Change Set。

## Publisher 规则

发布前必须重新检查：

- Vault Git revision；
- 目标文件 base hash；
- 所有 affected path 都在配置的知识根目录内（测试默认 `projects/`）；
- approved Markdown hash；
- approved diff hash；
- Vault 没有无关 dirty files。

执行顺序固定为：

```text
exact apply
→ actual diff hash check
→ wiki_lint
→ wiki_compile
→ 复核 dirty paths == Change Set allowlist
→ stage allowlisted files
→ commit with audit trailers
→ push
→ Publication Receipt
```

任一步失败都不能标记 `published`。如果已经写入文件，必须用预检快照回滚
本次变更，不得触碰无关文件；但如果 Git 已经创建了本次提交而 push 失败，
不能用旧 revision 自动 reset，必须停在失败状态并保留提交信息，交给运维按
Git 事实修复。

## 发布回执审计回流

OpenClaw 生成 `Publication Receipt` 后，可以通过：

```http
POST /codex/knowledge/publication-receipts
X-Codex-Knowledge-OpenClaw-Token: <OpenClaw audience token>
```

把回执镜像到 FastAPI 的独立审计表。这个回流只用于保存最终状态、按
`change_set_id + receipt_hash` 做幂等和不可变冲突检查，以及供后续查询和审计使用。
它不创建新的 candidate delivery，不重新触发审核，也不改变前向链路
`Codex → Pet → FastAPI → OpenClaw → memory-wiki → Obsidian`。

实现边界：

- `openclaw/project_knowledge/review_publisher.py` 提供可持久化的审核状态机和
  memory-wiki 操作端口；
- 实际 OpenClaw HTTP 路由和 memory-wiki 插件调用由运行时适配器接入；
- 本项目测试使用注入式 fake memory-wiki，不写真实 Obsidian Vault。
