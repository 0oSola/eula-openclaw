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

export function toWindowMenuPosition(point: ScreenPoint, bounds: WindowBounds): ScreenPoint {
  return {
    x: Math.max(0, Math.min(bounds.width, Math.round(point.x - bounds.x))),
    y: Math.max(0, Math.min(bounds.height, Math.round(point.y - bounds.y))),
  };
}
