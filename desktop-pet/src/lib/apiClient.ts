import type { CompanionSharedConfig, MmdModelAsset, VmdAsset } from "@/lib/types";

export type ApiClientOptions = {
  baseUrl: string;
  userId: string;
  fetchImpl?: typeof fetch;
};

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const headers = { "x-user-id": options.userId };

  async function requestJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...headers,
        ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      throw new Error(`API ${path} failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  return {
    toAbsoluteUrl(path: string) {
      if (/^https?:\/\//i.test(path)) return path;
      return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    },
    getSharedConfig() {
      return requestJSON<CompanionSharedConfig>("/desktop-pet/shared-config");
    },
    async listModels() {
      const payload = await requestJSON<{ items: MmdModelAsset[] }>("/assets/mmd/models");
      return payload.items || [];
    },
    async listVmdAssets() {
      const payload = await requestJSON<{ items: VmdAsset[] }>(`/assets/vmd?user_id=${encodeURIComponent(options.userId)}`);
      return payload.items || [];
    },
    listPetSessions(limit = 10) {
      return requestJSON<any>(`/desktop-pet/sessions?limit=${limit}`);
    },
    upsertPetSession(payload: unknown) {
      return requestJSON<any>("/desktop-pet/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(payload),
      });
    },
  };
}
