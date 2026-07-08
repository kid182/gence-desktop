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
};

contextBridge.exposeInMainWorld("genceDesktop", bridge);
