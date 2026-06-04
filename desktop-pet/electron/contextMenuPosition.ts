export type ScreenPoint = {
  x: number;
  y: number;
};

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ContextMenuPositionInput = {
  space: "screen" | "window";
  point: ScreenPoint;
};

export type ResolvedContextMenuPosition = {
  screenPosition: ScreenPoint;
  popupPosition: ScreenPoint;
};

function isPointInsideWindow(point: ScreenPoint, bounds: WindowBounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

export function normalizeRendererMenuPosition(value: unknown): ScreenPoint | null {
  if (!value || typeof value !== "object") return null;
  const point = value as { x?: unknown; y?: unknown };
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
  };
}

export function toWindowMenuPosition(point: ScreenPoint, bounds: WindowBounds): ScreenPoint {
  return {
    x: Math.max(0, Math.min(bounds.width, Math.round(point.x - bounds.x))),
    y: Math.max(0, Math.min(bounds.height, Math.round(point.y - bounds.y))),
  };
}

export function toScreenMenuPosition(point: ScreenPoint, bounds: WindowBounds): ScreenPoint {
  return {
    x: Math.round(bounds.x + Math.max(0, Math.min(bounds.width, point.x))),
    y: Math.round(bounds.y + Math.max(0, Math.min(bounds.height, point.y))),
  };
}

export function resolveContextMenuPosition({
  input,
  bounds,
}: {
  input: ContextMenuPositionInput;
  bounds: WindowBounds;
}): ResolvedContextMenuPosition | null {
  if (input.space === "screen" && !isPointInsideWindow(input.point, bounds)) {
    return null;
  }
  const popupPosition =
    input.space === "screen"
      ? toWindowMenuPosition(input.point, bounds)
      : {
          x: Math.max(0, Math.min(bounds.width, Math.round(input.point.x))),
          y: Math.max(0, Math.min(bounds.height, Math.round(input.point.y))),
        };
  return {
    popupPosition,
    screenPosition: input.space === "screen" ? input.point : toScreenMenuPosition(popupPosition, bounds),
  };
}
