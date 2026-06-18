import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDesktopPetSessionPayload,
  inferCodexSessionStatus,
  parseCodexSessionFile,
  resolveCodexHome,
  scanRecentCodexSessionFiles,
} from "./codexSessionFiles";

function writeSessionFile(lines: unknown[], filename = "rollout-2026-06-03T19-15-45-session.jsonl") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-codex-session-"));
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
  return filePath;
}

function sessionMeta(id = "019e88e4-4f27-7f20-be48-fd1ef50e9492") {
  return {
    timestamp: "2026-06-03T11:15:48.235Z",
    type: "session_meta",
    payload: {
      id,
      timestamp: "2026-06-03T11:15:45.059Z",
      cwd: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      originator: "codex-tui",
      cli_version: "0.135.0",
      source: "cli",
    },
  };
}

describe("desktop pet Codex session files", () => {
  it("resolves CODEX_HOME with platform defaults", () => {
    expect(resolveCodexHome({ CODEX_HOME: "D:\\codex-home" }, "win32")).toBe("D:\\codex-home");
    expect(resolveCodexHome({ USERPROFILE: "C:\\Users\\KSG" }, "win32")).toBe("C:\\Users\\KSG\\.codex");
    expect(resolveCodexHome({ HOME: "/home/ksg" }, "linux")).toBe("/home/ksg/.codex");
  });

  it("parses a Codex JSONL transcript into bounded desktop-pet session metadata", () => {
    const filePath = writeSessionFile([
      sessionMeta(),
      {
        timestamp: "2026-06-03T11:15:48.257Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "# AGENTS.md instructions for D:\\workspace\\MMD project" }],
        },
      },
      {
        timestamp: "2026-06-03T11:15:48.260Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "The following is the Codex agent history whose result needs review." }],
        },
      },
      {
        timestamp: "2026-06-03T11:15:48.267Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "只做状态/提醒，预留直接发 prompt、查看摘要、处理审批",
        },
      },
      {
        timestamp: "2026-06-03T11:15:55.848Z",
        type: "response_item",
        payload: { type: "function_call", name: "shell_command" },
      },
      {
        timestamp: "2026-06-03T11:15:56.929Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "call-1", output: "Exit code: 0" },
      },
      {
        timestamp: "2026-06-03T11:16:15.587Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "已补上状态同步。" },
      },
      {
        timestamp: "2026-06-03T11:16:15.655Z",
        type: "event_msg",
        payload: { type: "task_complete" },
      },
    ]);

    const summary = parseCodexSessionFile(filePath);
    const payload = buildDesktopPetSessionPayload(summary, "C:\\Users\\KSG\\.codex");

    expect(summary).toMatchObject({
      codexSessionId: "019e88e4-4f27-7f20-be48-fd1ef50e9492",
      workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      firstPromptPreview: "只做状态/提醒，预留直接发 prompt、查看摘要、处理审批",
      lastStatus: "completed",
      lastSummary: "已补上状态同步。",
      lastOutput: "已补上状态同步。",
    });
    expect(payload).toMatchObject({
      pet_session_id: "codex:019e88e4-4f27-7f20-be48-fd1ef50e9492",
      codex_session_id: "019e88e4-4f27-7f20-be48-fd1ef50e9492",
      codex_home: "C:\\Users\\KSG\\.codex",
      display_title: "只做状态/提醒，预留直接发 prompt、查看摘要、处理审批",
      first_prompt_preview: "只做状态/提醒，预留直接发 prompt、查看摘要、处理审批",
      last_status: "completed",
      launch_mode: "workspace-write",
    });
    expect(payload.metadata).toMatchObject({
      source: "codex-jsonl",
      session_file: filePath,
      originator: "codex-tui",
    });
  });

  it("extracts the latest command output for the desktop status card", () => {
    const filePath = writeSessionFile([
      sessionMeta(),
      {
        timestamp: "2026-06-03T11:15:55.848Z",
        type: "response_item",
        payload: { type: "function_call", name: "shell_command" },
      },
      {
        timestamp: "2026-06-03T11:15:56.929Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "line one\nline two\nline three\nline four",
        },
      },
    ]);

    const summary = parseCodexSessionFile(filePath);
    const payload = buildDesktopPetSessionPayload(summary, "C:\\Users\\KSG\\.codex");

    expect(summary).toMatchObject({
      lastStatus: "running",
      lastSummary: null,
      lastOutput: "line one\nline two\nline three\nline four",
    });
    expect(payload.metadata).toMatchObject({
      last_output: "line one\nline two\nline three\nline four",
    });
  });

  it("extracts bounded review facts from Codex JSONL events", () => {
    const filePath = writeSessionFile([
      sessionMeta(),
      {
        timestamp: "2026-06-03T11:15:48.267Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Implement OpenClaw review sync" },
      },
      {
        timestamp: "2026-06-03T11:15:55.848Z",
        type: "response_item",
        payload: { type: "function_call", name: "shell_command", arguments: { command: "npm run build" } },
      },
      {
        timestamp: "2026-06-03T11:15:56.929Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "Exit code: 1\nschema mismatch\nSECRET_TOKEN=should-not-leak",
        },
      },
      {
        timestamp: "2026-06-03T11:16:00.000Z",
        type: "event_msg",
        payload: { type: "file_change", path: "api/app/routes/desktop_pet.py" },
      },
      {
        timestamp: "2026-06-03T11:16:01.000Z",
        type: "event_msg",
        payload: { type: "approval_request", message: "Allow command npm test?" },
      },
      {
        timestamp: "2026-06-03T11:16:02.000Z",
        type: "event_msg",
        payload: { type: "turn_failed", message: "OpenClaw returned invalid JSON" },
      },
    ]);

    const summary = parseCodexSessionFile(filePath);
    const payload = buildDesktopPetSessionPayload(summary, "C:\\Users\\KSG\\.codex");

    expect(payload.metadata.facts).toMatchObject({
      failed_commands: [
        {
          command: "npm run build",
          exit_code: 1,
          excerpt: "Exit code: 1\nschema mismatch\nSECRET_TOKEN=[redacted]",
        },
      ],
      changed_files: ["api/app/routes/desktop_pet.py"],
      approvals: [{ title: "Allow command npm test?" }],
      errors: [{ type: "turn_failed", excerpt: "OpenClaw returned invalid JSON" }],
      event_counts: {
        user_message: 1,
        function_call: 1,
        function_call_output: 1,
        file_change: 1,
        approval_request: 1,
        turn_failed: 1,
      },
    });
  });

  it("infers active command and approval states from tail events", () => {
    expect(inferCodexSessionStatus([])).toBe("running");

    expect(
      inferCodexSessionStatus([
        { type: "event_msg", payload: { type: "user_message", message: "继续" } },
      ]),
    ).toBe("running");

    expect(
      inferCodexSessionStatus([
        { type: "response_item", payload: { type: "function_call", name: "shell_command" } },
      ]),
    ).toBe("command_running");

    expect(
      inferCodexSessionStatus([
        { type: "event_msg", payload: { type: "approval_request", message: "Allow command?" } },
      ]),
    ).toBe("waiting_approval");

    expect(
      inferCodexSessionStatus([
        { type: "event_msg", payload: { type: "file_change", path: "desktop-pet/src/App.tsx" } },
      ]),
    ).toBe("file_changed");

    expect(
      inferCodexSessionStatus([
        { type: "event_msg", payload: { type: "agent_message", message: "完成。" } },
        { type: "event_msg", payload: { type: "task_complete" } },
      ]),
    ).toBe("completed");

    expect(
      inferCodexSessionStatus([
        { type: "event_msg", payload: { type: "turn_failed", message: "failed" } },
      ]),
    ).toBe("failed");

    expect(
      inferCodexSessionStatus([
        { type: "event_msg", payload: { type: "process_exit", message: "codex exited" } },
      ]),
    ).toBe("disconnected");
  });

  it("scans recent rollout files for the requested workspace", () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-codex-home-"));
    const sessionsDir = path.join(codexHome, "sessions", "2026", "06", "03");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const included = path.join(sessionsDir, "rollout-2026-06-03T19-15-45-019e88e4-4f27-7f20-be48-fd1ef50e9492.jsonl");
    const excluded = path.join(sessionsDir, "rollout-2026-06-03T19-20-45-019e88eb-06f5-7801-b904-ac622612c514.jsonl");
    fs.writeFileSync(included, JSON.stringify(sessionMeta()) + "\n", "utf8");
    fs.writeFileSync(
      excluded,
      JSON.stringify({
        ...sessionMeta("019e88eb-06f5-7801-b904-ac622612c514"),
        payload: { ...sessionMeta().payload, id: "019e88eb-06f5-7801-b904-ac622612c514", cwd: "D:\\workspace\\Other" },
      }) + "\n",
      "utf8",
    );

    const sessions = scanRecentCodexSessionFiles({
      codexHome,
      workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      limit: 10,
    });

    expect(sessions.map((session) => session.codexSessionId)).toEqual(["019e88e4-4f27-7f20-be48-fd1ef50e9492"]);
  });
});
