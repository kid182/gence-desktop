import { contextBridge, ipcRenderer } from "electron";

/**
 * Cau noi cho giao dien NOI BO cua thanh tren cung (ui/titlebar.html, ui/downloads.html).
 * KHONG gan vao webview erpgence - trang web chi co `window.genceDesktop` (preload.ts).
 */
const CHANNELS = ["bar:state", "bar:downloads", "bar:find", "bar:find-open", "bar:toast"];

contextBridge.exposeInMainWorld("genceBar", {
  platform: process.platform,
  /** Gui mot lenh len main (back, reload, downloads-toggle, dl-open...). */
  do: (action: string, arg?: unknown) => ipcRenderer.send("bar:do", action, arg),
  /** Nghe trang thai main day xuong. */
  on: (channel: string, cb: (data: unknown) => void) => {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});
