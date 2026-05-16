export const CHAT_BOTTOM_THRESHOLD_PX = 32;

export function isChatListNearBottom({ scrollHeight, scrollTop, clientHeight }, thresholdPx = CHAT_BOTTOM_THRESHOLD_PX) {
  return scrollHeight - scrollTop - clientHeight <= thresholdPx;
}

export function shouldAutoScrollChatList({
  previousVisibleMessageCount,
  nextVisibleMessageCount,
  wasNearBottomBeforeUpdate,
  autoScrollRequested,
}) {
  if (nextVisibleMessageCount <= 0) return false;
  if (autoScrollRequested) return true;
  if (previousVisibleMessageCount === 0) return true;
  return nextVisibleMessageCount > previousVisibleMessageCount && wasNearBottomBeforeUpdate;
}
