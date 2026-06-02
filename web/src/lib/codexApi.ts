import { makeUrl } from "@/lib/api";

export type CodexSessionCreatePayload = {
  local_chat_session_id?: string | null;
  workspace_id: string;
  mode?: "read_only" | "review" | "test" | "patch";
  sandbox?: "read-only" | "workspace-write";
};

export type CodexInteractiveSession = {
  id: string;
  workspace_id: string;
  worktree_path?: string | null;
  branch_name?: string | null;
  status: string;
  sandbox: string;
  ws_url: string;
};

export type CodexWorkspace = {
  id: string;
  path: string;
  source: "env" | "ui";
};

export type CodexWorkspaceListResponse = {
  workspaces: CodexWorkspace[];
};

export type CodexWorkspaceCreatePayload = {
  workspace_id: string;
  path: string;
};

export type CodexWorkspaceCreateResponse = {
  workspace: CodexWorkspace;
};

export type CodexWorkspacePathPickPayload = {
  initial_path?: string | null;
};

export type CodexWorkspacePathPickResponse = {
  path: string | null;
};

export type CodexDiff = {
  session_id: string;
  base_workspace: string;
  worktree_path: string;
  changed_files: string[];
  stat: string;
  patch: string;
  artifact_id: string;
};

export type CodexCheckResult = {
  check: string;
  command: string[];
  exit_code: number;
  stdout: string;
  stderr: string;
};

export type CodexChecksResponse = {
  session_id: string;
  artifact_id: string;
  results: CodexCheckResult[];
};

export type CodexApplyResponse = {
  session_id: string;
  artifact_id: string;
  applied: boolean;
  changed_files: string[];
};

export async function createCodexInteractiveSession(
  userId: string,
  payload: CodexSessionCreatePayload,
): Promise<CodexInteractiveSession> {
  const response = await fetch(makeUrl("/codex/interactive/sessions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.detail || `Codex session create failed: ${response.status}`);
  }
  return data as CodexInteractiveSession;
}

async function codexJson<T>(path: string, userId: string, init?: RequestInit): Promise<T> {
  const response = await fetch(makeUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId,
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.detail || `Codex request failed: ${response.status}`);
  }
  return data as T;
}

export async function listCodexWorkspaces(userId: string): Promise<CodexWorkspaceListResponse> {
  return codexJson<CodexWorkspaceListResponse>("/codex/workspaces", userId);
}

export async function createCodexWorkspace(
  userId: string,
  payload: CodexWorkspaceCreatePayload,
): Promise<CodexWorkspaceCreateResponse> {
  return codexJson<CodexWorkspaceCreateResponse>("/codex/workspaces", userId, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function pickCodexWorkspacePath(
  userId: string,
  payload: CodexWorkspacePathPickPayload = {},
): Promise<CodexWorkspacePathPickResponse> {
  return codexJson<CodexWorkspacePathPickResponse>("/codex/workspaces/path-picker", userId, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getCodexDiff(userId: string, sessionId: string): Promise<CodexDiff> {
  return codexJson<CodexDiff>(`/codex/interactive/${sessionId}/diff`, userId);
}

export async function decideCodexApproval(
  userId: string,
  sessionId: string,
  approvalId: string,
  decision: "approve_once" | "deny",
): Promise<unknown> {
  return codexJson(`/codex/interactive/${sessionId}/approvals/${approvalId}`, userId, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

export async function runCodexChecks(
  userId: string,
  sessionId: string,
  checks: string[] = ["api"],
): Promise<CodexChecksResponse> {
  return codexJson<CodexChecksResponse>(`/codex/interactive/${sessionId}/checks`, userId, {
    method: "POST",
    body: JSON.stringify({ checks }),
  });
}

export async function applyCodexSession(userId: string, sessionId: string, confirm: boolean): Promise<CodexApplyResponse> {
  return codexJson<CodexApplyResponse>(`/codex/interactive/${sessionId}/apply`, userId, {
    method: "POST",
    body: JSON.stringify({ strategy: "patch_to_main_workspace", confirm }),
  });
}

export async function discardCodexSession(userId: string, sessionId: string): Promise<{ session_id: string; status: string }> {
  return codexJson<{ session_id: string; status: string }>(`/codex/interactive/${sessionId}/discard`, userId, {
    method: "POST",
    body: JSON.stringify({ remove_worktree: true }),
  });
}
