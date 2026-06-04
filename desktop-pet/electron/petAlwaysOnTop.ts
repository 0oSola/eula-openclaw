type PetAlwaysOnTopWindow = {
  setAlwaysOnTop: (
    flag: boolean,
    level?: "normal" | "floating" | "torn-off-menu" | "modal-panel" | "main-menu" | "status" | "pop-up-menu" | "screen-saver",
  ) => void;
};

export function applyPetAlwaysOnTop(window: PetAlwaysOnTopWindow, enabled: boolean) {
  if (enabled) {
    window.setAlwaysOnTop(true, "floating");
    return;
  }
  window.setAlwaysOnTop(false);
}
