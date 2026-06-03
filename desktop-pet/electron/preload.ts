import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopPet", {
  runtimeInfo: () => ipcRenderer.invoke("pet:runtime-info"),
  menu: {
    openContextMenu: () => ipcRenderer.invoke("pet:menu:open-context"),
    onAction: (callback: (action: any) => void) => {
      const listener = (_event: unknown, action: any) => callback(action);
      ipcRenderer.on("pet:menu:action", listener);
      return () => ipcRenderer.removeListener("pet:menu:action", listener);
    },
  },
  notificationProfile: {
    get: () => ipcRenderer.invoke("pet:notification-profile:get"),
  },
  interactionMode: {
    get: () => ipcRenderer.invoke("pet:interaction-mode:get"),
    set: (mode: string) => ipcRenderer.invoke("pet:interaction-mode:set", mode),
    onChanged: (callback: (mode: string) => void) => {
      const listener = (_event: unknown, mode: string) => callback(mode);
      ipcRenderer.on("pet:interaction-mode:changed", listener);
      return () => ipcRenderer.removeListener("pet:interaction-mode:changed", listener);
    },
  },
});
