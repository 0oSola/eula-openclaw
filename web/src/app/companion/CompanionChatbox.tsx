"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ChatMessage } from "@/lib/types";

type ChatRoleFilter = "all" | "user" | "assistant" | "system";

type CompanionChatboxProps = {
  messages: ChatMessage[];
  loading: boolean;
  error: string;
  ttsEnabled: boolean;
  activeTtsMessageId: string;
  onPlayTtsMessage: (message: ChatMessage) => void;
};

const BOTTOM_THRESHOLD_PX = 32;

function getRoleLabel(role: ChatMessage["role"]) {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  return "System";
}

function getTtsLabel(message: ChatMessage, activeTtsMessageId: string) {
  if (!message.tts) return "";
  if (message.tts.status === "loading") return "Voice pending";
  if (message.tts.status === "failed") return "Voice unavailable";
  if (message.id && message.id === activeTtsMessageId) return "Playing";
  return "Play voice";
}

function canPlayTts(message: ChatMessage) {
  return message.tts?.status === "ready";
}

export function CompanionChatbox({
  messages,
  loading,
  error,
  ttsEnabled,
  activeTtsMessageId,
  onPlayTtsMessage,
}: CompanionChatboxProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [chatSearch, setChatSearch] = useState("");
  const [chatRoleFilter, setChatRoleFilter] = useState<ChatRoleFilter>("all");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const visibleMessages = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();

    return messages.filter((message) => {
      if (!message.content.trim()) return false;
      if (chatRoleFilter !== "all" && message.role !== chatRoleFilter) return false;
      if (query && !message.content.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [chatRoleFilter, chatSearch, messages]);

  const statusLabel = error ? "Error" : loading ? "Sending" : "Live";

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    setShowJumpToLatest(false);
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (distanceToBottom <= BOTTOM_THRESHOLD_PX) {
      list.scrollTop = list.scrollHeight;
      setShowJumpToLatest(false);
      return;
    }

    setShowJumpToLatest(true);
  }, [visibleMessages]);

  function handleListScroll() {
    const list = listRef.current;
    if (!list) return;

    const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    setShowJumpToLatest(distanceToBottom > BOTTOM_THRESHOLD_PX);
  }

  function jumpToLatest() {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    setShowJumpToLatest(false);
  }

  return (
    <>
      <header className="mio-chatbox-head">
        <div className="mio-chatbox-head-copy">
          <strong>Chatbox</strong>
          <span>当前对话消息流</span>
        </div>
        <div className="mio-chatbox-head-meta">
          <span>{statusLabel}</span>
          <strong>{visibleMessages.length.toString().padStart(2, "0")}</strong>
        </div>
      </header>

      <div className="mio-chatbox-toolbar">
        <input
          className="mio-chatbox-search"
          type="search"
          value={chatSearch}
          onChange={(event) => setChatSearch(event.target.value)}
          placeholder="搜索消息"
          aria-label="搜索消息"
        />
        <select
          className="mio-chatbox-filter"
          value={chatRoleFilter}
          onChange={(event) => setChatRoleFilter(event.target.value as ChatRoleFilter)}
          aria-label="消息角色过滤"
        >
          <option value="all">全部</option>
          <option value="user">User</option>
          <option value="assistant">Assistant</option>
          <option value="system">System</option>
        </select>
        <button type="button" className="mio-chatbox-jump" onClick={jumpToLatest} disabled={!showJumpToLatest}>
          跳到最新
        </button>
      </div>

      <div className="mio-chatbox-list" ref={listRef} onScroll={handleListScroll}>
        {visibleMessages.length === 0 ? (
          <div className="mio-chatbox-empty">
            <strong>还没有可显示的消息</strong>
            <span>在底部命令栏输入消息后，这里会显示完整消息流。</span>
          </div>
        ) : (
          visibleMessages.map((message, index) => (
            <article
              key={message.id || `${message.role}-${index}-${message.content.slice(0, 24)}`}
              className={`mio-chatbox-message is-${message.role}`}
            >
              <div className="mio-chatbox-message-head">
                <strong>{getRoleLabel(message.role)}</strong>
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
                  {message.traceId ? <span>{message.traceId.slice(0, 8)}</span> : null}
                </div>
              </div>
              <div className="mio-chatbox-message-body">{message.content}</div>
            </article>
          ))
        )}
      </div>

      <footer className="mio-chatbox-footer">
        <span>在底部命令栏输入消息</span>
        <span>{ttsEnabled ? "TTS On" : "TTS Off"}</span>
      </footer>
    </>
  );
}
