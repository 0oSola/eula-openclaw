import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

function backendUrl(pathParts: string[], search: string): string {
  const base = API_BASE_URL.replace(/\/$/, "");
  const path = pathParts.map((part) => encodeURIComponent(part)).join("/");
  return `${base}/${path}${search}`;
}

function forwardHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  for (const name of ["accept", "authorization", "content-type", "range", "x-trace-id", "x-user-id"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function proxyBackendRequest(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const targetUrl = backendUrl(path || [], request.nextUrl.search);
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: forwardHeaders(request),
    cache: "no-store",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    // Companion/Pet 配置是小型 JSON。Next 的 Request.body 流在 Windows Node
    // 开发代理中偶发无法结束，导致 PUT 一直处于 pending；JSON 改为缓冲后再转发。
    // 文件上传仍保留流式转发，避免把大型 VMD/贴图全部放入内存。
    if ((request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
      init.body = await request.arrayBuffer();
    } else {
      init.body = request.body;
      init.duplex = "half";
    }
  }

  try {
    const response = await fetch(targetUrl, init);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    const body = await response.arrayBuffer();
    return new NextResponse(body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { detail: `Backend proxy failed: ${targetUrl}. ${detail}` },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyBackendRequest(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyBackendRequest(request, context);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyBackendRequest(request, context);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyBackendRequest(request, context);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyBackendRequest(request, context);
}
