"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { isChatListNearBottom, shouldAutoScrollChatList } from "@/lib/chatAutoScroll.js";
import { formatChatMessageTime } from "@/lib/chatMessageTime.js";
import type { ChatMessage, MessageServiceSession } from "@/lib/types";

type ChatRoleFilter = "all" | "user" | "assistant" | "system";

type CompanionChatboxProps = {
  sessions: MessageServiceSession[];
  activeSessionId: string;
  sessionBusy: boolean;
  messages: ChatMessage[];
  autoScrollRevision: number;
  loading: boolean;
  error: string;
  ttsEnabled: boolean;
  activeTtsMessageId: string;
  onCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (session: MessageServiceSession) => void;
  onDeleteSession: (session: MessageServiceSession) => void;
  onPlayTtsMessage: (message: ChatMessage) => void;
};

function getRoleLabel(role: ChatMessage["role"]) {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  return "System";
}

function getTtsLabel(message: ChatMessage, activeTtsMessageId: string) {
  if (!message.tts) return "";
  if (message.tts.status === "loading" || message.tts.status === "pending") return "Voice pending";
  if (message.tts.status === "failed") return "Voice unavailable";
  if (message.tts.status === "partial_failed") return "Voice partially failed";
  if (message.tts.status === "expired") return "Voice expired";
  if (message.id && message.id === activeTtsMessageId) return "Playing";
  return "Play voice";
}

function canPlayTts(message: ChatMessage) {
  return message.tts?.status === "ready";
}

