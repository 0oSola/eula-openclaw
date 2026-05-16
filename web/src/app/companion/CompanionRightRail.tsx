"use client";

import Link from "next/link";

import type { ChatMessage, MessageServiceSession } from "@/lib/types";

import { CompanionChatbox } from "./CompanionChatbox";

export type RightPanelView = "overview" | "chat" | "tasks" | "tools" | "memory" | "skills";

type TraceRow = readonly [string, string, string, string];

type CompanionRightRailProps = {
  collapsed: boolean;
  activeView: RightPanelView;
  sessions: MessageServiceSession[];
  activeSessionId: string;
  sessionBusy: boolean;
  messages: ChatMessage[];
  chatAutoScrollRevision: number;
  loading: boolean;
  error: string;
  ttsEnabled: boolean;
  activeTtsMessageId: string;
  nextSteps: string[];
  memoryNotes: string[];
  traceRows: readonly TraceRow[];
  onToggleCollapsed: () => void;
  onCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (session: MessageServiceSession) => void;
  onDeleteSession: (session: MessageServiceSession) => void;
  onPlayTtsMessage: (message: ChatMessage) => void;
};

function PlaceholderWorkspace({
  title,
  label,
  description,
  actionLabel,
}: {
  title: string;
  label: string;
  description: string;
  actionLabel: string;
}) {
  return (
    <article className="mio-card mio-workspace-card">
      <h2>
        {title} <small>{label}</small>
      </h2>
      <div className="mio-card-copy">
        <p>{description}</p>
        <p>Coming soon</p>
      </div>
      <button type="button">{actionLabel}</button>
    </article>
  );
}

function OverviewWorkspace({
  nextSteps,
  memoryNotes,
  traceRows,
}: Pick<CompanionRightRailProps, "nextSteps" | "memoryNotes" | "traceRows">) {
  return (
    <>
      <article className="mio-card">
        <h2>
          <img src="/images/sprite-sliced/asset-013.png" alt="" />
          下一步建议 <small>NEXT STEPS</small>
        </h2>
        <div className="mio-card-copy">
          <ul className="mio-check-list">
            {nextSteps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <button type="button">查看更多建议（6）</button>
      </article>

      <article className="mio-card">
        <h2>
          <img src="/images/sprite-sliced/asset-008.png" alt="" />
          记忆摘要 <small>MEMORY</small>
        </h2>
        <div className="mio-card-copy">
          {memoryNotes.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
        <button type="button">查看完整记忆</button>
      </article>

      <article className="mio-card mio-trace-card">
        <h2>
          <img src="/images/sprite-sliced/asset-022.png" alt="" />
          Trace / 请求状态 <small>TRACE</small>
        </h2>
        <div className="mio-card-copy">
          <div className="mio-trace-list">
            {traceRows.map(([method, path, status, time]) => (
              <div key={`${method}-${path}`}>
                <span>{method}</span>
                <span>{path}</span>
                <strong>{status}</strong>
                <span>{time}</span>
              </div>
            ))}
          </div>
        </div>
        <Link href="/traces">进入 Trace 页面</Link>
      </article>
    </>
  );
}

export function CompanionRightRail({
  collapsed,
  activeView,
  sessions,
  activeSessionId,
  sessionBusy,
  messages,
  chatAutoScrollRevision,
  loading,
  error,
  ttsEnabled,
  activeTtsMessageId,
  nextSteps,
  memoryNotes,
  traceRows,
  onToggleCollapsed,
  onCreateSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onPlayTtsMessage,
}: CompanionRightRailProps) {
  const workspaceClassName =
    activeView === "overview" ? "mio-right-rail-overview" : activeView === "chat" ? "mio-right-rail-chat" : "mio-right-rail-workspace";

  return (
    <section
      className={`mio-right-rail ${workspaceClassName}${collapsed ? " is-collapsed" : ""}`}
      data-testid="mio-right-rail"
      aria-label="状态面板"
    >
      <button
        className="mio-panel-toggle mio-panel-toggle-right"
        type="button"
        aria-label={collapsed ? "展开右侧面板" : "收起右侧面板"}
        aria-pressed={collapsed}
        onClick={onToggleCollapsed}
      >
        {collapsed ? "‹" : "›"}
      </button>

      {!collapsed ? (
        activeView === "overview" ? (
          <OverviewWorkspace nextSteps={nextSteps} memoryNotes={memoryNotes} traceRows={traceRows} />
        ) : activeView === "chat" ? (
          <CompanionChatbox
            sessions={sessions}
            activeSessionId={activeSessionId}
            sessionBusy={sessionBusy}
            messages={messages}
            autoScrollRevision={chatAutoScrollRevision}
            loading={loading}
            error={error}
            ttsEnabled={ttsEnabled}
            activeTtsMessageId={activeTtsMessageId}
            onCreateSession={onCreateSession}
            onSelectSession={onSelectSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
            onPlayTtsMessage={onPlayTtsMessage}
          />
        ) : activeView === "tasks" ? (
          <PlaceholderWorkspace
            title="任务面板"
            label="TASKS"
            description="这里将承接任务拆解、步骤状态和建议动作。"
            actionLabel="查看任务规划"
          />
        ) : activeView === "tools" ? (
          <PlaceholderWorkspace
            title="工具面板"
            label="TOOLS"
            description="这里将承接工具调用记录、工具状态和 Trace 聚合信息。"
            actionLabel="查看工具状态"
          />
        ) : activeView === "memory" ? (
          <PlaceholderWorkspace
            title="记忆面板"
            label="MEMORY"
            description="这里将承接用户偏好、摘要记忆和长期上下文。"
            actionLabel="查看记忆详情"
          />
        ) : (
          <PlaceholderWorkspace
            title="能力面板"
            label="SKILLS"
            description="这里将承接技能列表、状态和推荐使用方式。"
            actionLabel="查看能力清单"
          />
        )
      ) : null}
    </section>
  );
}
