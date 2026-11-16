import {
  BrowserWindow,
  WebContentsView,
  WebContents,
  Menu,
  clipboard,
  ipcMain,
  shell,
} from "electron";
import * as path from "path";
import { APP_URL, TITLEBAR_HEIGHT } from "./config";
import { getSettings, setSetting } from "./settings";
import { initDownloads, listDownloads, downloadAction, DownloadEntry } from "./downloads";
import { pendingVersion, installUpdate } from "./updater";
import {
  activeTab,
  allTabs,
  isActive,
  listTabs,
  activateTab,
  closeTab,
  closeActive,
  duplicateActive,
  stepTab,
  tabAt,
  moveTab,
} from "./tabs";

/**
 * Thanh tren cung: dieu huong (lui / toi / tai lai / trang chu), tim trong trang, tep tai xuong,
 * thu phong va menu tien ich. Giao dien la file noi bo trong ui/ - title bar nam trong
 * BrowserWindow, bang tep tai xuong la mot WebContentsView noi de len webview erpgence.
 */
const UI_DIR = path.join(__dirname, "..", "ui");
export const TITLEBAR_FILE = path.join(UI_DIR, "titlebar.html");
export const TOOLBAR_PRELOAD = path.join(__dirname, "toolbar-preload.js");

const PANEL_WIDTH = 380;
const PANEL_MAX_HEIGHT = 460;
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const isMac = process.platform === "darwin";

let win: BrowserWindow | null = null;
let panel: WebContentsView | null = null;
let panelOpen = false;
let panelHiddenAt = 0;
let panelHeight = 160;

const alive = (wc?: WebContents | null): wc is WebContents => !!wc && !wc.isDestroyed();
/** webContents cua tab dang chon (src/tabs.ts). */
const page = () => {
  const v = activeTab();
  return v && alive(v.webContents) ? v.webContents : null;
};

function sendBar(channel: string, data?: unknown): void {
  if (win && !win.isDestroyed() && alive(win.webContents)) win.webContents.send(channel, data);
}

function pushState(): void {
  const wc = page();
  if (!wc) return;
  sendBar("bar:state", {
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    loading: wc.isLoading(),
    zoom: Math.round(getSettings().zoom * 100),
    panelOpen,
    update: pendingVersion(), // ban moi da tai xong, cho cai -> hien nut "Cap nhat"
  });
}

/** Day lai trang thai xuong thanh tren cung (vd vua co ban cap nhat). */
export const refreshToolbar = pushState;

/* ----------------------------- Tab ----------------------------- */
let tabTruoc: WebContents | null = null;

/** tabs.ts bao danh sach / tieu de / tab dang chon doi -> ve lai dai tab + trang thai nut cua tab dang chon. */
export function onTabsChanged(): void {
  sendBar("bar:tabs", listTabs());
  const wc = page();
  if (wc !== tabTruoc) {
    // Doi tab: luot tim cu thuoc tab truoc, dong o tim cho khoi lech ket qua.
    if (tabTruoc && alive(tabTruoc)) tabTruoc.stopFindInPage("clearSelection");
    sendBar("bar:find-reset");
    tabTruoc = wc;
  }
  pushState();
}

/** Gan cac nghe su kien cua thanh tren cung vao webContents cua MOT tab (goi tu tabs.ts khi tao tab). */
export function wireTab(wc: WebContents): void {
  const neuDangChon = () => {
    if (isActive(wc)) pushState();
  };
  wc.on("did-start-loading", neuDangChon);
  wc.on("did-stop-loading", neuDangChon);
  wc.on("did-navigate", neuDangChon);
  wc.on("did-navigate-in-page", neuDangChon);
  // He so thu phong da luu ap lai moi lan trang nap xong.
  wc.on("dom-ready", () => wc.setZoomFactor(getSettings().zoom));
  wc.on("zoom-changed", (_e, dir) => stepZoom(dir === "in" ? 1 : -1)); // Ctrl + lan chuot
  wc.on("found-in-page", (_e, r) => {
    if (r.finalUpdate && isActive(wc)) sendBar("bar:find", { active: r.activeMatchOrdinal, total: r.matches });
  });
  wc.on("before-input-event", onKey);
}

function pushDownloads(list: DownloadEntry[] = listDownloads()): void {
  sendBar("bar:downloads", list);
  if (panel && alive(panel.webContents)) panel.webContents.send("bar:downloads", list);
}

/* ----------------------------- Bang tep tai xuong ----------------------------- */
export function layoutPanel(): void {
  if (!win || !panel || win.isDestroyed()) return;
  const { width, height } = win.getContentBounds();
  const w = Math.min(PANEL_WIDTH, Math.max(0, width - 16));
  const h = Math.min(panelHeight, PANEL_MAX_HEIGHT, Math.max(0, height - TITLEBAR_HEIGHT - 12));
  panel.setBounds({ x: width - w - 8, y: TITLEBAR_HEIGHT, width: w, height: h });
}

