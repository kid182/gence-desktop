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

/**
 * Title bar tuy chinh (titleBarStyle: hidden) -> web fill sat len top nhung mat vung keo cua so.
 * Chen 1 dai trang o mep tren phan noi dung (ben PHAI sidebar 256px) de:
 *  - keo/di chuyen cua so (-webkit-app-region: drag)
 *  - top dong nhat nen noi dung mau trang (sidebar trai giu mau rieng cua erpgence)
 * Bat dau tu 256px (be rong sidebar mo - ml-64) nen KHONG che avatar/nut thu gon o sidebar.
 * Nut min/max/close la overlay cua Electron, luon noi len tren dai nay -> van bam duoc.
 */
window.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("gence-drag-strip")) return;
  const strip = document.createElement("div");
  strip.id = "gence-drag-strip";
  strip.style.cssText = [
    "position:fixed",
    "top:0",
    "left:256px",
    "right:0",
    "height:34px",
    "background:#ffffff",
    "z-index:2147483647",
    "-webkit-app-region:drag",
  ].join(";");
  document.body.appendChild(strip);
});
