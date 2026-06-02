"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { loadSession } from "@/lib/session";
import type { UserSession } from "@/lib/types";

import { CodexConsole } from "../CodexConsole";

function TmuxStatus({ session, workspaceId = "mmd-companion" }: { session?: UserSession | null; workspaceId?: string }) {
  return (
    <header className="codex-tmux-status" aria-label="Codex terminal status">
      <div className="codex-tmux-status-left">
        <span className="codex-tmux-session">{workspaceId}</span>
        <span className="codex-tmux-window">1:codex-tasks</span>
        <span className="codex-tmux-flag">local</span>
      </div>
      <nav className="codex-tmux-status-right" aria-label="Codex navigation">
        <span>{session?.userId || "no-session"}</span>
        <span>sandbox:gated</span>
        <Link href="/companion">back:/companion</Link>
      </nav>
    </header>
  );
}

export default function CompanionTasksPage() {
  const [session, setSession] = useState<UserSession | null | undefined>(undefined);
  const [codexWorkspaceId, setCodexWorkspaceId] = useState("mmd-companion");

  useEffect(() => {
    setSession(loadSession());
  }, []);

  if (session === undefined) {
    return (
      <main className="codex-page">
        <TmuxStatus workspaceId={codexWorkspaceId} />
        <section className="codex-tmux-shell" aria-label="Codex terminal shell">
          <section className="codex-tmux-pane codex-tmux-pane-main" aria-live="polite">
            <div className="codex-tmux-pane-title">
              <span>pane 0</span>
              <strong>boot</strong>
            </div>
            <div className="codex-page-empty">
              <p>$ load local session</p>
              <p>waiting for browser storage...</p>
            </div>
          </section>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="codex-page">
        <TmuxStatus session={session} workspaceId={codexWorkspaceId} />
        <section className="codex-tmux-shell" aria-label="Codex terminal shell">
          <section className="codex-tmux-pane codex-tmux-pane-main">
            <div className="codex-tmux-pane-title">
              <span>pane 0</span>
              <strong>session</strong>
            </div>
            <div className="codex-page-empty">
              <p>$ session status</p>
              <p>未找到本地会话。</p>
              <Link href="/">open:/</Link>
            </div>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="codex-page">
      <TmuxStatus session={session} workspaceId={codexWorkspaceId} />
      <section className="codex-tmux-shell" aria-label="Codex terminal shell">
        <section className="codex-tmux-pane codex-tmux-pane-main" aria-label="Codex Console">
          <div className="codex-tmux-pane-title">
            <span>pane 0</span>
            <strong>codex-console</strong>
          </div>
          <CodexConsole
            userId={session.userId}
            localChatSessionId={session.activeChatSessionId || ""}
            onWorkspaceChange={setCodexWorkspaceId}
          />
        </section>
        <aside className="codex-tmux-pane codex-tmux-pane-side" aria-label="Codex session context">
          <div className="codex-tmux-pane-title">
            <span>pane 1</span>
            <strong>context</strong>
          </div>
          <dl className="codex-tmux-facts">
            <div>
              <dt>user</dt>
              <dd>{session.userId}</dd>
            </div>
            <div>
              <dt>chat</dt>
              <dd>{session.activeChatSessionId || "detached"}</dd>
            </div>
            <div>
              <dt>workspace</dt>
              <dd>{codexWorkspaceId}</dd>
            </div>
            <div>
              <dt>apply</dt>
              <dd>manual gates</dd>
            </div>
          </dl>
          <div className="codex-tmux-log" aria-label="Codex operating notes">
            <p>[ready] app-server through local FastAPI</p>
            <p>[mode] read-only or patch worktree</p>
            <p>[guard] approvals before apply</p>
          </div>
        </aside>
      </section>
    </main>
  );
}
