import { describe, expect, it } from "vitest";

import { buildCodexCompletionNotice } from "./completionNotice";

describe("Codex completion notice", () => {
  it("builds a dismissible workspace completion notice", () => {
    const notice = buildCodexCompletionNotice(
      {
        state: "completed",
        workspacePath: "D:\\workspace\\Other project",
        sessionTitle: "Run release checks",
        codexSessionId: "session-123",
      },
      null,
      "Codex",
    );

    expect(notice).toEqual({
      key: "session-123",
      title: "Codex task completed",
      workspaceLabel: "Other project",
      taskLabel: "Run release checks",
      workspacePath: "D:\\workspace\\Other project",
    });
  });

  it("does not rebuild a notice after the user dismissed the same completion", () => {
    const notice = buildCodexCompletionNotice(
      {
        state: "completed",
        workspacePath: "D:\\workspace\\Other project",
        sessionTitle: "Run release checks",
        codexSessionId: "session-123",
      },
      "session-123",
      "Codex",
    );

    expect(notice).toBeNull();
  });

  it("ignores non-completed statuses", () => {
    expect(
      buildCodexCompletionNotice(
        {
          state: "running",
          workspacePath: "D:\\workspace\\Other project",
          sessionTitle: "Run release checks",
        },
        null,
        "Codex",
      ),
    ).toBeNull();
  });
});
