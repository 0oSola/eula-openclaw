import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopPet", {
  runtimeInfo: () => ipcRenderer.invoke("pet:runtime-info"),
  interactionMode: {
    get: () => ipcRenderer.invoke("pet:interaction-mode:get"),
    set: (mode: string) => ipcRenderer.invoke("pet:interaction-mode:set", mode),
    onChanged: (callback: (mode: string) => void) => {
      const listener = (_event: unknown, mode: string) => callback(mode);
      ipcRenderer.on("pet:interaction-mode:changed", listener);
      return () => ipcRenderer.removeListener("pet:interaction-mode:changed", listener);
    },
  },
  windowDrag: {
    start: () => ipcRenderer.invoke("pet:window-drag:start"),
    move: () => ipcRenderer.invoke("pet:window-drag:move"),
    end: () => ipcRenderer.invoke("pet:window-drag:end"),
  },
});
