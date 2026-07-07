import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  ipcMain,
  shell,
  nativeImage,
} from "electron";
import * as path from "path";
import * as fs from "fs";
import { autoUpdater } from "electron-updater";
import { APP_URL, ALLOWED_HOSTS, APP_NAME, WINDOW_DEFAULT, WINDOW_MIN } from "./config";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

/* ----------------------------- Luu kich thuoc cua so ----------------------------- */
type Bounds = { width: number; height: number; x?: number; y?: number };
const boundsFile = () => path.join(app.getPath("userData"), "window-bounds.json");

function loadBounds(): Bounds {
  try {
    const raw = fs.readFileSync(boundsFile(), "utf-8");
    const b = JSON.parse(raw);
    if (b && typeof b.width === "number" && typeof b.height === "number") return b;
  } catch {
    /* dung mac dinh */
  }
  return { ...WINDOW_DEFAULT };
}

function saveBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify(mainWindow.getBounds()));
  } catch {
    /* ignore */
  }
}

/* ----------------------------- Cua so chinh ----------------------------- */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
const isAllowed = (url: string) => ALLOWED_HOSTS.includes(hostOf(url));

function createWindow(): void {
  const b = loadBounds();
  mainWindow = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    minWidth: WINDOW_MIN.width,
    minHeight: WINDOW_MIN.height,
    title: APP_NAME,
    backgroundColor: "#ffffff",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.loadURL(APP_URL);

  // Link ngoai danh sach host -> mo browser he thong; cung host -> dieu huong trong app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowed(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!isAllowed(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Luu kich thuoc khi resize/move (debounce nhe qua timeout).
  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBounds, 400);
  };
  mainWindow.on("resize", scheduleSave);
  mainWindow.on("move", scheduleSave);

  // Dong cua so = thu nho xuong tray (khong thoat) tru khi thuc su quit.
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    } else {
      saveBounds();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/* ----------------------------- Tray ----------------------------- */
function createTray(): void {
  const iconPath = path.join(__dirname, "..", "build", "tray.png");
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) image = nativeImage.createFromPath(path.join(__dirname, "..", "build", "icon.png"));
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  const menu = Menu.buildFromTemplate([
    { label: "Mở " + APP_NAME, click: () => showWindow() },
    { type: "separator" },
    {
      label: "Kiểm tra cập nhật",
      click: () => autoUpdater.checkForUpdates().catch(() => undefined),
    },
    { type: "separator" },
    {
      label: "Thoát",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => showWindow());
}

function showWindow(): void {
  if (!mainWindow) createWindow();
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

/* ----------------------------- IPC (cau noi web) ----------------------------- */
ipcMain.on("gence:version", (e) => {
  e.returnValue = app.getVersion();
});

ipcMain.on(
  "gence:notify",
  (_e, payload: { id?: string | number; title: string; body?: string; url?: string }) => {
    if (!payload?.title || !Notification.isSupported()) return;
    const n = new Notification({
      title: payload.title,
      body: payload.body || "",
      silent: false,
    });
    n.on("click", () => {
      showWindow();
      if (payload.url) mainWindow?.webContents.send("gence:open", payload.url);
    });
    n.show();
  },
);

ipcMain.on("gence:badge", (_e, count: number) => {
  const c = Math.max(0, Number(count) || 0);
  app.setBadgeCount(c); // macOS dock / Linux; Windows overlay se bo sung sau
  if (process.platform === "win32" && mainWindow && !mainWindow.isFocused() && c > 0) {
    mainWindow.flashFrame(true);
  }
});

/* ----------------------------- Auto-update ----------------------------- */
function setupAutoUpdate(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", () => {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: APP_NAME,
      body: "Đã tải bản cập nhật mới. Khởi động lại để áp dụng.",
    });
    n.on("click", () => {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    });
    n.show();
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater]", err?.message || err);
  });

  // Check khi mo + moi 6 tieng.
  autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  }, 6 * 60 * 60 * 1000);
}

/* ----------------------------- Lifecycle ----------------------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(() => {
    createWindow();
    createTray();
    setupAutoUpdate();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  // Khong tu thoat khi dong cua so (chay ngam o tray).
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      // Van giu tray tren Windows; chi thoat khi user chon Thoat.
    }
  });
}
