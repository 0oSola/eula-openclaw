# Companion 右侧工作区切换设计

**日期：** 2026-05-03

**状态：** 已确认

**范围：** `web/src/app/companion/page.tsx`

## 目标

把当前 `/companion` 页面里的右侧固定信息栏升级为统一的“右侧工作区”容器，由左侧菜单栏负责切换右侧显示内容。

这次设计的第一优先级是建立稳定的信息架构与状态模型，不直接引入新的复杂业务逻辑。

## 当前现状

当前页面已经具备以下基础：

- 左侧菜单栏已经有一组明确的导航语义：`menu / chat / tasks / tools / memory / skills`
- 右侧区域当前是固定的 `Next Steps / Memory / Trace` 三张卡片
- 左侧按钮当前只有视觉激活态，尚未驱动右侧内容切换
- 页面已有右侧栏折叠态 `isRightRailCollapsed`
- 页面已有聊天消息状态 `messages`

这意味着现有代码已经接近“可切换工作区”的结构，只差一个统一的面板状态层与右侧渲染入口。

## 核心设计

### 1. 左侧菜单统一控制右侧区域

左侧菜单栏不再只是装饰导航，而是右侧区域内容的唯一一级入口。

统一规则：

- 左侧一次只允许一个主菜单处于激活状态
- 激活哪个菜单，右侧就渲染对应工作区
- 右侧折叠后不丢失当前激活工作区
- 再展开时恢复到折叠前的工作区内容

### 2. `menu` 的语义改为 `overview`

左侧第一个按钮 `menu` 不再打开高级模式。

它的职责改为：

- 唤出右侧 `overview` 视图
- 承载当前 3 张固定卡片

这让左侧所有主按钮都遵循同一规则：点击后切换右侧整栏。

### 3. 右侧区域抽象为 Workspace

建议把右侧面板统一抽象为 `workspace`。

建议主状态：

```ts
type CompanionWorkspace =
  | "overview"
  | "chat"
  | "tasks"
  | "tools"
  | "memory"
  | "skills";
```

说明：

- `overview` 对应现在的默认综合信息视图
- `chat` 对应右侧消息列表
- 其它按钮映射为后续独立工作区

### 4. 第二个按钮 Chat 的职责

第二个按钮点击后，右侧区域应被整体替换为 `chatbox` 消息列表，而不是当前右侧卡片的一部分。

`chat` 工作区建议包含：

- 顶部标题
- 搜索入口
- 角色过滤
- 当前会话消息列表
- 跳到最新消息

第一阶段先使用现有 `messages` 做当前会话消息流，不要求一开始就完成多会话系统。

### 5. 右侧工作区的统一外壳

不管是 `overview / chat / tasks / tools / memory / skills`，右侧都建议共用一个外壳：

- 统一折叠/展开行为
- 统一内容容器
- 统一空状态逻辑

建议结构：

```tsx
<section className="mio-right-rail">
  <RightRailWorkspace workspace={activeWorkspace} />
</section>
```

## 信息架构建议

### `overview`

保留当前三张卡片，作为默认总览页：

- Next Steps
- Memory Summary
- Trace Status

### `chat`

用于展示 chatbox 消息流：

- Message Stream
- Search / Filter
- Recent Context

### `tasks`

后续承接任务拆解、执行步骤、状态跟踪：

- Current Plan
- Step Status
- Suggested Actions

### `tools`

后续承接工具、能力调用、运行记录：

- Available Tools
- Recent Tool Runs
- Tool Status

### `memory`

后续承接长期记忆与偏好：

- Memory Notes
- User Preferences
- Saved Context

### `skills`

后续承接技能/插件能力：

- Installed Skills
- Skill Summary
- Suggested Skill Use

## 推荐状态模型

建议新增以下页面状态：

```ts
const [activeWorkspace, setActiveWorkspace] = useState<CompanionWorkspace>("overview");
```

并把左侧导航定义提升为可驱动配置：

```ts
const navItems = [
  { key: "menu", label: "菜单", workspace: "overview" },
  { key: "chat", label: "对话", workspace: "chat" },
  { key: "tasks", label: "任务", workspace: "tasks" },
  { key: "tools", label: "工具", workspace: "tools" },
  { key: "memory", label: "记忆", workspace: "memory" },
  { key: "skills", label: "能力", workspace: "skills" },
] as const;
```

交互规则：

- 点击已激活菜单：不切换、不清空状态
- 点击其它菜单：切换 `activeWorkspace`
- 若右侧已折叠，点击左侧菜单时自动展开右侧栏

```ts
function handleWorkspaceChange(next: CompanionWorkspace) {
  setActiveWorkspace(next);
  setIsRightRailCollapsed(false);
}
```

## Chat 工作区的数据策略

第一阶段不做真正的多会话系统，先做兼容当前聊天状态的消息视图。

建议先直接复用 `messages`，并派生可显示列表。

建议结构：

```ts
type ChatboxMessageItem = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status?: "idle" | "sending" | "error";
  emotion?: string;
  action?: string;
};
```

## 推荐组件拆分

为了避免 `page.tsx` 继续膨胀，建议在实现时拆出以下组件：

- `CompanionRightRail`
- `CompanionWorkspaceOverview`
- `CompanionChatbox`

第一阶段最少也建议把右侧区域单独拆成 `CompanionRightRail.tsx`。

## 分阶段实现建议

### Phase 1: 统一切换骨架

- 引入 `activeWorkspace`
- 左侧按钮真正可切换
- 右侧区域改为统一工作区渲染入口
- `overview` 保留当前三张卡片
- `chat` 先落地 chatbox 消息流 UI

### Phase 2: 右侧内容组件化

- 把 `overview` 和 `chat` 拆组件
- 统一右侧标题和空状态
- 为 `tasks/tools/memory/skills` 建占位视图

### Phase 3: 数据接入

- 接入真实任务、工具、记忆、技能数据源
- 把当前 overview 卡片逐步下沉到对应垂直视图

## 验收标准

- 左侧菜单只能激活一个主项
- 点击左侧 `menu` 时，右侧整栏切换到 `overview`
- `overview` 中显示当前 3 张固定卡片
- 点击左侧 `chat` 时，右侧整栏切换为 chatbox 消息列表
- 右侧切换不影响中间舞台与底栏输入区
- 右侧折叠后再次展开，保持上一次激活的 workspace
- 不引入新的全局滚动条
- 不破坏现有底栏高级功能面板行为

## 风险与注意点

- `page.tsx` 当前已经较大，继续把所有 workspace 直接塞进去会很快失控
- `chat` 这个词在页面里已经同时表示“聊天输入”和“舞台对话反馈”，实现时要明确区分：
  - 底栏是 message composer
  - 舞台左上是 latest assistant bubble
  - 右侧 `chat` 是 current message stream workspace
- 高级功能面板如果继续保留，需要保持它只属于底栏按钮，不再与左侧导航绑定

## 建议的下一步

下一步直接进入 Phase 1，把右侧区域改造成统一工作区容器，并优先完成：

- `menu -> overview`
- `chat -> chatbox`
