import type { MenuItemConstructorOptions } from "electron";

import type { PetMenuAction, PetMenuItemModel } from "./petMenuModel.js";

export function toElectronMenuTemplate(
  items: PetMenuItemModel[],
  onAction: (action: PetMenuAction) => void,
): MenuItemConstructorOptions[] {
  return items.map((item) => {
    if (item.type === "separator") {
      return { type: "separator" };
    }
    if (item.submenu) {
      return {
        label: item.label,
        type: "submenu",
        enabled: item.enabled !== false,
        submenu: toElectronMenuTemplate(item.submenu, onAction),
      };
    }
    return {
      label: item.label,
      type: item.type === "radio" || item.type === "checkbox" ? item.type : "normal",
      checked: item.checked,
      enabled: item.enabled !== false,
      click: item.action ? () => onAction(item.action!) : undefined,
    };
  });
}
