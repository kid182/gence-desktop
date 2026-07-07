# build/ - tài nguyên đóng gói

Cần bổ sung **icon** trước khi build release (electron-builder đọc từ đây):

| File | Kích thước | Dùng cho |
|------|-----------|----------|
| `icon.png` | 512x512 (hoặc 1024) | Linux + cửa sổ + fallback |
| `icon.ico` | multi-size (16-256) | Windows installer + app |
| `icon.icns` | multi-size | macOS app |
| `tray.png` | 16x16 / 32x32 (nền trong) | Tray. macOS nên là template (đen/alpha) đặt tên `trayTemplate.png` nếu muốn tự đổi màu theo theme |

Gợi ý: có 1 file `icon.png` 1024x1024 rồi dùng công cụ tạo `.ico`/`.icns`
(vd `electron-icon-builder`, hoặc online). Đặt logo Gence nền vuông.

`entitlements.mac.plist` - đã có, cho hardened runtime + network client (websocket Reverb).
