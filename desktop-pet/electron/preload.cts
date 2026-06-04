import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopPet", {
  runtimeInfo: () => ipcRenderer.invoke("pet:runtime-info"),
  apiRuntime: {
    get: () => ipcRenderer.invoke("pet:api-runtime:get"),
    retry: () => ipcRenderer.invoke("pet:api-runtime:retry"),
    onChanged: (callback: (status: any) => void) => {
      const listener = (_event: unknown, status: any) => callback(status);
      ipcRenderer.on("pet:api-runtime:changed", listener);
      return () => ipcRenderer.removeListener("pet:api-runtime:changed", listener);
    },
  },
  menu: {
    openContextMenu: (position?: { x: number; y: number }) => ipcRenderer.invoke("pet:menu:open-context", position),
    onAction: (callback: (action: any) => void) => {
      const listener = (_event: unknown, action: any) => callback(action);
      ipcRenderer.on("pet:menu:action", listener);
      return () => ipcRenderer.removeListener("pet:menu:action", listener);
    },
  },
  windowDrag: {
    start: () => ipcRenderer.send("pet:window-drag:start"),
    move: () => ipcRenderer.send("pet:window-drag:move"),
    end: () => ipcRenderer.send("pet:window-drag:end"),
  },
  notificationProfile: {
    get: () => ipcRenderer.invoke("pet:notification-profile:get"),
  },
  sessions: {
    restore: (petSessionId: string) => ipcRenderer.invoke("pet:sessions:restore", petSessionId),
  },
  prompt: {
    send: (prompt: string) => ipcRenderer.invoke("pet:prompt:send", prompt),
  },
  vscode: {
    focus: () => ipcRenderer.invoke("pet:vscode:focus"),
  },
  codexStatus: {
    get: () => ipcRenderer.invoke("pet:codex-status:get"),
    onChanged: (callback: (status: any) => void) => {
      const listener = (_event: unknown, status: any) => callback(status);
      ipcRenderer.on("pet:codex-status:changed", listener);
      return () => ipcRenderer.removeListener("pet:codex-status:changed", listener);
    },
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