function showPanel(): void {
  if (!win || !panel) return;
  win.contentView.addChildView(panel); // them lai = dua len tren cung
  layoutPanel();
  panel.setVisible(true);
  panel.webContents.focus();
  panelOpen = true;
  pushState();
}

function hidePanel(): void {
  if (!panel || !panelOpen) return;
  panel.setVisible(false);
  panelOpen = false;
  panelHiddenAt = Date.now();
  pushState();
}

/* ----------------------------- Thu phong ----------------------------- */
function setZoom(factor: number): void {
  setSetting("zoom", factor);
  for (const v of allTabs()) if (alive(v.webContents)) v.webContents.setZoomFactor(factor);
  pushState();
}

function stepZoom(dir: 1 | -1): void {
  const cur = getSettings().zoom;
  const next =
    dir > 0
      ? ZOOM_STEPS.find((z) => z > cur + 0.001)
      : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.001);
  if (next) setZoom(next);
}

/* ----------------------------- Lenh ----------------------------- */
function reload(hard = false): void {
  const wc = page();
  if (!wc) return;
  if (hard) wc.reloadIgnoringCache();
  else wc.reload();
  wc.focus();
}

function openFind(): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.focus();
  sendBar("bar:find-open");
}

function openDevTools(): void {
  page()?.openDevTools({ mode: "detach" });
}

function popupMenu(pos?: { x?: number; y?: number }): void {
  const wc = page();
  if (!win || !wc) return;
  const zoom = Math.round(getSettings().zoom * 100);
  const hint = (accelerator: string) => ({ accelerator, registerAccelerator: false });
  const menu = Menu.buildFromTemplate([
    { label: "Tìm trong trang", ...hint("CmdOrCtrl+F"), click: openFind },
    { label: "In trang", ...hint("CmdOrCtrl+P"), click: () => wc.print() },
    { type: "separator" },
    { label: "Phóng to", ...hint("CmdOrCtrl+Plus"), click: () => stepZoom(1) },
    { label: "Thu nhỏ", ...hint("CmdOrCtrl+-"), click: () => stepZoom(-1) },
    {
      label: `Về cỡ 100% (đang ${zoom}%)`,
      ...hint("CmdOrCtrl+0"),
      enabled: zoom !== 100,
      click: () => setZoom(1),
    },
    { type: "separator" },
    {
      label: "Sao chép liên kết trang",
      click: () => {
        clipboard.writeText(wc.getURL());
        sendBar("bar:toast", "Đã sao chép liên kết");
      },
    },
    {
      label: "Mở trang này bằng trình duyệt",
      click: () => {
        const url = wc.getURL();
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      },
    },
    { type: "separator" },
    { label: "Tải lại, bỏ bộ nhớ đệm", ...hint("CmdOrCtrl+Shift+R"), click: () => reload(true) },
    {
      label: "Hỏi nơi lưu mỗi lần tải",
      type: "checkbox",
      checked: getSettings().askSavePath,
      click: (item) => setSetting("askSavePath", item.checked),
    },
    { label: "Công cụ nhà phát triển", ...hint("F12"), click: openDevTools },
  ]);
  menu.popup({
    window: win,
    x: Math.round(Number(pos?.x) || 0),
    y: Math.round(Number(pos?.y) || TITLEBAR_HEIGHT),
  });
}

/* ----------------------------- Phim tat ----------------------------- */
// App khong co menu he thong nen phim tat trinh duyet quen tay phai tu bat o day.
function onKey(e: Electron.Event, input: Electron.Input): void {
  if (input.type !== "keyDown") return;
  const wc = page();
  if (!wc) return;
  const mod = isMac ? input.meta : input.control;
  const key = input.key.toLowerCase();

  let hit = true;
  if (key === "f5" || (mod && key === "r")) reload(input.shift || (mod && key === "f5"));
  else if (!isMac && input.alt && key === "arrowleft") wc.navigationHistory.goBack();
  else if (!isMac && input.alt && key === "arrowright") wc.navigationHistory.goForward();
  else if (isMac && mod && key === "[") wc.navigationHistory.goBack();
  else if (isMac && mod && key === "]") wc.navigationHistory.goForward();
  else if (mod && key === "f") openFind();
  else if (mod && key === "j") togglePanel();
  else if (mod && key === "p") wc.print();
  else if (mod && (key === "=" || key === "+")) stepZoom(1);
  else if (mod && key === "-") stepZoom(-1);
  else if (mod && key === "0") setZoom(1);
  else if (key === "f12" || (mod && input.shift && key === "i")) openDevTools();
  // Tab kieu Chrome: Ctrl + T nhan ban trang dang mo, Ctrl + W dong, Ctrl + Tab chuyen, Ctrl + 1..9 nhay toi.
  else if (mod && key === "t") duplicateActive();
  else if (mod && (key === "w" || key === "f4")) closeActive();
  else if (input.control && key === "tab") stepTab(input.shift ? -1 : 1);
  else if (mod && (key === "pagedown" || key === "pageup")) stepTab(key === "pagedown" ? 1 : -1);
  else if (mod && !input.shift && /^[1-9]$/.test(key)) tabAt(Number(key));
  else hit = false;

  if (hit) e.preventDefault();
}

