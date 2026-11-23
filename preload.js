
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("flightAPI", {
  getSources: () => ipcRenderer.invoke("get-sources"),

  selectSource: (id) =>
    ipcRenderer.invoke("select-source", id)
});
