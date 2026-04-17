export function buildTraceHeaders(traceId, userId) {
  const resolvedTraceId = traceId && traceId.trim() ? traceId : crypto.randomUUID();
  return {
    "x-trace-id": resolvedTraceId,
    "x-user-id": userId,
  };
}

