"use client";

import type { CSSProperties } from "react";
import { FormEvent, useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";

import { loadSession, saveSession } from "@/lib/session";

type LoginIntroState = "active" | "revealing" | "complete";

export default function LoginPage() {
  const router = useRouter();
  const idleBackgroundVideoRef = useRef<HTMLVideoElement>(null);
  const introVideoRef = useRef<HTMLVideoElement>(null);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [introState, setIntroState] = useState<LoginIntroState>("active");
  const normalizedAccount = account.trim();

  const finishIntro = useCallback(() => {
    const idleVideo = idleBackgroundVideoRef.current;
    introVideoRef.current?.pause();
    if (idleVideo) {
      try {
        idleVideo.currentTime = 0;
      } catch {
        // Metadata may still be loading; play() will start from the first available frame.
      }
      void idleVideo.play().catch(() => undefined);
    }
    setIntroState((current) => (current === "active" ? "revealing" : current));
  }, []);

  const completeIntro = useCallback(() => {
    setIntroState((current) => (current === "revealing" ? "complete" : current));
  }, []);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!normalizedAccount) return;
    const previousSession = loadSession();
    saveSession({
      userId: normalizedAccount,
      renderPipeline: "mio-reference",
      ttsEnabled: previousSession?.ttsEnabled ?? true,
      ttsMode: "server",
    });
    router.push("/companion");
  }

  const visualSlotStyle = {
    "--login-v2-background": `url("/images/loginV2/login_background.png")`,
    "--login-v2-window": `url("/images/loginV2/login_window-transparent.png")`,
    "--login-v2-button": `url("/images/loginV2/login_button-crop-transparent.png")`,
    "--login-v2-connect": `url("/images/loginV2/connect_panel-crop-transparent.png")`,
    "--login-v2-brand-mark": `url("/images/loginV2/aether-mark-crop.png")`,
    "--login-v2-brand-wordmark": `url("/images/loginV2/aether-wordmark-crop.png")`,
  } as CSSProperties;

  return (
    <main
      className="login-v2-shell"
      style={visualSlotStyle}
      data-testid="login-v2-shell"
      data-intro-state={introState}
      data-login-version="aether-login-v2-source-bitmap-v1"
    >
      <video
        ref={idleBackgroundVideoRef}
        className="login-v2-background-video"
        data-testid="login-v2-background-video"
        data-video-slot="idle-character-breathing-loop"
        data-idle-state={introState === "active" ? "waiting" : "playing"}
        src="/images/loginV2/idle_loginV4.mp4"
        aria-hidden="true"
        muted
        loop
        playsInline
        preload="auto"
      />

      <div
        className="login-v2-intro"
        data-testid="login-v2-intro"
        data-intro-phase={introState}
        onDoubleClick={finishIntro}
      >
        <video
          ref={introVideoRef}
          className="login-v2-intro-video"
          data-testid="login-v2-intro-video"
          src="/images/loginV2/login_video.mp4"
          aria-label="AETHER intro animation"
          autoPlay
          muted
          playsInline
          preload="auto"
          onEnded={finishIntro}
        />
      </div>

      <section
        className="login-v2-panel"
        data-testid="login-v2-panel"
        aria-labelledby="login-v2-title"
        onAnimationEnd={completeIntro}
      >
        <div
          className="login-v2-brand"
          data-testid="login-v2-brand"
          data-logo-layout="aether-v2-mark-left-wordmark-right"
          aria-label="AETHER PERSONAL AI"
        >
          <span className="login-v2-brand-mark" data-testid="login-v2-brand-mark" aria-hidden="true" />
          <span className="login-v2-brand-wordmark" data-testid="login-v2-brand-wordmark" aria-hidden="true" />
        </div>

        <div className="login-v2-copy">
          <h1 id="login-v2-title">欢迎登录 AETHER</h1>
          <p>PERSONAL AI / 智能虚拟助手平台</p>
        </div>

        <form className="login-v2-form" onSubmit={onSubmit}>
          <label className="login-v2-field" htmlFor="login-v2-account">
            <UserRound className="login-v2-field-icon" data-testid="login-v2-user-icon" aria-hidden="true" />
            <input
              id="login-v2-account"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              placeholder="账号 / 邮箱"
              aria-label="账号 / 邮箱"
              autoComplete="username"
            />
          </label>

          <label className="login-v2-field" htmlFor="login-v2-password">
            <LockKeyhole className="login-v2-field-icon" data-testid="login-v2-lock-icon" aria-hidden="true" />
            <input
              id="login-v2-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="密码"
              aria-label="密码"
              type="password"
              autoComplete="current-password"
            />
            <Eye className="login-v2-eye" data-testid="login-v2-eye-icon" aria-hidden="true" />
          </label>

          <div className="login-v2-options">
            <label className="login-v2-remember" htmlFor="login-v2-remember">
              <input
                id="login-v2-remember"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                type="checkbox"
              />
              <span>记住我</span>
            </label>
            <a href="/status">忘记密码?</a>
          </div>

          <button className="login-v2-submit" data-testid="login-v2-submit" type="submit">
            <span>进入系统</span>
          </button>
        </form>

        <button className="login-v2-register" data-testid="login-v2-register" type="button">
          注册账号
        </button>

        <div className="login-v2-footnote" aria-hidden="true">
          <span />
          <strong>连接你的知识，记忆与任务协作</strong>
          <span />
        </div>
      </section>

      <aside className="login-v2-connect-panel" data-testid="login-v2-connect-panel" aria-label="AI Access">
        <div>
          <span>AI ACCESS</span>
          <strong>CONNECT</strong>
        </div>
      </aside>

      <div className="login-v2-security" aria-hidden="true">
        <span>SECURE</span>
        <span>LOGIN</span>
        <ShieldCheck />
        <span>数据传输已加密</span>
      </div>

      <p className="login-v2-copyright">© 2024 AETHER PERSONAL AI. ALL RIGHTS RESERVED.</p>
    </main>
  );
}
