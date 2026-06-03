import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopPet", {
  runtimeInfo: () => ipcRenderer.invoke("pet:runtime-info"),
});
