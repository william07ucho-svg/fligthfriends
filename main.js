
const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require("electron");
const path = require("path");

let mainWindow;
let selectedSourceId = null;

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
          sources.find(s => s.name.toLowerCase().includes("microsoft flight")) ||
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