function formatSessionTime(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "--";
  const date = new Date(parsed);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function CompanionChatbox({
  sessions,
  activeSessionId,
  sessionBusy,
  messages,
  autoScrollRevision,
  loading,
  error,
  ttsEnabled,
  activeTtsMessageId,
  onCreateSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onPlayTtsMessage,
}: CompanionChatboxProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const previousVisibleMessageCountRef = useRef(0);
  const wasNearBottomBeforeUpdateRef = useRef(true);
  const autoScrollRevisionRef = useRef(autoScrollRevision);
  const [chatSearch, setChatSearch] = useState("");
  const [chatRoleFilter, setChatRoleFilter] = useState<ChatRoleFilter>("all");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [copiedTraceId, setCopiedTraceId] = useState("");

  const visibleMessages = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();

    return messages.filter((message) => {
      if (message.visibility === "internal") return false;
      if (!message.content.trim()) return false;
      if (chatRoleFilter !== "all" && message.role !== chatRoleFilter) return false;
      if (query && !message.content.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [chatRoleFilter, chatSearch, messages]);

  const statusLabel = error ? "Error" : loading ? "Sending" : "Live";

  function scrollToLatest() {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    wasNearBottomBeforeUpdateRef.current = true;
    setShowJumpToLatest(false);
  }

  function readNearBottom() {
    const list = listRef.current;
    if (!list) return true;
    return isChatListNearBottom({
      scrollHeight: list.scrollHeight,
      scrollTop: list.scrollTop,
      clientHeight: list.clientHeight,
    });
  }

  useEffect(() => {
    const autoScrollRequested = autoScrollRevisionRef.current !== autoScrollRevision;
    const shouldScroll = shouldAutoScrollChatList({
      previousVisibleMessageCount: previousVisibleMessageCountRef.current,
      nextVisibleMessageCount: visibleMessages.length,
      wasNearBottomBeforeUpdate: wasNearBottomBeforeUpdateRef.current,
      autoScrollRequested,
    });

    previousVisibleMessageCountRef.current = visibleMessages.length;
    autoScrollRevisionRef.current = autoScrollRevision;

    if (shouldScroll) {
      scrollToLatest();
      return;
    }

    const nearBottom = readNearBottom();
    wasNearBottomBeforeUpdateRef.current = nearBottom;
    setShowJumpToLatest(visibleMessages.length > 0 && !nearBottom);
  }, [autoScrollRevision, visibleMessages.length]);

  function handleListScroll() {
    const nearBottom = readNearBottom();
    wasNearBottomBeforeUpdateRef.current = nearBottom;
    setShowJumpToLatest(visibleMessages.length > 0 && !nearBottom);
  }

  function jumpToLatest() {
    scrollToLatest();
  }

  async function copyTraceId(traceId: string) {
    try {
      await navigator.clipboard.writeText(traceId);
    } catch {
      const input = document.createElement("textarea");
      input.value = traceId;
      input.setAttribute("readonly", "true");
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopiedTraceId(traceId);
    window.setTimeout(() => {
      setCopiedTraceId((current) => (current === traceId ? "" : current));
    }, 1200);
  }

  return (
    <>
      <div className="mio-chatbox-actions">
        <button type="button" className="mio-chatbox-action" onClick={jumpToLatest} disabled={!showJumpToLatest}>
          Latest
        </button>
        <button
          type="button"
          className="mio-chatbox-action"
          onClick={() => setShowTools((current) => !current)}
          aria-expanded={showTools}
        >
          {showTools ? "Hide" : "Tools"}
        </button>
      </div>

      {showTools ? (
        <section className="mio-chatbox-controls" aria-label="Chat tools">
          <div className="mio-chatbox-toolbar">
            <input
              className="mio-chatbox-search"
              type="search"
              value={chatSearch}
              onChange={(event) => setChatSearch(event.target.value)}
              placeholder="Search messages"
              aria-label="Search messages"
            />
            <select
              className="mio-chatbox-filter"
              value={chatRoleFilter}
              onChange={(event) => setChatRoleFilter(event.target.value as ChatRoleFilter)}
              aria-label="Message role filter"
            >
              <option value="all">All</option>
              <option value="user">User</option>
              <option value="assistant">Assistant</option>
              <option value="system">System</option>
            </select>
          </div>

          <div className="mio-chatbox-sessions-head">
            <strong>Sessions</strong>
            <button type="button" className="mio-chatbox-session-create" onClick={onCreateSession} disabled={sessionBusy}>
              New
            </button>
          </div>

          <div className="mio-chatbox-session-list">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`mio-chatbox-session-item${session.id === activeSessionId ? " is-active" : ""}`}
                data-active={session.id === activeSessionId ? "true" : "false"}
              >
                <button
                  type="button"
                  className="mio-chatbox-session-main"
                  onClick={() => onSelectSession(session.id)}
                  disabled={sessionBusy && session.id !== activeSessionId}
                >
                  <strong>{session.title}</strong>
                  <span>{formatSessionTime(session.updated_at)}</span>
                </button>
                <div className="mio-chatbox-session-tools">
                  <button type="button" className="mio-chatbox-session-tool" onClick={() => onRenameSession(session)} disabled={sessionBusy}>
                    Rename
                  </button>
                  <button
                    type="button"
                    className="mio-chatbox-session-tool"
                    onClick={() => onDeleteSession(session)}
                    disabled={sessionBusy || sessions.length <= 1}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mio-chatbox-list" ref={listRef} onScroll={handleListScroll}>
        {visibleMessages.length === 0 ? (
          <div className="mio-chatbox-empty">
            <strong>No messages</strong>
            <span>Send a message from the command bar to populate this list.</span>
          </div>
        ) : (
          <div className="mio-chatbox-message-flow">
            {visibleMessages.map((message, index) => (
              <article
                key={message.id || `${message.role}-${index}-${message.content.slice(0, 24)}`}
                className={`mio-chatbox-message is-${message.role}`}
              >
                <div className="mio-chatbox-message-head">
                  <div className="mio-chatbox-message-meta">
                    <strong>{getRoleLabel(message.role)}</strong>
                    <span>{formatChatMessageTime(message.createdAt)}</span>
                  </div>
                  <div className="mio-chatbox-message-tools">
                    {message.tts ? (
                      <button
                        type="button"
                        className="mio-message-voice-button"
                        aria-label={getTtsLabel(message, activeTtsMessageId)}
                        title={getTtsLabel(message, activeTtsMessageId)}
                        disabled={!canPlayTts(message)}
                        data-status={message.tts.status}
                        data-active={message.id && message.id === activeTtsMessageId ? "true" : "false"}
                        onClick={() => onPlayTtsMessage(message)}
                      >
                        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
                          <path d="M4.2 8.2h2.5l3.4-3v9.6l-3.4-3H4.2z" />
                          <path d="M13.1 7.2a4 4 0 0 1 0 5.6M15.2 5.1a7 7 0 0 1 0 9.8" />
                        </svg>
                      </button>
                    ) : null}
                    {message.traceId ? (
                      <button
                        type="button"
                        className="mio-message-trace-button"
                        title="Copy traceId"
                        aria-label="Copy traceId"
                        onClick={() => void copyTraceId(message.traceId as string)}
                      >
                        {copiedTraceId === message.traceId ? "Copied" : message.traceId.slice(0, 8)}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mio-chatbox-message-body">{message.content}</div>
              </article>
            ))}
          </div>
        )}
      </div>

      <footer className="mio-chatbox-footer">
        <span>{statusLabel}</span>
        <span>{ttsEnabled ? "TTS On" : "TTS Off"}</span>
        <span>{visibleMessages.length} {chatRoleFilter === "all" ? "messages" : getRoleLabel(chatRoleFilter)}</span>
      </footer>
    </>
  );
}
