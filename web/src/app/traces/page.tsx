"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { TraceViewer } from "@/features/trace/TraceViewer";
import { loadSession } from "@/lib/session";
import type { UserSession } from "@/lib/types";

export default function TracePage() {
  const [session, setSession] = useState<UserSession | null>(null);

  useEffect(() => {
    setSession(loadSession());
  }, []);

  if (!session) {
    return (
      <main className="page-shell" style={{ display: "grid", placeItems: "center" }}>
        <section className="panel" style={{ width: "min(520px, 92vw)", padding: "1.2rem" }}>
          <h2 style={{ marginTop: 0 }}>未登录</h2>
          <p className="muted">请先登录后再查看链路日志。</p>
          <Link className="btn" href="/">
            去登录
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell" style={{ display: "grid", gap: "1rem" }}>
      <section className="panel" style={{ padding: "0.9rem", display: "flex", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>全链路追踪</h2>
          <p className="muted" style={{ margin: "0.35rem 0 0" }}>
            当前 user_id: {session.userId}
          </p>
        </div>
        <Link className="btn secondary" href="/companion">
          返回聊天页
        </Link>
      </section>
      <TraceViewer userId={session.userId} />
    </main>
  );
}
