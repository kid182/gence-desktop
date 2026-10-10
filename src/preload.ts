import { contextBridge, ipcRenderer } from "electron";

/**
 * Cau noi web (erpgence) <-> native. erpgence phat hien `window.genceDesktop` ->
 * khi co notification realtime (Reverb) thi goi `notify()` de hien Notification OS.
 * An toan: contextIsolation bat, chi expose ham chon loc (khong lo ipcRenderer tho).
 */
export interface GenceDesktopBridge {
  isDesktop: true;
  platform: NodeJS.Platform;
  getVersion: () => string;
  /** Hien native OS notification. url (neu co) -> route mo khi user bam. */
  notify: (payload: { id?: string | number; title: string; body?: string; url?: string }) => void;
  /** Cap nhat badge so chua doc (dock macOS / overlay Windows). */
  setBadge: (count: number) => void;
  /** Dang ky callback khi user bam native notification -> web dieu huong toi url. */
  onOpen: (cb: (url: string) => void) => () => void;

  /** Luu email + mat khau (ma hoa theo may). Tra ve true neu luu thanh cong. */
  saveCredentials: (cred: { username: string; password: string }) => Promise<boolean>;
  /** Doc credential da luu -> autofill form login. null neu chua co / khong giai duoc. */
  loadCredentials: () => Promise<{ username: string; password: string } | null>;
  /** Xoa credential da luu. */
  clearCredentials: () => Promise<boolean>;

  // --- Cap nhat app (co tu 1.0.9; ban cu hon khong co ba ham nay) ---
  /** Bao app kiem tra ban moi ngay (co thi tu tai). Tra ve ban dang chay + ban da tai xong. */
  checkUpdate: () => Promise<{ current: string; ready: string | null }>;
  /** Thoat, cai ban da tai xong roi mo lai app. Khong lam gi neu chua co ban nao tai xong. */
  installUpdate: () => void;
  /** Dang ky callback khi mot ban moi vua tai xong, san sang cai. */
  onUpdateReady: (cb: (version: string) => void) => () => void;
}

const bridge: GenceDesktopBridge = {
  isDesktop: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.sendSync("gence:version") as string,
  notify: (payload) => ipcRenderer.send("gence:notify", payload),
  setBadge: (count) => ipcRenderer.send("gence:badge", count),
  onOpen: (cb) => {
    const listener = (_e: unknown, url: string) => cb(url);
    ipcRenderer.on("gence:open", listener);
    return () => ipcRenderer.removeListener("gence:open", listener);
  },
  saveCredentials: (cred) => ipcRenderer.invoke("gence:cred-save", cred),
  loadCredentials: () => ipcRenderer.invoke("gence:cred-load"),
  clearCredentials: () => ipcRenderer.invoke("gence:cred-clear"),
  checkUpdate: () => ipcRenderer.invoke("gence:update-check"),
  installUpdate: () => ipcRenderer.send("gence:update-install"),
  onUpdateReady: (cb) => {
    const listener = (_e: unknown, version: string) => cb(version);
    ipcRenderer.on("gence:update-ready", listener);
    return () => ipcRenderer.removeListener("gence:update-ready", listener);
  },
};

contextBridge.exposeInMainWorld("genceDesktop", bridge);
// erpgence chay trong WebContentsView ben duoi title bar -> khong can chen dai keo nua
// (title bar cua BrowserWindow lo viec keo/di chuyen cua so). Web fill full view nhu trinh duyet.