function togglePanel(): void {
  if (panelOpen) hidePanel();
  // Bam nut khi bang dang mo: bang mat focus (tu dong) truoc khi lenh toi noi -> dung mo lai.
  else if (Date.now() - panelHiddenAt > 250) showPanel();
}

/* ----------------------------- IPC tu giao dien thanh tren cung ----------------------------- */
function onAction(sender: WebContents, action: string, arg: unknown): void {
  // Chi nhan lenh tu hai trang noi bo, khong nhan tu webview erpgence.
  if (sender !== win?.webContents && sender !== panel?.webContents) return;
  const wc = page();
  if (!wc) return;

  switch (action) {
    case "ready":
      sendBar("bar:tabs", listTabs());
      pushState();
      pushDownloads();
      break;
    case "back":
      wc.navigationHistory.goBack();
      wc.focus();
      break;
    case "forward":
      wc.navigationHistory.goForward();
      wc.focus();
      break;
    case "reload":
      reload(arg === true);
      break;
    case "stop":
      wc.stop();
      break;
    case "home":
      wc.loadURL(APP_URL);
      wc.focus();
      break;
    case "zoom-reset":
      setZoom(1);
      break;
    case "update-install":
      installUpdate(true);
      break;
    case "tab-new":
      duplicateActive();
      break;
    case "tab-activate":
      activateTab(Number(arg));
      break;
    case "tab-close":
      closeTab(Number(arg));
      break;
    case "tab-move": {
      const m = (arg ?? {}) as { id?: number; to?: number };
      moveTab(Number(m.id), Number(m.to));
      break;
    }
    case "menu":
      popupMenu(arg as { x?: number; y?: number });
      break;
    case "find": {
      const f = (arg ?? {}) as { text?: string; next?: boolean; forward?: boolean };
      const text = typeof f.text === "string" ? f.text : "";
      if (!text) {
        wc.stopFindInPage("clearSelection");
        sendBar("bar:find", { active: 0, total: 0 });
      } else {
        // findNext cua Electron: true = mo luot tim moi, false = di tiep trong luot dang tim.
        wc.findInPage(text, { forward: f.forward !== false, findNext: !f.next });
      }
      break;
    }
    case "find-stop":
      wc.stopFindInPage("clearSelection");
      wc.focus();
      break;
    case "downloads-toggle":
      togglePanel();
      break;
    case "panel-close":
      hidePanel();
      wc.focus();
      break;
    case "panel-height":
      panelHeight = Math.max(80, Math.round(Number(arg) || 0));
      layoutPanel();
      break;
    case "dl-open":
    case "dl-show":
    case "dl-cancel":
    case "dl-remove":
    case "dl-clear":
    case "dl-folder":
      void downloadAction(
        action.slice(3) as Parameters<typeof downloadAction>[0],
        typeof arg === "string" ? arg : undefined,
      );
      break;
  }
}

/** Goi mot lan khi app san sang. */
export function initToolbar(): void {
  ipcMain.on("bar:do", (e, action: string, arg: unknown) => onAction(e.sender, action, arg));
  initDownloads({
    onChange: pushDownloads,
    // Luu thang vao Downloads thi bat bang len cho nguoi dung thay tep vua tai o dau.
    onStart: () => {
      if (!panelOpen && win?.isVisible()) showPanel();
    },
    askSavePath: () => getSettings().askSavePath,
  });
}

/** Goi moi lan tao cua so: gan thanh tren cung vao cua so. Tab erpgence gan qua wireTab(). */
export function attachToolbar(w: BrowserWindow): void {
  win = w;
  tabTruoc = null;
  panelOpen = false;

  // Title bar la file noi bo co cau noi rieng -> khong cho dieu huong di noi khac.
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  panel = new WebContentsView({
    webPreferences: { preload: TOOLBAR_PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  panel.setBackgroundColor("#1d4061"); // khop --bg trong ui/downloads.html
  panel.setVisible(false);
  w.contentView.addChildView(panel);
  panel.webContents.loadFile(path.join(UI_DIR, "downloads.html"));
  panel.webContents.on("will-navigate", (e) => e.preventDefault());
  panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // Bam ra ngoai (webview, title bar, cua so khac) -> dong bang.
  panel.webContents.on("blur", hidePanel);

  w.webContents.on("before-input-event", onKey);
  panel.webContents.on("before-input-event", onKey);
}

export function detachToolbar(): void {
  win = null;
  tabTruoc = null;
  panel = null;
  panelOpen = false;
}
