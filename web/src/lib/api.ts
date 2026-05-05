import { buildTraceHeaders } from "@/lib/trace.js";
import { requestServerTtsAudio } from "@/lib/ttsClient.js";
import type {
  ChatResponse,
  MappingConfig,
  MmdMotionAsset,
  MmdModelAsset,
  OpenClawConfig,
  OpenClawConfigSaveResult,
  OpenClawHealthStatus,
  TraceEvent,
  TraceMirror,
  VmdAsset,
} from "@/lib/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

function makeUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function requestJSON<T>(
  path: string,
  init: RequestInit & { userId?: string; traceId?: string } = {},
): Promise<T> {
  const { userId, traceId, headers, ...rest } = init;
  const resolvedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string>),
  };
  if (userId) resolvedHeaders["x-user-id"] = userId;
  if (traceId || userId) {
    const traceHeaders = buildTraceHeaders(traceId || "", userId || "");
    Object.assign(resolvedHeaders, traceHeaders);
  }
  const response = await fetch(makeUrl(path), {
    ...rest,
    headers: resolvedHeaders,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.detail || data?.message || `Request failed: ${response.status}`);
  }
  return data as T;
}

export type ChatInput = {
  user_id: string;
  message: string;
  session_id: string;
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
};

export async function postChat(input: ChatInput, traceId: string): Promise<ChatResponse> {
  return requestJSON<ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify(input),
    userId: input.user_id,
    traceId,
  });
}

export async function getResolvedMappings(userId: string): Promise<Record<string, MappingConfig>> {
  const payload = await requestJSON<{ mappings: Record<string, MappingConfig> }>(
    `/config/mapping/resolved/${encodeURIComponent(userId)}`,
    { method: "GET", userId },
  );
  return payload.mappings || {};
}

export async function putUserMappings(
  userId: string,
  mappings: Record<string, MappingConfig>,
): Promise<Record<string, MappingConfig>> {
  const payload = await requestJSON<{ mappings: Record<string, MappingConfig> }>(
    `/config/mapping/user/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ mappings }),
      userId,
    },
  );
  return payload.mappings || {};
}

export async function getOpenClawConfig(userId: string): Promise<OpenClawConfig> {
  return requestJSON<OpenClawConfig>("/config/openclaw", {
    method: "GET",
    userId,
  });
}

export async function putOpenClawConfig(
  userId: string,
  payload: {
    base_url: string;
    token?: string | null;
    agent_id: string;
    model: string;
    message_channel: string;
    proxy_url: string;
    verify_ssl: boolean;
    timeout_seconds: number;
  },
): Promise<OpenClawConfigSaveResult> {
  return requestJSON<OpenClawConfigSaveResult>("/config/openclaw", {
    method: "PUT",
    body: JSON.stringify(payload),
    userId,
  });
}

export async function getOpenClawHealth(userId: string): Promise<OpenClawHealthStatus> {
  return requestJSON<OpenClawHealthStatus>("/healthz/openclaw", {
    method: "GET",
    userId,
  });
}

export async function listVmdAssets(userId: string): Promise<VmdAsset[]> {
  const payload = await requestJSON<{ items: VmdAsset[] }>(
    `/assets/vmd?user_id=${encodeURIComponent(userId)}`,
    { method: "GET", userId },
  );
  return payload.items || [];
}

export async function listMmdModels(): Promise<MmdModelAsset[]> {
  const payload = await requestJSON<{ items: MmdModelAsset[] }>("/assets/mmd/models", {
    method: "GET",
  });
  return payload.items || [];
}

export async function listMmdMotions(): Promise<MmdMotionAsset[]> {
  const payload = await requestJSON<{ items: MmdMotionAsset[] }>("/assets/mmd/vmds", {
    method: "GET",
  });
  return payload.items || [];
}

export async function uploadVmdAsset(userId: string, slot: string, file: File): Promise<VmdAsset> {
  const form = new FormData();
  form.append("user_id", userId);
  form.append("slot", slot);
  const sourceRelativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim();
  console.info("[vmd-upload] preparing upload", {
    name: file.name,
    slot,
    sourceRelativePath: sourceRelativePath || null,
  });
  if (sourceRelativePath) {
    form.append("source_relative_path", sourceRelativePath);
  }
  form.append("file", file);

  const response = await fetch(makeUrl("/assets/vmd"), {
    method: "POST",
    headers: { "x-user-id": userId },
    body: form,
    cache: "no-store",
  });
  const data = await response.json();
  console.info("[vmd-upload] upload response", {
    name: file.name,
    sourceRelativePath: sourceRelativePath || null,
    returnedSourceRelativePath: data?.source_relative_path || null,
    assetId: data?.asset_id || null,
  });
  if (!response.ok) throw new Error(data?.detail || `Upload failed: ${response.status}`);
  return data as VmdAsset;
}

export async function updateVmdAsset(
  userId: string,
  assetId: string,
  payload: {
    display_name?: string;
    favorite?: boolean;
    model_relative_path?: string;
  },
): Promise<VmdAsset> {
  return requestJSON<VmdAsset>(`/assets/vmd/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    userId,
  });
}

export async function getTraceEvents(
  userId: string,
  query: { traceId?: string; targetUserId?: string } = {},
): Promise<TraceEvent[]> {
  const params = new URLSearchParams();
  if (query.traceId) params.set("trace_id", query.traceId);
  if (query.targetUserId) params.set("user_id", query.targetUserId);
  const payload = await requestJSON<{ items: TraceEvent[] }>(
    `/trace/events${params.toString() ? `?${params.toString()}` : ""}`,
    { method: "GET", userId },
  );
  return payload.items || [];
}

export async function getTraceMirrors(
  userId: string,
  query: { traceId?: string; targetUserId?: string } = {},
): Promise<TraceMirror[]> {
  const params = new URLSearchParams();
  if (query.traceId) params.set("trace_id", query.traceId);
  if (query.targetUserId) params.set("user_id", query.targetUserId);
  const payload = await requestJSON<{ items: TraceMirror[] }>(
    `/trace/mirrors${params.toString() ? `?${params.toString()}` : ""}`,
    { method: "GET", userId },
  );
  return payload.items || [];
}

export type ServerTtsResult =
  | {
      configured: false;
      message: string;
    }
  | {
      configured: true;
      audio: Blob;
      mediaType: string;
      message?: string;
    };

export async function requestServerTts(userId: string, text: string, sessionId?: string): Promise<ServerTtsResult> {
  return requestServerTtsAudio({ userId, text, sessionId, makeUrl }) as Promise<ServerTtsResult>;
}

export { API_BASE_URL, makeUrl };
