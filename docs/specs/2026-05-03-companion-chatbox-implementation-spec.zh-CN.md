# Companion Chatbox 实现级设计

**日期：** 2026-05-03

**状态：** 已确认

**范围：**

- `web/src/app/companion/page.tsx`
- 新增右侧栏相关组件

## 目标

把 `/companion` 页面的右侧固定信息栏改造成可切换的右侧工作区，并优先落地 `chat` 视图。

这次实现级设计只覆盖：

- 左侧导航与右侧整栏切换关系
- `menu` 与 `overview` 的关系
- `chatbox` 作为右侧消息列表视图的组件、状态与 DOM 结构

不覆盖：

- 多会话系统
- 新后端接口
- 底栏输入框重构

## 需求结论

### 左侧导航统一为右侧视图切换器

- `menu`：切换到 `overview`
- `chat`：切换到消息列表
- `tasks / tools / memory / skills`：切换到各自右侧视图

### 切换边界

- 只替换右侧整栏
- 中间 stage 常驻
- 底栏 `CompanionCommandBar` 常驻，不参与右侧切换

### `overview` 的定义

`overview` 是右侧默认总览视图，承载当前 3 张固定卡片：

- `下一步建议`
- `记忆摘要`
- `Trace / 请求状态`

### `chat` 的定义

- `chat` 视图显示当前会话的消息列表
- 不是会话列表
- 不是第二个输入框
- 不是舞台气泡替代物

### 高级功能的归属

- 左侧 `menu` 不再打开高级功能
- 当前高级功能面板如果保留，继续由底栏按钮触发

## 目标结构

页面视觉和职责拆分为五块：

1. 顶部 HUD
2. 左侧导航栏
3. 中间舞台区
4. 右侧工作区
5. 底部命令栏

其中只有第 4 块会被左侧导航切换。

## 状态模型

### 页面级状态

建议新增：

```ts
type RightPanelView = "overview" | "chat" | "tasks" | "tools" | "memory" | "skills";

const [activeRightPanelView, setActiveRightPanelView] = useState<RightPanelView>("overview");
```

说明：

- `menu` 映射为 `overview`
- 默认激活 `overview`

### 导航配置

建议把左侧按钮定义改为：

```ts
const navItems = [
  { key: "menu", label: "菜单", kind: "view", view: "overview" },
  { key: "chat", label: "对话", kind: "view", view: "chat" },
  { key: "tasks", label: "任务", kind: "view", view: "tasks" },
  { key: "tools", label: "工具", kind: "view", view: "tools" },
  { key: "memory", label: "记忆", kind: "view", view: "memory" },
  { key: "skills", label: "能力", kind: "view", view: "skills" },
] as const;
```

### `chatbox` 局部状态

建议放到 `CompanionChatbox` 内部：

```ts
const [chatSearch, setChatSearch] = useState("");
const [chatRoleFilter, setChatRoleFilter] = useState<"all" | "user" | "assistant" | "system">("all");
const [showJumpToLatest, setShowJumpToLatest] = useState(false);
```

可以继续使用 ref：

```ts
const listRef = useRef<HTMLDivElement | null>(null);
```

## 交互规则

### 左侧导航

- 点击任一左侧按钮：
  - 设置 `activeRightPanelView`
  - 自动展开右侧栏 `setIsRightRailCollapsed(false)`
- 当前激活态由 `activeRightPanelView` 决定
- `menu` 的激活本质上就是 `activeRightPanelView === "overview"`

建议事件：

```ts
function handleRightPanelViewChange(view: RightPanelView) {
  setActiveRightPanelView(view);
  setIsRightRailCollapsed(false);
}
```

### `chatbox`

- 初次切入 `chat` 视图时，消息列表滚到底部
- 新消息到达时：
  - 如果用户在底部附近，自动跟随到底
  - 如果用户已经上滑阅读，不打断阅读
- 用户不在底部且有新消息时，显示“跳到最新”
- 搜索和角色过滤只影响右侧显示，不影响底层 `messages`

## 组件拆分

建议新增两个组件：

### `CompanionRightRail.tsx`

职责：

- 接收右侧当前视图
- 渲染统一右侧外壳
- 根据 view 切换内部内容

建议 props：

```ts
type CompanionRightRailProps = {
  collapsed: boolean;
  activeView: RightPanelView;
  messages: ChatMessage[];
  loading: boolean;
  error: string;
  ttsEnabled: boolean;
  nextSteps: string[];
  memoryNotes: string[];
  traceRows: readonly (readonly [string, string, string, string])[];
  onToggleCollapsed: () => void;
};
```

### `CompanionChatbox.tsx`

职责：

- 渲染 `chat` 视图
- 管理搜索、过滤、滚动跟随
- 展示当前消息流

建议 props：

```ts
type CompanionChatboxProps = {
  messages: ChatMessage[];
  loading: boolean;
  error: string;
  ttsEnabled: boolean;
};
```

## DOM 结构

### 左侧导航

建议仍保留在 `page.tsx`，但事件改为真正可驱动：

```tsx
<aside className="mio-sidebar">
  <button className="mio-panel-toggle" />
  {navItems.map((item) => (
    <button
      key={item.key}
      className={...}
      type="button"
      aria-label={item.label}
      aria-pressed={activeRightPanelView === item.view}
    >
      ...
    </button>
  ))}
</aside>
```

