import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  scanRecentCodexSessionFiles,
  type CodexSessionFileSummary,
} from "./codexSessionFiles.js";
import {
  discoverLocalCodexSessions,
  type CodexSessionScanner,
} from "./agentSessionDiscovery.js";

function emptyFacts() {
  return {
    failed_commands: [],
    changed_files: [],
    approvals: [],
    errors: [],
    event_counts: {},
    user_messages: [],
    assistant_messages: [],
    function_call_summaries: [],
    work_items: [],
    methods: [],
  };
}

function summary(
  overrides: Partial<CodexSessionFileSummary> = {},
): CodexSessionFileSummary {
  return {
    codexSessionId: "session-1",
    workspacePath: "D:\\workspace\\MMD project",
    filePath: "C:\\Users\\KSG\\.codex\\sessions\\session-1.jsonl",
    firstPromptPreview: "Implement discovery",
    displayTitle: "Implement discovery",
    lastSummary: "Scanning sessions",
    lastOutput: "working",
    lastStatus: "running",
    originator: "codex-tui",
    cliVersion: "0.146.0",
    sessionStartedAt: "2026-08-05T10:00:00.000Z",
    lastEventAt: "2026-08-05T10:02:00.000Z",
    fileModifiedAt: "2026-08-05T10:02:00.000Z",
    reviewFacts: emptyFacts(),
    ...overrides,
  };
}

describe("agent session discovery", () => {
  it("uses the real Codex scanner without filtering to one workspace", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "agent-discovery-codex-"));
    const sessionsDir = path.join(codexHome, "sessions", "2026", "08", "05");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const first = path.join(sessionsDir, "rollout-first.jsonl");
    const second = path.join(sessionsDir, "rollout-second.jsonl");
    fs.writeFileSync(
      first,
      `${JSON.stringify({
        type: "session_meta",
        payload: {
          id: "real-1",
          cwd: "D:\\workspace\\MMD project",
          originator: "codex-tui",
          source: "cli",
        },
      })}\n`,
      "utf8",
    );
    fs.writeFileSync(
      second,
      `${JSON.stringify({
        type: "session_meta",
        payload: {
          id: "real-2",
          cwd: "D:\\workspace\\Aether UI",
          originator: "Codex Desktop",
          source: "vscode",
        },
      })}\n`,
      "utf8",
    );

    const snapshot = await discoverLocalCodexSessions({
      codexHome,
      scan: scanRecentCodexSessionFiles,
    });

    expect(snapshot.sessions.map((session) => session.sessionId).sort()).toEqual(["real-1", "real-2"]);
  });

  it("discovers all local Codex workspaces without using a workspace filter", async () => {
    const scanner: CodexSessionScanner = (options) => {
      expect(options.workspacePath).toBeUndefined();
      return [
        summary(),
        summary({
          codexSessionId: "session-2",
          workspacePath: "D:\\workspace\\Aether UI",
          filePath: "C:\\Users\\KSG\\.codex\\sessions\\session-2.jsonl",
          originator: "Codex Desktop",
        }),
      ];
    };

    const snapshot = await discoverLocalCodexSessions({
      codexHome: "C:\\Users\\KSG\\.codex",
      wslCodexHome: "\\\\wsl.localhost\\Ubuntu\\home\\ksg\\.codex",
      scan: scanner,
    });

    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.sessions.map((session) => session.workspacePath)).toEqual([
      "D:\\workspace\\MMD project",
      "D:\\workspace\\Aether UI",
    ]);
  });

  it("classifies Desktop, CLI, and WSL runtimes from bounded session evidence", async () => {
    const snapshot = await discoverLocalCodexSessions({
      codexHome: "C:\\Users\\KSG\\.codex",
      scan: () => [
        summary({ codexSessionId: "desktop", originator: "Codex Desktop" }),
        summary({
          codexSessionId: "cli",
          originator: "codex_cli_rs",
          filePath: "C:\\Users\\KSG\\.codex\\sessions\\cli.jsonl",
        }),
        summary({
          codexSessionId: "wsl",
          originator: "codex-tui",
          workspacePath: "/mnt/d/workspace/MMD project",
          filePath: "\\\\wsl.localhost\\Ubuntu\\home\\ksg\\.codex\\sessions\\wsl.jsonl",
        }),
      ],
    });

    expect(snapshot.sessions.map((session) => session.runtime)).toEqual([
      "desktop",
      "cli",
      "wsl",
    ]);
  });

  it("deduplicates the same session observed by multiple local sources", async () => {
    const snapshot = await discoverLocalCodexSessions({
      codexHome: "C:\\Users\\KSG\\.codex",
      scan: () => [
        summary(),
        summary({
          filePath: "C:\\Users\\KSG\\.codex\\sessions\\duplicate-copy.jsonl",
          lastOutput: "newer evidence",
          fileModifiedAt: "2026-08-05T10:03:00.000Z",
        }),
      ],
    });

    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]?.lastOutput).toBe("newer evidence");
  });
});
