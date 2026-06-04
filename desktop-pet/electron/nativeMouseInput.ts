import type { PetInteractionMode } from "./interactionMode.js";

export const WM_MOUSEMOVE = 0x0200;
export const WM_LBUTTONDOWN = 0x0201;
export const WM_LBUTTONUP = 0x0202;
export const WM_RBUTTONUP = 0x0205;
export const CONTEXT_MENU_NATIVE_DRAG_SUPPRESSION_MS = 750;

export function shouldStartNativeWindowDrag({
  interactionMode,
  contextMenuActive = false,
  lastContextMenuClosedAtMs,
  nowMs = Date.now(),
}: {
  interactionMode: PetInteractionMode;
  contextMenuActive?: boolean;
  lastContextMenuClosedAtMs?: number;
  nowMs?: number;
}): boolean {
  if (contextMenuActive) return false;
  if (
    lastContextMenuClosedAtMs !== undefined &&
    nowMs - lastContextMenuClosedAtMs <= CONTEXT_MENU_NATIVE_DRAG_SUPPRESSION_MS
  ) {
    return false;
  }
  return interactionMode === "window-drag";
}
