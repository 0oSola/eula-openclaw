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
          <h2 style={{ marginTop: 0 }}>{"\u672a\u767b\u5f55"}</h2>
          <p className="muted">{"\u8bf7\u5148\u767b\u5f55\u540e\u518d\u67e5\u770b\u94fe\u8def\u65e5\u5fd7\u3002"}</p>
          <Link className="btn" href="/">
            {"\u53bb\u767b\u5f55"}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell" style={{ display: "grid", gap: "1rem" }}>
      <section className="panel" style={{ padding: "0.9rem", display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>
            {"\u5168\u94fe\u8def\u8ffd\u8e2a"}
          </h2>
          <p className="muted" style={{ margin: "0.35rem 0 0" }}>
            {"\u5f53\u524d user_id: "}
            {session.userId}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link className="btn secondary" href="/status">
            {"\u8fd0\u884c\u72b6\u6001"}
          </Link>
          <Link className="btn secondary" href="/companion">
            {"\u8fd4\u56de\u804a\u5929\u9875"}
          </Link>
        </div>
      </section>
      <TraceViewer userId={session.userId} />
    </main>
  );
}
