import { app, BrowserWindow, Notification, powerMonitor } from "electron";
import * as path from "path";
import * as fs from "fs";
import { autoUpdater } from "electron-updater";
import { APP_NAME } from "./config";

/**
 * Tu dong cap nhat qua GitHub Releases.
 *
 * App dong cua so la xuong khay chu KHONG thoat, nen kieu "tai ve roi cai khi thoat" gan nhu
 * khong bao gio chay: ban moi nam san trong may ma nhan vien van dung ban cu ca thang. Vi vay
 * tai xong la app TU cai:
 *   - cua so dang an (o khay / vua khoi dong cung may) du lau -> cai im lang roi mo lai, van an;
 *   - cua so dang mo -> hien nut "Cap nhat" tren thanh tren cung + muc o menu khay, ERP hien
 *     bang bat cap nhat (qua cau noi genceDesktop), va tu cai sau khi nguoi dung dong cua so
 *     xuong khay hoac bo may khong dung toi du lau.
 */
const CHECK_EVERY_MS = 60 * 60 * 1000;
// Cho cua so an lien tuc bang nay roi moi cai - tranh truong hop dong nham roi mo lai ngay.
const HIDDEN_BEFORE_INSTALL_MS =
  (!app.isPackaged && Number(process.env.GENCE_UPDATE_HIDDEN_MS)) || 5 * 60 * 1000;
const RELAUNCH_MARKER_TTL_MS = 3 * 60 * 1000;
// Cua so van mo nhung ca may khong ai dung chuot / ban phim bang nay -> cai luon roi mo lai.
const IDLE_BEFORE_INSTALL_S =
  (!app.isPackaged && Number(process.env.GENCE_UPDATE_IDLE_S)) || 15 * 60;
const IDLE_POLL_MS = (!app.isPackaged && Number(process.env.GENCE_UPDATE_IDLE_POLL_MS)) || 60 * 1000;

interface Hooks {
  getWindow: () => BrowserWindow | null;
  /** Goi ngay truoc khi thoat de cai (bat co isQuitting, luu kich thuoc cua so). */
  beforeQuit: () => void;
  /** Vua co ban moi tai xong, san sang cai. */
  onPending: (version: string) => void;
}

let hooks: Hooks | null = null;
let pending: string | null = null;
let timer: NodeJS.Timeout | null = null;
let idleTimer: NodeJS.Timeout | null = null;

const logFile = () => path.join(app.getPath("userData"), "updater.log");
const markerFile = () => path.join(app.getPath("userData"), ".update-relaunch");

// Nhat ky cap nhat theo may - de tra khi mot may mai khong len ban moi.
function log(msg: string): void {
  try {
    const f = logFile();
    if (fs.existsSync(f) && fs.statSync(f).size > 200_000) fs.writeFileSync(f, "");
    fs.appendFileSync(f, `${new Date().toISOString()} v${app.getVersion()} ${msg}\n`);
  } catch {
    /* ignore */
  }
}

function notify(body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({
      title: APP_NAME,
      body,
      icon: path.join(__dirname, "..", "build", "icon.png"),
    });
    if (onClick) n.on("click", onClick);
    n.show();
  } catch {
    /* ignore */
  }
}

const windowVisible = (): boolean => {
  const w = hooks?.getWindow();
  return !!w && !w.isDestroyed() && w.isVisible();
};

export function pendingVersion(): string | null {
  return pending;
}

/** Trang thai cho ERP doc qua cau noi: ban dang chay + ban da tai xong cho cai (neu co). */
export function updateState(): { current: string; ready: string | null } {
  return { current: app.getVersion(), ready: pending };
}

function watchIdle(): void {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    if (pending && windowVisible() && powerMonitor.getSystemIdleTime() >= IDLE_BEFORE_INSTALL_S) {
      log("may de khong, tu cai");
      installUpdate(true);
    }
  }, IDLE_POLL_MS);
}

/** Thoat, cai ban da tai roi mo lai app. showAfter = false -> mo lai van an o khay. */
export function installUpdate(showAfter: boolean): void {
  if (!pending) return;
  log(`cai ban ${pending}, mo lai ${showAfter ? "hien cua so" : "an o khay"}`);
  try {
    fs.writeFileSync(markerFile(), JSON.stringify({ hidden: !showAfter, at: Date.now() }));
  } catch {
    /* ignore */
  }
  hooks?.beforeQuit();
  autoUpdater.quitAndInstall(true, true); // cai im lang + mo lai app sau khi cai
}

/**
 * Goi mot lan luc khoi dong: app vua duoc mo lai sau khi tu cap nhat luc dang an -> giu an.
 * Dau hieu chi co gia tri vai phut de lan mo tay sau do khong bi an oan.
 */
export function consumeRelaunchHidden(): boolean {
  try {
    const m = JSON.parse(fs.readFileSync(markerFile(), "utf-8"));
    fs.unlinkSync(markerFile());
    return m?.hidden === true && Date.now() - Number(m.at) < RELAUNCH_MARKER_TTL_MS;
  } catch {
    return false;
  }
}

function disarm(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function arm(): void {
  disarm();
  if (!pending || windowVisible()) return;
  timer = setTimeout(() => {
    timer = null;
    if (!windowVisible()) installUpdate(false);
  }, HIDDEN_BEFORE_INSTALL_MS);
}

/** Goi moi lan tao cua so: an xuong khay thi bat dau dem, mo len thi huy. */
export function watchWindow(w: BrowserWindow): void {
  w.on("hide", arm);
  w.on("show", disarm);
}

/** manual = nguoi dung bam "Kiem tra cap nhat" -> luon bao ket qua. */
export async function checkNow(manual = false): Promise<void> {
  try {
    const r = await autoUpdater.checkForUpdates();
    const latest = r?.updateInfo?.version;
    if (!manual) return;
    if (!latest) notify("Không kiểm tra được bản cập nhật. Thử lại sau.");
    else if (latest === app.getVersion()) notify(`Bạn đang dùng bản mới nhất (${latest}).`);
    else if (pending !== latest) notify(`Có bản ${latest}, đang tải về.`);
  } catch (err) {
    log("loi kiem tra: " + ((err as Error)?.message || err));
    if (manual) notify("Không kiểm tra được bản cập nhật. Kiểm tra mạng rồi thử lại.");
  }
}

export function setupAutoUpdate(h: Hooks): void {
  hooks = h;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // van giu: thoat han (khay > Thoat) thi cai luon

  autoUpdater.on("update-available", (info) => log(`co ban ${info.version}, dang tai`));
  autoUpdater.on("update-downloaded", (info) => {
    // Lan kiem tra sau van ban lai su kien nay cho cung mot ban -> chi bao mot lan.
    if (pending !== info.version) {
      pending = info.version;
      log(`da tai xong ban ${pending}`);
      hooks?.onPending(pending);
      if (windowVisible()) {
        notify(
          `Đã tải bản ${pending}. Bấm vào đây để khởi động lại và cập nhật - ` +
            "hoặc app tự cập nhật sau khi bạn đóng cửa sổ.",
          () => installUpdate(true),
        );
      }
    }
    arm();
    watchIdle();
  });
  autoUpdater.on("error", (err) => log("loi: " + (err?.message || err)));

  void checkNow();
  setInterval(() => void checkNow(), CHECK_EVERY_MS);
}
