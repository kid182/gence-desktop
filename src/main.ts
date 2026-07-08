import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  ipcMain,
  shell,
  nativeImage,
  safeStorage,
} from "electron";
import * as path from "path";
import * as fs from "fs";
import { autoUpdater } from "electron-updater";
import {
  APP_URL,
  ALLOWED_HOSTS,
  APP_NAME,
  APP_ID,
  WINDOW_TITLE,
  WINDOW_DEFAULT,
  WINDOW_MIN,
} from "./config";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Khoi dong cung Windows -> chay an vao tray (khong bung cua so).
const startHidden = process.argv.includes("--hidden");

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
    title: WINDOW_TITLE,
    show: !startHidden, // khoi dong cung may -> khong bung cua so, chi nam o tray
    backgroundColor: "#183756", // dong bo mau sidebar (het flash trang luc load)
    icon: path.join(__dirname, "..", "build", "icon.png"),
    // Bo title bar mac dinh + menu (File/Edit/View...) -> title bar tuy chinh mau #183756,
    // nut min/max/close mau trang. Web fill sat len top.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#ffffff", // trang, dong bo nen noi dung
      symbolColor: "#183756", // ky hieu nut dam tren nen trang
      height: 34,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.loadURL(APP_URL);

  // Khoa tieu de = "ERP Gence", khong de trang web ghi de.
  mainWindow.on("page-title-updated", (e) => e.preventDefault());

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

/* ----------------------------- Khoi dong cung may ----------------------------- */
function isAutoStart(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}

function setAutoStart(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true, // macOS: mo an
    args: ["--hidden"], // Windows: bao main chay vao tray, khong bung cua so
  });
}

// Lan cai/chay dau tien -> bat auto-start mac dinh. Sau do ton trong lua chon cua user (tray toggle).
function ensureDefaultAutoStart(): void {
  const marker = path.join(app.getPath("userData"), ".autostart-set");
  try {
    if (fs.existsSync(marker)) return;
    setAutoStart(true);
    fs.writeFileSync(marker, "1");
  } catch {
    /* ignore */
  }
}

/* ----------------------------- Tray ----------------------------- */
function createTray(): void {
  const buildDir = path.join(__dirname, "..", "build");
  let image: ReturnType<typeof nativeImage.createFromPath>;
  if (process.platform === "darwin") {
    // macOS: template (den + alpha) -> OS tu recolor theo theme. @2x tu bat cung thu muc.
    image = nativeImage.createFromPath(path.join(buildDir, "trayTemplate.png"));
    image.setTemplateImage(true);
  } else {
    // Windows: ban trang. 16px chuan, 32px cho man hinh HiDPI.
    image = nativeImage.createFromPath(path.join(buildDir, "tray-white-16.png"));
  }
  // Fallback neu thieu file: dung tray.png roi cuoi cung icon.png resize.
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(path.join(buildDir, "tray.png"));
    if (image.isEmpty()) {
      image = nativeImage
        .createFromPath(path.join(buildDir, "icon.png"))
        .resize({ width: 16, height: 16 });
    }
  }
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  const menu = Menu.buildFromTemplate([
    { label: `Phiên bản ${app.getVersion()}`, enabled: false },
    { type: "separator" },
    { label: "Mở " + APP_NAME, click: () => showWindow() },
    { type: "separator" },
    {
      label: "Mở công cụ nhà phát triển (DevTools)",
      click: () => {
        if (!mainWindow) createWindow();
        showWindow();
        mainWindow?.webContents.openDevTools({ mode: "detach" });
      },
    },
    {
      label: "Test thông báo",
      click: () => {
        if (!Notification.isSupported()) {
          console.warn("[notify-test] Notification khong duoc OS ho tro");
          return;
        }
        try {
          const n = new Notification({
            title: APP_NAME,
            body: "Đây là thông báo test. Nếu bạn thấy dòng này, native notification hoạt động.",
            silent: false,
            icon: path.join(__dirname, "..", "build", "icon.png"),
          });
          n.on("click", () => showWindow());
          n.show();
        } catch (err) {
          console.error("[notify-test] loi:", err);
        }
      },
    },
    {
      label: "Kiểm tra cập nhật",
      click: () => autoUpdater.checkForUpdates().catch(() => undefined),
    },
    {
      label: "Khởi động cùng Windows",
      type: "checkbox",
      checked: isAutoStart(),
      click: (item) => setAutoStart(item.checked),
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

// Dedup: cùng 1 notification id (nhieu hook web cung goi notify) -> chi hien 1 lan.
const recentNotifyIds = new Map<string, number>();
const NOTIFY_DEDUP_MS = 10_000;

ipcMain.on(
  "gence:notify",
  (_e, payload: { id?: string | number; title: string; body?: string; url?: string }) => {
    if (!payload?.title) return;
    if (!Notification.isSupported()) {
      console.warn("[notify] Notification khong duoc OS ho tro");
      return;
    }

    // Bo qua neu vua hien notification cung id trong 10s (chong double tu 2 hook).
    if (payload.id != null) {
      const key = String(payload.id);
      const now = Date.now();
      const last = recentNotifyIds.get(key);
      if (last && now - last < NOTIFY_DEDUP_MS) return;
      recentNotifyIds.set(key, now);
      // Don rac cac id cu de Map khong phinh vo han.
      for (const [k, t] of recentNotifyIds) {
        if (now - t > NOTIFY_DEDUP_MS) recentNotifyIds.delete(k);
      }
    }
    try {
      const n = new Notification({
        title: payload.title,
        body: payload.body || "",
        silent: false,
        // Windows can icon de render toast; dung logo app (da bundle trong files).
        icon: path.join(__dirname, "..", "build", "icon.png"),
      });
      n.on("click", () => {
        showWindow();
        if (payload.url) mainWindow?.webContents.send("gence:open", payload.url);
      });
      n.show();
    } catch (err) {
      console.error("[notify] hien notification that bai:", err);
    }
  },
);

/* ----------------------------- Luu mat khau (safeStorage) ----------------------------- */
// Ma hoa theo may bang DPAPI (Windows) / Keychain (macOS). File chi giai duoc tren dung may + user do.
const credFile = () => path.join(app.getPath("userData"), "credentials.bin");

ipcMain.handle(
  "gence:cred-save",
  (_e, cred: { username: string; password: string }): boolean => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      if (!cred?.username || !cred?.password) return false;
      const enc = safeStorage.encryptString(JSON.stringify(cred));
      fs.writeFileSync(credFile(), enc);
      return true;
    } catch {
      return false;
    }
  },
);

ipcMain.handle("gence:cred-load", (): { username: string; password: string } | null => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const p = credFile();
    if (!fs.existsSync(p)) return null;
    const cred = JSON.parse(safeStorage.decryptString(fs.readFileSync(p)));
    if (cred?.username && cred?.password) return cred;
    return null;
  } catch {
    return null; // file hong / doi may -> coi nhu chua luu
  }
});

ipcMain.handle("gence:cred-clear", (): boolean => {
  try {
    const p = credFile();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
});

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
    // Bat buoc: Windows lay display name cua notification + gom taskbar tu ID nay.
    // Khong set -> hien "Electron".
    app.setAppUserModelId(APP_ID);
    // Bo menu mac dinh (File/Edit/View/Window/Help).
    Menu.setApplicationMenu(null);
    ensureDefaultAutoStart();
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
