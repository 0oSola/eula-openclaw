import { makeUrl } from "@/lib/api";

export type CodexSessionCreatePayload = {
  local_chat_session_id?: string | null;
  workspace_id: string;
  mode?: "read_only" | "review" | "test";
  sandbox?: "read-only";
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
