"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { saveSession } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const value = userId.trim();
    if (!value) return;
    saveSession({ userId: value, renderPipeline: "classic" });
    router.push("/companion");
  }

  return (
    <main className="page-shell" style={{ display: "grid", placeItems: "center" }}>
      <section className="panel" style={{ width: "min(560px, 92vw)", padding: "1.2rem" }}>
        <h1 style={{ marginTop: 0, fontFamily: "Space Grotesk, sans-serif" }}>MMD 虚拟伴侣</h1>
        <p className="muted">开发登录页：先输入用户 ID，后续可替换为真实 OAuth / 账号登录。</p>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.7rem" }}>
          <label>
            <span className="muted">User ID</span>
            <input
              className="input"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="例如: demo-user-001"
            />
          </label>
          <button className="btn" type="submit">
            进入伴侣页面
          </button>
        </form>
      </section>
    </main>
  );
}
