"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ChatMessage } from "@/lib/types";

type ChatRoleFilter = "all" | "user" | "assistant" | "system";

type CompanionChatboxProps = {
  messages: ChatMessage[];
  loading: boolean;
  error: string;
  ttsEnabled: boolean;
};

const BOTTOM_THRESHOLD_PX = 32;

function getRoleLabel(role: ChatMessage["role"]) {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  return "System";
}

export function CompanionChatbox({ messages, loading, error, ttsEnabled }: CompanionChatboxProps) {
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
            <article key={`${message.role}-${index}-${message.content.slice(0, 24)}`} className={`mio-chatbox-message is-${message.role}`}>
              <div className="mio-chatbox-message-head">
                <strong>{getRoleLabel(message.role)}</strong>
                {message.traceId ? <span>{message.traceId.slice(0, 8)}</span> : null}
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
