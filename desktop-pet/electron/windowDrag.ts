export type WindowDragPoint = {
  x: number;
  y: number;
};

export type WindowDragState = {
  startCursor: WindowDragPoint;
  startWindow: WindowDragPoint;
};

export function getDraggedWindowPosition(state: WindowDragState, currentCursor: WindowDragPoint): WindowDragPoint {
  return {
    x: state.startWindow.x + currentCursor.x - state.startCursor.x,
    y: state.startWindow.y + currentCursor.y - state.startCursor.y,
  };
}
