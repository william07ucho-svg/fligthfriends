
const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  session,
  dialog
} = require("electron");

const path = require("path");
const { autoUpdater } = require("electron-updater");

let mainWindow;
let selectedSourceId = null;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1450,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#17191f",
    title: "Flight Friends",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  await mainWindow.loadFile("src/index.html");
}

function configureAutoUpdater() {
  if (!app.isPackaged) {
    console.log("Atualizações automáticas desativadas no modo de desenvolvimento.");
    return;
  }

  autoUpdater.on("checking-for-update", () => {
    console.log("Verificando atualizações...");
  });

  autoUpdater.on("update-available", async (info) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Atualização disponível",
      message: `Uma nova versão do Flight Friends (${info.version}) está disponível.`,
      detail: "Deseja baixar e instalar esta atualização?",
      buttons: ["Atualizar agora", "Mais tarde"],
      defaultId: 0,
      cancelId: 1
    });

    if (result.response === 0) {
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on("update-not-available", () => {
    console.log("O Flight Friends já está atualizado.");
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(`Baixando atualização: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Atualização pronta",
      message: `A versão ${info.version} foi baixada com sucesso.`,
      detail: "Reinicie o Flight Friends para instalar a atualização.",
      buttons: ["Reiniciar agora", "Depois"],
      defaultId: 0,
      cancelId: 1
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (error) => {
    console.error("Erro no atualizador:", error);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.error("Não foi possível verificar atualizações:", error);
    });
  }, 3000);
}

app.whenReady().then(async () => {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["window", "screen"],
          thumbnailSize: { width: 320, height: 180 }
        });

        const source =
          sources.find(s => s.id === selectedSourceId) ||
          sources.find(s =>
            s.name.toLowerCase().includes("flight simulator")
          ) ||
          sources.find(s =>
            s.name.toLowerCase().includes("microsoft flight")
          ) ||
          sources.find(s => s.id.startsWith("screen:")) ||
          sources[0];

        if (!source) {
          callback({});
          return;
        }

        callback({
          video: source,
          audio: "loopback"
        });
      } catch (error) {
        console.error("Erro na captura:", error);
        callback({});
      }
    },
    { useSystemPicker: false }
  );

  ipcMain.handle("get-sources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 320, height: 180 }
    });

    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }));
  });

  ipcMain.handle("select-source", async (event, id) => {
    selectedSourceId = id;
    return true;
  });

  await createWindow();

  configureAutoUpdater();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
