"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatCodexTerminalTranscript } from "@/lib/codexTerminalLines.js";

type CodexTranscriptItem = {
  id: string;
  kind: string;
  turnId: string;
  text: string;
};

type CodexTerminalLine = {
  id: string;
  prompt: string;
  tone: string;
  turnId?: string;
  text: string;
};

type CodexTerminalPaneProps = {
  transcript: CodexTranscriptItem[];
  status: string;
  workspaceId: string;
  mode: "read_only" | "patch";
};

type XtermTerminal = import("@xterm/xterm").Terminal;
type XtermFitAddon = import("@xterm/addon-fit").FitAddon;

const RESET = "\x1b[0m";
const TONE_COLORS: Record<string, string> = {
  primary: "\x1b[38;2;215;255;226m",
  success: "\x1b[38;2;46;255;142m",
  command: "\x1b[38;2;255;221;87m",
  muted: "\x1b[38;2;135;247;255m",
  notice: "\x1b[38;2;118;228;255m",
  warning: "\x1b[38;2;255;180;105m",
  accent: "\x1b[38;2;216;255;57m",
  danger: "\x1b[38;2;255;118;118m",
};

function stripTerminalControls(value: string) {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function formatLine(line: CodexTerminalLine) {
  const prompt = stripTerminalControls(line.prompt || "codex").slice(0, 12).padEnd(12, " ");
  const text = stripTerminalControls(line.text || "");
  const color = TONE_COLORS[line.tone] || TONE_COLORS.primary;
  const continuation = `\r\n${" ".repeat(15)}`;
  return `\x1b[2m[${prompt}]\x1b[22m ${color}${text.replace(/\n/g, continuation)}${RESET}\r\n`;
}

function buildTerminalScreen(lines: CodexTerminalLine[]) {
  return lines.map(formatLine).join("");
}

function writeScreen(terminal: XtermTerminal, screen: string) {
  terminal.write(`\x1b[2J\x1b[H${screen}`);
}

export function CodexTerminalPane({ transcript, status, workspaceId, mode }: CodexTerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<XtermFitAddon | null>(null);
  const latestScreenRef = useRef("");
  const [fallback, setFallback] = useState(false);
  const lines = useMemo(
    () => formatCodexTerminalTranscript(transcript, { status, workspaceId, mode }),
    [mode, status, transcript, workspaceId],
  );
  const screen = useMemo(() => buildTerminalScreen(lines), [lines]);

  useEffect(() => {
    latestScreenRef.current = screen;
    if (terminalRef.current) writeScreen(terminalRef.current, screen);
  }, [screen]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    async function boot() {
      try {
        const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
          import("@xterm/addon-web-links"),
        ]);
        if (cancelled || !hostRef.current) return;

        const terminal = new Terminal({
          convertEol: true,
          cursorBlink: true,
          disableStdin: true,
          fontFamily: '"Cascadia Mono", "JetBrains Mono", "SFMono-Regular", Consolas, "Noto Sans SC", monospace',
          fontSize: 12,
          lineHeight: 1.28,
          scrollback: 2500,
          theme: {
            background: "#040606",
            black: "#050607",
            blue: "#76e4ff",
            brightBlack: "#586e75",
            brightBlue: "#87f7ff",
            brightCyan: "#a6fff0",
            brightGreen: "#8dffb8",
            brightMagenta: "#ffd166",
            brightRed: "#ff7676",
            brightWhite: "#f4ffe0",
            brightYellow: "#f6ff7a",
            cursor: "#d8ff39",
            cyan: "#87f7ff",
            foreground: "#d7ffe2",
            green: "#2eff8e",
            magenta: "#ffb469",
            red: "#ff7676",
            selectionBackground: "#244a34",
            white: "#d7ffe2",
            yellow: "#ffdd57",
          },
        });
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(new WebLinksAddon());
        terminal.open(hostRef.current);
        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
        fitAddon.fit();
        writeScreen(terminal, latestScreenRef.current);

        resizeObserver = new ResizeObserver(() => {
          fitAddonRef.current?.fit();
        });
        resizeObserver.observe(hostRef.current);
      } catch {
        if (!cancelled) setFallback(true);
      }
    }

    void boot();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  return (
    <section className="codex-terminal-frame" aria-label="Codex transcript">
      <div className="codex-terminal-toolbar">
        <span>{workspaceId}</span>
        <span>{mode === "patch" ? "patch" : "read-only"}</span>
        <span>{status}</span>
      </div>
      {fallback ? (
        <pre className="codex-terminal-fallback">{screen.replace(/\r\n/g, "\n")}</pre>
      ) : (
        <div ref={hostRef} className="codex-terminal-host" />
      )}
    </section>
  );
}
