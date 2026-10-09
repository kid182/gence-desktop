import { app } from "electron";
import * as path from "path";
import * as fs from "fs";

/** Lua chon cua nguoi dung tren thanh tren cung - luu theo may trong userData/settings.json. */
export interface Settings {
  /** He so thu phong trang (1 = 100%). */
  zoom: number;
  /** true = moi lan tai hien hop chon noi luu; false = luu thang vao thu muc Downloads. */
  askSavePath: boolean;
}

const DEFAULTS: Settings = { zoom: 1, askSavePath: false };
const file = () => path.join(app.getPath("userData"), "settings.json");

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  cache = { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf-8"));
    if (typeof raw?.zoom === "number" && raw.zoom >= 0.25 && raw.zoom <= 5) cache.zoom = raw.zoom;
    if (typeof raw?.askSavePath === "boolean") cache.askSavePath = raw.askSavePath;
  } catch {
    /* chua co file -> dung mac dinh */
  }
  return cache;
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const s = getSettings();
  s[key] = value;
  try {
    fs.writeFileSync(file(), JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
