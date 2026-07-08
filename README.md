# Gence Desktop

Ứng dụng desktop nội bộ (Windows + macOS) bọc frontend **erpgence** (`https://quanly.gence.vn`),
gọi backend **servergence**, nhận **thông báo realtime** (Laravel Reverb) hiển thị dạng
Notification hệ điều hành, và **tự động cập nhật** qua GitHub Releases.

## Kiến trúc
- Electron "mỏng": `BrowserWindow.loadURL("https://quanly.gence.vn")` - web tự cập nhật khi deploy,
  lớp vỏ Electron chỉ cần update khi đổi bản (auto-update).
- `preload.ts` expose `window.genceDesktop` (contextBridge, an toàn). erpgence phát hiện bridge
  này để đẩy notification realtime sang **native Notification + badge + tray**.
- Auto-update: `electron-updater` <- GitHub Releases (build bằng GitHub Actions).

## Chạy dev
```bash
npm install
npm start        # build TS + mở Electron trỏ tới quanly.gence.vn
```

## Build release
```bash
npm run dist         # build cho OS hiện tại (ra thư mục release/)
npm run dist:win     # chỉ Windows
npm run dist:mac     # chỉ macOS (cần chạy trên máy Mac)
```
> Cần bổ sung icon trong `build/` trước (xem `build/README.md`).

## Auto-update qua GitHub Actions
Push tag `v*` (vd `git tag v1.0.1 && git push origin v1.0.1`) -> CI build Windows + macOS ->
publish lên **GitHub Releases** -> app tự tải & cập nhật.

### Secrets cần cấu hình trong repo (Settings > Secrets and variables > Actions)
| Secret | Dùng cho |
|--------|----------|
| `GITHUB_TOKEN` | tự có sẵn - tạo Release + upload |
| `MAC_CSC_LINK` | Chứng chỉ **Developer ID Application** (.p12) mã hoá base64 |
| `MAC_CSC_KEY_PASSWORD` | Mật khẩu file .p12 |
| `APPLE_ID` | Apple ID (email) |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (appleid.apple.com) |
| `APPLE_TEAM_ID` | Team ID (10 ký tự) |

Windows hiện **build unsigned** (auto-update vẫn chạy, chỉ có cảnh báo SmartScreen). Thêm cert
Windows sau qua `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` nếu cần.

### ⚠️ Auto-update với repo PRIVATE
`electron-updater` tải bản cập nhật từ Release. Repo **private** thì client cần token đọc để tải.
2 hướng:
1. **Để Releases public** (source vẫn private nếu tách repo release, hoặc chấp nhận public repo) -
   app là lớp vỏ không chứa secret nên rủi ro thấp - **đơn giản nhất**.
2. Nhúng **fine-grained PAT read-only** (chỉ repo này) vào app qua env `GH_TOKEN` lúc build -
   tiện nhưng token nằm trong app. Cân nhắc.

## Thông báo (bridge)
erpgence gọi `window.genceDesktop.notify({ title, body, url })` khi có notification Reverb mới,
và `setBadge(unreadCount)`. Xem `hooks/use-user-notifications.ts` trong erpgence.


cd C:\Users\Admin\gence-desktop
npm version patch          # 1.0.0 -> 1.0.1, tự commit + tạo tag v1.0.1
git push
git push --tags            # <-- kích hoạt CI
