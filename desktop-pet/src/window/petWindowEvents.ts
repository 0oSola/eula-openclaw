export type PetInteractionMode = "window-drag" | "camera-adjust";

export function shouldStartPetWindowDrag({
  interactionMode,
  button,
}: {
  interactionMode: PetInteractionMode;
  button: number;
}): boolean {
  return interactionMode === "window-drag" && button === 0;
}

export function shouldStopPetWindowDragPropagation({
  eventType,
  dragActive,
}: {
  eventType: "pointerdown" | "pointermove" | "pointerup" | "pointercancel";
  dragActive: boolean;
}): boolean {
  return dragActive && eventType === "pointermove";
}
