/**
 * Cau hinh Gence Desktop. URL frontend erpgence (quanly.gence.vn) - app boc thang
 * web da deploy nen web tu cap nhat, lop vo Electron chi update khi doi ban.
 */
export const APP_URL = "https://quanly.gence.vn";

/** Host duoc phep dieu huong TRONG cua so app. Ngoai danh sach -> mo browser ngoai. */
export const ALLOWED_HOSTS = [
  "quanly.gence.vn",
  "server.gence.vn",
  "ws.gence.vn",
  "accounts.google.com", // dang nhap Google (neu co)
];

/** Ten hien thi: taskbar, tray tooltip, tieu de notification. */
export const APP_NAME = "Gence";

/** Tieu de thanh cua so (khoa cung, khong de web ghi de). */
export const WINDOW_TITLE = "ERP Gence";

/** AppUserModelID - phai khop appId trong electron-builder.yml.
 *  Set ID nay moi het hien "Electron" o taskbar + notification tren Windows. */
export const APP_ID = "vn.gence.desktop";

/** Kich thuoc cua so mac dinh + toi thieu. */
export const WINDOW_DEFAULT = { width: 1440, height: 900 };
export const WINDOW_MIN = { width: 1024, height: 680 };
