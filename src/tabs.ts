import { app, BrowserWindow, WebContents, WebContentsView } from "electron";
import * as fs from "fs";
import * as path from "path";
import { APP_URL, ALLOWED_HOSTS } from "./config";

/**
 * Tab lam viec kieu Chrome tren thanh tren cung (anh Phuc 16/11/2026, ban 1.1.1).
 *
 * - Moi tab la mot WebContentsView chay erpgence, cung preload `genceDesktop`; chi tab dang chon hien, cac tab khac an
 *   (trang van chay ngam, giu nguyen cho dang lam).
 * - Nut "+" (Ctrl + T) NHAN BAN trang dang mo: tab moi mo dung duong dan cua tab hien tai, dat ngay ben phai.
 * - Tieu de tab = ten menu. erpgence dat `document.title` = "<ten menu> - ERP Gence" (components/layout/activity-tracker);
 *   o day cat duoi " - ERP Gence". Ban web chua co thi tab hien "ERP Gence".
 * - Danh sach tab luu o userData/tabs.json, mo lai app (ke ca tu cai cap nhat ngam) thi mo lai dung cac tab cu.
 */

export interface TabInfo {
  id: number;
  title: string;
  loading: boolean;
  active: boolean;
}

interface Tab {
  id: number;
  view: WebContentsView;
  title: string;
  loading: boolean;
}

interface Cfg {
  preload: string;
  /** Gan handler cho webContents cua tab moi (mo link, phim tat, trang thai thanh tren cung...). */
  onSetup: (wc: WebContents) => void;
  /** Danh sach / tieu de / tab dang chon doi. */
  onChange: () => void;
}

const TOI_DA = 20;
const TEN_APP = "ERP Gence";

let win: BrowserWindow | null = null;
let cfg: Cfg | null = null;
let tabs: Tab[] = [];
let activeId = 0;
let seq = 0;
let bounds = { x: 0, y: 0, width: 0, height: 0 };
let luuHen: NodeJS.Timeout | null = null;
/** Dang thoat / dong cua so han: webContents bi huy hang loat, khong duoc coi la nguoi dung dong tab (se ghi de tabs.json). */
let dangDong = false;

const tabsFile = () => path.join(app.getPath("userData"), "tabs.json");
const hopLe = (url: string) => {
  try {
    return ALLOWED_HOSTS.includes(new URL(url).host) && new URL(url).host === new URL(APP_URL).host;
  } catch {
    return false;
  }
};

/** "Đơn hàng - ERP Gence" -> "Đơn hàng". Tieu de rong / chi co ten app -> "ERP Gence". */
function tieuDe(raw: string): string {
  const t = (raw || "").replace(/\s*[-|–]\s*ERP Gence\s*$/i, "").trim();
  return t || TEN_APP;
}

function ghiNgay(): void {
  try {
    const song = tabs.filter((t) => !t.view.webContents.isDestroyed());
    const urls = song.map((t) => t.view.webContents.getURL()).filter(hopLe);
    if (!urls.length) return;
    const active = Math.max(0, song.findIndex((t) => t.id === activeId));
    fs.writeFileSync(tabsFile(), JSON.stringify({ urls, active }));
  } catch {
    /* bo qua */
  }
}

function luu(): void {
  if (dangDong) return;
  if (luuHen) clearTimeout(luuHen);
  luuHen = setTimeout(ghiNgay, 500);
}

function doi(): void {
  luu();
  cfg?.onChange();
}

function docLuu(): { urls: string[]; active: number } {
  try {
    const d = JSON.parse(fs.readFileSync(tabsFile(), "utf8"));
    const urls = (Array.isArray(d?.urls) ? d.urls : []).filter((u: unknown) => typeof u === "string" && hopLe(u)).slice(0, TOI_DA);
    if (urls.length) return { urls, active: Math.min(Math.max(0, Number(d.active) || 0), urls.length - 1) };
  } catch {
    /* chua co / hong -> mot tab trang chu */
  }
  return { urls: [APP_URL], active: 0 };
}

/* ----------------------------- Doc ----------------------------- */

export const activeTab = (): WebContentsView | null => tabs.find((t) => t.id === activeId)?.view ?? null;
export const allTabs = (): WebContentsView[] => tabs.map((t) => t.view);
export const isActive = (wc: WebContents): boolean => activeTab()?.webContents === wc;

export function listTabs(): TabInfo[] {
  return tabs.map((t) => ({ id: t.id, title: t.title, loading: t.loading, active: t.id === activeId }));
}

/* ----------------------------- Thao tac ----------------------------- */

