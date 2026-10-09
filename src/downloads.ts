import { app, session, shell, DownloadItem } from "electron";
import * as path from "path";
import * as fs from "fs";

/**
 * Quan ly tep tai xuong. Mac dinh luu thang vao thu muc Downloads cua may (nhu Chrome) va
 * ghi lai danh sach de bang "Tep tai xuong" tren thanh tren cung mo lai / tim lai duoc.
 */
export type DownloadState = "progressing" | "completed" | "cancelled" | "interrupted";

export interface DownloadEntry {
  id: string;
  name: string;
  path: string;
  total: number;
  received: number;
  state: DownloadState;
  startedAt: number;
  /** Tep da tai xong nhung khong con o duong dan cu (bi xoa / chuyen di). */
  missing?: boolean;
}

interface Options {
  /** Danh sach doi (them, tien do, xong, xoa). */
  onChange: (list: DownloadEntry[]) => void;
  /** Mot luot tai vua bat dau va da biet noi luu. */
  onStart: () => void;
  askSavePath: () => boolean;
}

const MAX_KEEP = 50;
const PROGRESS_THROTTLE_MS = 200;

const historyFile = () => path.join(app.getPath("userData"), "downloads.json");

let list: DownloadEntry[] = [];
const live = new Map<string, DownloadItem>();
let opts: Options | null = null;
let seq = 0;

function load(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(historyFile(), "utf-8"));
    if (!Array.isArray(raw)) return;
    list = raw
      .filter((d) => d && typeof d.id === "string" && typeof d.path === "string")
      .slice(0, MAX_KEEP)
      // App tat giua chung -> luot dang tai coi nhu hong.
      .map((d) => ({ ...d, state: d.state === "progressing" ? "interrupted" : d.state }));
  } catch {
    /* chua co lich su */
  }
}

function save(): void {
  try {
    fs.writeFileSync(historyFile(), JSON.stringify(list.slice(0, MAX_KEEP)));
  } catch {
    /* ignore */
  }
}

let notifyTimer: NodeJS.Timeout | null = null;
function notify(immediate = false): void {
  if (immediate) {
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = null;
    opts?.onChange(list);
    return;
  }
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    opts?.onChange(list);
  }, PROGRESS_THROTTLE_MS);
}

// "bao-cao.xlsx" da co -> "bao-cao (1).xlsx". Tinh ca luot dang tai chua kip tao file.
function uniquePath(dir: string, filename: string): string {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const taken = (p: string) =>
    fs.existsSync(p) || list.some((d) => d.state === "progressing" && d.path === p);
  let candidate = path.join(dir, filename);
  for (let i = 1; taken(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

function track(item: DownloadItem): void {
  const ask = opts?.askSavePath() ?? false;
  // Khong dat duong dan -> Electron tu hien hop chon noi luu.
  if (!ask) item.setSavePath(uniquePath(app.getPath("downloads"), item.getFilename()));

  const entry: DownloadEntry = {
    id: `${Date.now()}-${++seq}`,
    name: item.getFilename(),
    path: item.getSavePath(),
    total: item.getTotalBytes(),
    received: 0,
    state: "progressing",
    startedAt: Date.now(),
  };
  let listed = false;

  // Che do hoi noi luu: chi dua vao danh sach khi nguoi dung da chon xong (bam Huy thi thoi).
  const sync = () => {
    entry.path = item.getSavePath();
    if (entry.path) entry.name = path.basename(entry.path);
    entry.received = item.getReceivedBytes();
    entry.total = item.getTotalBytes();
    if (!listed && entry.path) {
      listed = true;
      list.unshift(entry);
      live.set(entry.id, item);
      opts?.onStart();
    }
  };

  sync();
  notify(true);

  item.on("updated", () => {
    sync();
    notify();
  });
  item.once("done", (_e, state) => {
    sync();
    live.delete(entry.id);
    if (!listed) return;
    entry.state = state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "interrupted";
    if (entry.state === "completed" && !entry.total) entry.total = entry.received;
    if (list.length > MAX_KEEP) list.length = MAX_KEEP;
    save();
    notify(true);
  });
}

export function initDownloads(options: Options): void {
  opts = options;
  load();
  session.defaultSession.on("will-download", (_e, item) => track(item));
}

export function listDownloads(): DownloadEntry[] {
  return list;
}

export type DownloadAction = "open" | "show" | "cancel" | "remove" | "clear" | "folder";

export async function downloadAction(action: DownloadAction, id?: string): Promise<void> {
  if (action === "folder") {
    await shell.openPath(app.getPath("downloads"));
    return;
  }
  if (action === "clear") {
    list = list.filter((d) => d.state === "progressing");
    save();
    notify(true);
    return;
  }

  const entry = list.find((d) => d.id === id);
  if (!entry) return;

  if (action === "cancel") {
    live.get(entry.id)?.cancel();
    return;
  }
  if (action === "remove") {
    live.get(entry.id)?.cancel();
    list = list.filter((d) => d !== entry);
    save();
    notify(true);
    return;
  }

  // open / show: tep co the da bi xoa hoac chuyen di sau khi tai.
  if (!fs.existsSync(entry.path)) {
    entry.missing = true;
    save();
    notify(true);
    return;
  }
  if (action === "show") shell.showItemInFolder(entry.path);
  else if (entry.state === "completed") await shell.openPath(entry.path);
}
