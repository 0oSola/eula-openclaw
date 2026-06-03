import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./apiClient";

describe("desktop pet api client", () => {
  it("sends x-user-id for shared config", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ render_pipeline: "classic" }), { status: 200 }),
    );
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8000", userId: "admin-1", fetchImpl });

    await client.getSharedConfig();

    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ "x-user-id": "admin-1" });
  });

  it("normalizes model file urls", () => {
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8000", userId: "admin-1" });

    expect(client.toAbsoluteUrl("/assets/vmd/file/a")).toBe("http://127.0.0.1:8000/assets/vmd/file/a");
  });
});