export function newTab(url: string, opts: { activate?: boolean; afterId?: number } = {}): void {
  if (!win || !cfg || win.isDestroyed()) return;
  if (tabs.length >= TOI_DA) return;
  const view = new WebContentsView({
    webPreferences: { preload: cfg.preload, contextIsolation: true, nodeIntegration: false, spellcheck: true },
  });
  view.setBackgroundColor("#ffffff");
  const tab: Tab = { id: ++seq, view, title: TEN_APP, loading: true };
  const sau = opts.afterId != null ? tabs.findIndex((t) => t.id === opts.afterId) : -1;
  if (sau >= 0) tabs.splice(sau + 1, 0, tab);
  else tabs.push(tab);

  const wc = view.webContents;
  wc.on("page-title-updated", (_e, title) => {
    tab.title = tieuDe(title);
    doi();
  });
  wc.on("did-start-loading", () => {
    tab.loading = true;
    cfg?.onChange();
  });
  wc.on("did-stop-loading", () => {
    tab.loading = false;
    tab.title = tieuDe(wc.getTitle());
    doi();
  });
  wc.on("did-navigate", luu);
  wc.on("did-navigate-in-page", luu);
  // Trang tu dong (window.close) hoac renderer chet han -> bo tab, khong de o trong.
  wc.on("destroyed", () => {
    if (!dangDong && tabs.includes(tab)) dongTab(tab.id, false);
  });
  // Trang sap (het bo nho, loi renderer) -> tai lai sau 1 giay, giu nguyen tab thay vi de trang trang hay mat tab.
  wc.on("render-process-gone", (_e, d) => {
    if (dangDong || d.reason === "clean-exit") return;
    setTimeout(() => {
      if (!dangDong && !wc.isDestroyed()) wc.reload();
    }, 1000);
  });
  cfg.onSetup(wc);

  view.setVisible(false);
  win.contentView.addChildView(view, 0); // duoi bang tep tai xuong
  view.setBounds(bounds);
  wc.loadURL(hopLe(url) ? url : APP_URL);

  if (opts.activate !== false || tabs.length === 1) activateTab(tab.id);
  else doi();
}

/** Nut "+": nhan ban trang dang mo vao tab moi ngay ben phai. */
export function duplicateActive(): void {
  const cur = activeTab();
  newTab(cur ? cur.webContents.getURL() : APP_URL, { afterId: activeId });
}

export function activateTab(id: number): void {
  const t = tabs.find((x) => x.id === id);
  if (!t || !win) return;
  activeId = id;
  for (const x of tabs) x.view.setVisible(x.id === id);
  t.view.setBounds(bounds);
  if (win.isFocused()) t.view.webContents.focus();
  doi();
}

function dongTab(id: number, huyView = true): void {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  if (huyView) {
    win?.contentView.removeChildView(t.view);
    if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
  }
  if (!tabs.length) {
    // Dong tab cuoi = ve mot tab trang chu (cua so van mo, nhu Chrome giu cua so khi con tab ghim).
    newTab(APP_URL);
    return;
  }
  if (id === activeId) activateTab(tabs[Math.min(i, tabs.length - 1)].id);
  else doi();
}

export const closeTab = (id: number) => dongTab(id);
export const closeActive = () => dongTab(activeId);

/** Ctrl + Tab / Ctrl + Shift + Tab. */
export function stepTab(dir: 1 | -1): void {
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.id === activeId);
  activateTab(tabs[(i + dir + tabs.length) % tabs.length].id);
}

/** Ctrl + 1..8 = tab thu n, Ctrl + 9 = tab cuoi. */
export function tabAt(n: number): void {
  const t = n >= 9 ? tabs[tabs.length - 1] : tabs[n - 1];
  if (t) activateTab(t.id);
}

/** Keo tha: dua tab `id` toi vi tri `toIndex`. */
export function moveTab(id: number, toIndex: number): void {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  tabs.splice(Math.max(0, Math.min(tabs.length, Math.round(toIndex))), 0, t);
  doi();
}

export function layoutTabs(b: { x: number; y: number; width: number; height: number }): void {
  bounds = b;
  activeTab()?.setBounds(b);
}

/** Goi mot lan khi tao cua so: mo lai cac tab da luu (hoac mot tab trang chu). */
export function initTabs(w: BrowserWindow, c: Cfg): void {
  win = w;
  cfg = c;
  dangDong = false;
  tabs = [];
  activeId = 0;
  const { urls, active } = docLuu();
  urls.forEach((u, i) => newTab(u, { activate: i === active }));
  if (!activeTab() && tabs[0]) activateTab(tabs[0].id);
}

/** Goi TRUOC khi cua so dong han (thoat app, tu cai cap nhat): ghi tabs.json lan cuoi roi khoa ghi. */
export function saveTabsBeforeQuit(): void {
  if (dangDong) return;
  if (luuHen) {
    clearTimeout(luuHen);
    luuHen = null;
  }
  ghiNgay();
  dangDong = true;
}

/** Cua so da dong han: quen het tham chieu. */
export function disposeTabs(): void {
  saveTabsBeforeQuit();
  win = null;
  tabs = [];
  activeId = 0;
}