### 右侧整栏统一外壳

建议从 `page.tsx` 抽出：

```tsx
<CompanionRightRail
  collapsed={isRightRailCollapsed}
  activeView={activeRightPanelView}
  messages={messages}
  loading={loading}
  error={error}
  ttsEnabled={ttsEnabled}
  nextSteps={nextSteps}
  memoryNotes={memoryNotes}
  traceRows={traceRows}
  onToggleCollapsed={() => setIsRightRailCollapsed((current) => !current)}
/>
```

### `overview` 结构

建议把当前 3 张卡片完整迁入 `overview` 视图：

```tsx
<section className="mio-right-rail mio-right-rail-overview" aria-label="总览面板">
  <button className="mio-panel-toggle mio-panel-toggle-right" />
  <article className="mio-card">Next Steps</article>
  <article className="mio-card">Memory</article>
  <article className="mio-card mio-trace-card">Trace</article>
</section>
```

### `chatbox` 结构

建议 DOM：

```tsx
<section className="mio-right-rail mio-right-rail-chat" aria-label="消息面板">
  <button className="mio-panel-toggle mio-panel-toggle-right" />

  <header className="mio-chatbox-head">
    <div className="mio-chatbox-head-copy">
      <strong>Chatbox</strong>
      <span>当前对话消息流</span>
    </div>
    <div className="mio-chatbox-head-meta">
      <span>{statusLabel}</span>
      <strong>{visibleMessages.length}</strong>
    </div>
  </header>

  <div className="mio-chatbox-toolbar">
    <input className="mio-chatbox-search" />
    <select className="mio-chatbox-filter" />
    <button className="mio-chatbox-jump" type="button">跳到最新</button>
  </div>

  <div className="mio-chatbox-list" ref={listRef}>
    {visibleMessages.map((message) => (
      <article className={`mio-chatbox-message is-${message.role}`}>
        <div className="mio-chatbox-message-head">
          <strong>{roleLabel}</strong>
        </div>
        <div className="mio-chatbox-message-body">{message.content}</div>
        <div className="mio-chatbox-message-meta">{meta}</div>
      </article>
    ))}
  </div>

  <footer className="mio-chatbox-footer">
    <span>在底部命令栏输入消息</span>
    <span>{ttsEnabled ? "TTS On" : "TTS Off"}</span>
  </footer>
</section>
```

## 数据映射

第一阶段直接使用现有 `messages`。

建议在 `CompanionChatbox` 内派生：

```ts
const visibleMessages = messages.filter((message) => {
  if (!message.content.trim()) return false;
  if (chatRoleFilter !== "all" && message.role !== chatRoleFilter) return false;
  if (chatSearch && !message.content.toLowerCase().includes(chatSearch.toLowerCase())) return false;
  return true;
});
```

### 角色映射

- `user` -> `User`
- `assistant` -> `Assistant`
- 其它 -> `System`

### 状态映射

- `loading === true` 且最后一条为用户消息时，顶部状态显示 `Sending`
- `error` 非空时，顶部状态显示 `Error`
- 否则显示 `Live`

## 占位视图

第一阶段其它 view 不做真实内容，但右侧整栏结构需要统一。

建议：

- `tasks`
- `tools`
- `memory`
- `skills`

都先渲染统一占位面板。

### 非 Chat 视图样式硬约束

`tasks / tools / memory / skills` 的视觉样式必须 100% 复刻当前 `overview` 中右侧固定卡片的样式体系。

实现约束：

- 必须复用 `.mio-card`、`.mio-card-copy` 和现有按钮样式体系
- 不允许保留独立的 placeholder 皮肤
- 不允许引入第二套面板造型语言
- 即使内容只是占位，也必须落在与 overview 卡片相同的几何和视觉外壳中

占位内容结构可以简化，但视觉结构必须仍然是：

- 标题区
- 正文区
- 底部操作区

这样右侧工作区切换模型可以一次性跑通。

## 文件改动点

建议的第一批改动点：

1. `web/src/app/companion/page.tsx`
2. `web/src/app/companion/CompanionRightRail.tsx`
3. `web/src/app/companion/CompanionChatbox.tsx`

如样式已经集中在页面内或全局样式，再视当前代码情况补充样式文件修改。

## 验收标准

- 左侧 `menu` 点击后右侧整栏切换到 `overview`
- `overview` 中完整展示原有 3 张固定卡片
- 左侧 `chat` 点击后右侧整栏完整切换为消息面板
- 底栏常驻，不随右侧切换变化
- 中间 stage 常驻，不随右侧切换变化
- 右侧 `chatbox` 展示现有 `messages`
- 右侧只有消息列表区滚动
- `tasks/tools/memory/skills` 至少能切出独立占位视图
- 不引入新的全局滚动条
- 不破坏现有底栏高级功能面板行为

## 实现顺序

1. 增加 `activeRightPanelView`
2. 改造左侧导航点击行为
3. 抽出 `CompanionRightRail`
4. 落地 `overview`
5. 落地 `CompanionChatbox`
6. 为其它 view 添加占位视图
7. 最后补样式和滚动跟随行为

以上为实现级设计，确认后进入编码阶段。
