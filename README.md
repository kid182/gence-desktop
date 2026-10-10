# Gence Desktop

Ứng dụng desktop nội bộ (Windows + macOS) bọc frontend **erpgence** (`https://quanly.gence.vn`),
gọi backend **servergence**, nhận **thông báo realtime** (Laravel Reverb) hiển thị dạng
Notification hệ điều hành, và **tự động cập nhật** qua GitHub Releases.

## Kiến trúc
- Electron "mỏng": webview trỏ thẳng `https://quanly.gence.vn` - web tự cập nhật khi deploy,
  lớp vỏ Electron chỉ cần update khi đổi bản (auto-update).
- `preload.ts` expose `window.genceDesktop` (contextBridge, an toàn). erpgence phát hiện bridge
  này để đẩy notification realtime sang **native Notification + badge + tray**.
- Auto-update: `electron-updater` <- GitHub Releases (build bằng GitHub Actions).

## Thanh trên cùng
Cửa sổ gồm hai lớp: `BrowserWindow` vẽ thanh trên cùng (`ui/titlebar.html`), erpgence nằm trong
`WebContentsView` bên dưới. Logic ở `src/toolbar.ts`, tải xuống ở `src/downloads.ts`.

| Nút | Việc | Phím tắt |
|-----|------|----------|
| Lùi / Tới | Lịch sử điều hướng của trang | `Alt + ←` / `Alt + →` |
| Tải lại | Đang nạp thì thành nút Dừng. Giữ `Shift` khi bấm = bỏ bộ nhớ đệm | `F5`, `Ctrl + R`, `Ctrl + Shift + R` |
| Trang chủ | Về `APP_URL` | |
| Tìm | Ô tìm trong trang ngay trên thanh, có đếm kết quả | `Ctrl + F` |
| Tệp tải xuống | Bảng danh sách: mở tệp, hiện trong thư mục, huỷ, xoá khỏi danh sách | `Ctrl + J` |
| `...` | In trang, thu phóng, sao chép liên kết, mở bằng trình duyệt, DevTools | `Ctrl + P`, `Ctrl + +/-/0`, `F12` |

- Tệp tải về **lưu thẳng vào thư mục Downloads của máy** (trùng tên thì thêm ` (1)`), bảng tự bật
  lên. Muốn chọn nơi lưu từng lần: menu `...` > "Hỏi nơi lưu mỗi lần tải".
- Lịch sử tải (50 dòng gần nhất), hệ số thu phóng và lựa chọn trên lưu ở `userData`
  (`downloads.json`, `settings.json`) - theo từng máy.
- Hai trang trong `ui/` dùng cầu nối riêng `window.genceBar` (`src/toolbar-preload.ts`). erpgence
  **không** thấy cầu nối này, main cũng chỉ nhận lệnh `bar:do` từ hai trang nội bộ đó.
- Thêm nút mới: thêm `<button>` vào `ui/titlebar.html`, gọi `bar.do("<lệnh>")` trong
  `ui/titlebar.js`, xử lý ở `onAction` trong `src/toolbar.ts`.

⚠ Chạy thử từ terminal của VSCode phải bỏ biến `ELECTRON_RUN_AS_NODE` (VSCode đặt sẵn = 1, Electron
sẽ chạy như Node thuần và không mở cửa sổ): `env -u ELECTRON_RUN_AS_NODE npm start`.

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

### Bản mới được cài lúc nào (`src/updater.ts`)
App đóng cửa sổ là xuống khay chứ không thoát, nên không trông vào "cài khi thoát" được - đến
1.0.8 bản mới tải về xong vẫn nằm chờ, nhân viên dùng bản cũ cả tháng. Từ 1.0.9:

- App kiểm tra lúc mở và mỗi giờ; có bản mới thì tự tải.
- Cửa sổ **đang ẩn** (ở khay, hoặc vừa khởi động cùng máy) liên tục 5 phút -> tự cài im lặng rồi mở
  lại, vẫn ẩn.
- Cửa sổ **đang mở** -> hiện nút vàng "Cập nhật" trên thanh trên cùng + mục ở menu khay; bấm là
  khởi động lại và cài. Không bấm thì app tự cài sau khi người dùng đóng cửa sổ xuống khay.
- Cửa sổ mở nhưng cả máy không ai đụng chuột / bàn phím 15 phút -> tự cài rồi mở lại.
- ERP cũng ép: `components/layout/desktop-update-gate.tsx` bên erpgence hỏi bản mới nhất qua
  `/api/desktop-version`, gọi `genceDesktop.checkUpdate()` để app tải ngay, tải xong thì hiện bảng
  "Cập nhật ngay" (gọi `genceDesktop.installUpdate()`). Được hoãn 3 lần, mỗi lần 15 phút.
- Nhật ký từng máy: `%APPDATA%\gence-desktop\updater.log` - tra khi một máy mãi không lên bản.

⚠ Máy còn ở bản **1.0.8 trở xuống** chưa có cơ chế này, và web KHÔNG có lệnh nào bắt các bản đó
thoát hay cài (cầu nối cũ chỉ có thông báo, badge, lưu mật khẩu). ERP hiện bảng hướng dẫn: chuột
phải biểu tượng Gence ở khay > **Thoát** rồi mở lại (bản đã tải sẽ cài lúc thoát), hoặc tải bộ cài.

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


cd C:\Users\Admin\Gence Projects\tools\gence-desktop
npm version patch          # 1.0.0 -> 1.0.1, tự commit + tạo tag v1.0.1
git push
git push --tags            # <-- kích hoạt CI
