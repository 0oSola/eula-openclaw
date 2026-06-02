export const CODEX_CLIENT_REQUEST_METHODS = {
  initialize: "initialize",
  threadStart: "thread/start",
  turnStart: "turn/start",
  turnInterrupt: "turn/interrupt",
} as const;

export const CODEX_CLIENT_NOTIFICATION_METHODS = {
  initialized: "initialized",
} as const;

export const CODEX_SERVER_REQUEST_METHODS = {
  commandApproval: "item/commandExecution/requestApproval",
  fileChangeApproval: "item/fileChange/requestApproval",
  legacyExecCommandApproval: "execCommandApproval",
  legacyApplyPatchApproval: "applyPatchApproval",
} as const;

export const CODEX_SERVER_NOTIFICATION_METHODS = {
  turnStarted: "turn/started",
  turnCompleted: "turn/completed",
  agentMessageDelta: "item/agentMessage/delta",
  processExited: "process/exited",
} as const;
