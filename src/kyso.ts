import { BrowserWindow } from "electron";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { PDFDocument } from "pdf-lib";
import signpdf from "@signpdf/signpdf";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { Signer, SUBFILTER_ADOBE_PKCS7_DETACHED } from "@signpdf/utils";

/**
 * Ky so PDF bang USB token dang cam - lam nhu Foxit / Adobe (anh Phuc 16/11/2026).
 *
 * - Chung thu doc tu kho Windows CurrentUser\My: driver token (minidriver) tu day chung thu cua token vao day khi cam,
 *   nen khong phu thuoc hang token. Chi lay chung thu co khoa rieng, con han, co "MST:" trong ten (chung thu phap nhan).
 * - Chuan chu ky: adbe.pkcs7.detached - CMS tach roi SHA-256 tren ByteRange, cung chuan Foxit; KySoPdfService o servergence
 *   da doc duoc chuan nay.
 * - Phan CMS goi .NET (System.Security.Cryptography.Pkcs.SignedCms) qua PowerShell voi silent = false, nen driver token
 *   tu hien o nhap PIN. Gence Desktop khong bao gio thay PIN.
 * - Khoi chu ky hien tren trang duoc VE VAO NOI DUNG trang truoc khi chua cho ky -> nam trong vung ByteRange, sua khoi la hong
 *   chu ky. O widget cua chu ky dat dung vung khoi, bam vao thi Foxit / Adobe hien thong tin chu ky.
 *
 * ⚠ PDF da co chu ky truoc thi ky lai se lam hong chu ky cu (pdf-lib ghi lai ca file, khong ghi noi tiep). PDF cua servergence
 *   chua ky nen v1 chap nhan; can ky nhieu ben thi phai doi sang ghi noi tiep (incremental).
 */

export interface ChungThu {
  thumbprint: string;
  /** CN cua chung thu - ten phap nhan. */
  ten: string;
  /** Ma so thue lay tu "MST:" trong ten chung thu (UID). */
  mst: string;
  /** CN cua noi cap (vd NC-CA). */
  cap_boi: string;
  /** So serial chung thu (hex) - hien tren khung chu ky (tu 1.1.4). */
  serial: string;
  /** Het han, ISO 8601. */
  het_han: string;
}

export interface TuyChonKy {
  thumbprint: string;
  lyDo?: string;
  diaDiem?: string;
  /** KHONG con dung tu 1.1.4 (anh Phuc 16/11: bo anh dau, khung chi co chu cho ca Cong ty). Giu de ban web cu goi khong loi. */
  anhKhoiKy?: Uint8Array;
  /**
   * Vi tri khoi, don vi point PDF, goc toa do duoi-trai trang. trang dem tu 1, bo trong = trang cuoi.
   * Bo trong ca muc = goc duoi phai trang cuoi.
   */
  viTri?: { trang?: number; x: number; y: number; rong: number; cao: number };
}

const TRAN_PDF = 30 * 1024 * 1024;
/** Byte danh cho CMS. Chung thu + chuoi trung gian ~ 3-6 KB; du rong de khong phai ky lai. */
const DO_DAI_CHU_KY = 16384;
/**
 * Khung chu ky rong 7 cm (= 198 pt), cao theo noi dung (~3 cm, chi chu tu 1.1.4). Dat ngay duoi tieu de o ky (timOKy), khong thay thi goc duoi phai trang
 * cuoi, cach le phai 40 pt, le duoi 60 pt.
 * ⚠ Anh dau + chu ky giam doc KHONG dong goi vao app: bo cai phat qua GitHub Releases, ai co bo cai la boc duoc anh ra.
 *   Web lay anh tu servergence (co dang nhap) roi truyen vao `anhKhoiKy`.
 */
const RONG_KHOI = (7 / 2.54) * 72;
const LE = { phai: 40, duoi: 60 };

/* ------------------------------ PowerShell ------------------------------ */

const PS_CHUNG_THU = String.raw`
$ErrorActionPreference = 'Stop'
$now = Get-Date
$out = @()
$ds = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature
$nr = [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::NonRepudiation
foreach ($c in Get-ChildItem Cert:\CurrentUser\My) {
  if (-not $c.HasPrivateKey -or $c.NotAfter -le $now -or $c.NotBefore -gt $now) { continue }
  $m = [regex]::Match($c.Subject, 'MST:([0-9]{10}(-[0-9]{3})?)')
  if (-not $m.Success) { continue }
  $ku = $c.Extensions | Where-Object { $_ -is [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension] }
  if ($ku -and -not (($ku.KeyUsages -band $ds) -or ($ku.KeyUsages -band $nr))) { continue }
  $out += [pscustomobject]@{
    thumbprint = $c.Thumbprint
    ten        = $c.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    mst        = $m.Groups[1].Value
    cap_boi    = $c.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $true)
    het_han    = $c.NotAfter.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    serial     = $c.SerialNumber
  }
}
[IO.File]::WriteAllText($env:GENCE_KYSO_OUT, (ConvertTo-Json -InputObject @($out) -Compress), [Text.Encoding]::UTF8)
`;

const PS_KY = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
function Ky([System.Security.Cryptography.X509Certificates.X509IncludeOption]$kem) {
  $cms = New-Object System.Security.Cryptography.Pkcs.SignedCms ($ci, $true)
  $s = New-Object System.Security.Cryptography.Pkcs.CmsSigner ($cert)
  $s.DigestAlgorithm = New-Object System.Security.Cryptography.Oid '2.16.840.1.101.3.4.2.1'
  $s.IncludeOption = $kem
  [void]$s.SignedAttributes.Add((New-Object System.Security.Cryptography.Pkcs.Pkcs9SigningTime ($luc)))
  $cms.ComputeSignature($s, $false)
  return ,$cms.Encode()
}
# O nhap PIN cua driver token mo trong CHINH tien trinh nay. Electron chay PowerShell an cua so (windowsHide) nen Windows
# mo o PIN o trang thai AN -> nguoi dung khong thay gi, nut "Dang ky so" quay mai (anh Phuc 16/11/2026, token NC-CA).
# Luong nen: thay hop thoai (#32770) cua tien trinh dang an thi bat hien, dua len tren cung.
Add-Type @"
using System; using System.Text; using System.Threading; using System.Diagnostics; using System.Runtime.InteropServices;
public static class HienOPin {
  delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EP f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  public static void Bat() {
    uint toi = (uint)Process.GetCurrentProcess().Id;
    var t = new Thread(() => { while (true) {
      EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p);
        if (p == toi && !IsWindowVisible(h)) { var c = new StringBuilder(64); GetClassName(h, c, 64);
          if (c.ToString() == "#32770") { ShowWindow(h, 5); SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0043); SetForegroundWindow(h); } }
        return true; }, IntPtr.Zero);
      Thread.Sleep(200); } });
    t.IsBackground = true; t.Start();
  }
}
"@
[HienOPin]::Bat()
try {
  $p = 'Cert:\CurrentUser\My\' + $env:GENCE_KYSO_TP
  if (-not (Test-Path $p)) { throw 'KHONG_THAY' }
  $cert = Get-Item $p
  if (-not $cert.HasPrivateKey) { throw 'KHONG_THAY' }
  $data = [IO.File]::ReadAllBytes($env:GENCE_KYSO_IN)
  $ci = New-Object System.Security.Cryptography.Pkcs.ContentInfo (,$data)
  $luc = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$env:GENCE_KYSO_LUC).UtcDateTime
  # Kem chuoi trung gian (nhu Foxit) de trinh doc kiem duoc khong can tai them; may khong dung duoc chuoi thi chi kem chung thu.
  try { $sig = Ky ([System.Security.Cryptography.X509Certificates.X509IncludeOption]::ExcludeRoot) }
  catch {
    $e1 = $_.Exception
    while ($e1.InnerException) { $e1 = $e1.InnerException }
    if ($e1.HResult -eq -2147023673) { throw }
    $sig = Ky ([System.Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly)
  }
  [IO.File]::WriteAllBytes($env:GENCE_KYSO_OUT, $sig)
} catch {
  $ex = $_.Exception
  while ($ex.InnerException) { $ex = $ex.InnerException }
  $msg = $ex.Message
  if ($ex.HResult -eq -2147023673) { $msg = 'HUY' }
  [IO.File]::WriteAllText($env:GENCE_KYSO_ERR, $msg, [Text.Encoding]::UTF8)
  exit 2
}
`;

/** Chay mot script PowerShell (truyen bang -EncodedCommand, khong ghi file script), du lieu vao / ra qua tep tam. */
function chayPs(script: string, env: Record<string, string>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, env: { ...process.env, ...env } },
    );
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    const t = setTimeout(() => {
      p.kill();
      reject(new Error("Hết thời gian chờ ký (chưa nhập PIN?). Thử lại."));
    }, timeoutMs);
    p.on("error", (e) => {
      clearTimeout(t);
      reject(new Error("Không chạy được PowerShell: " + e.message));
    });
    p.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) return resolve();
      const err = env.GENCE_KYSO_ERR && fs.existsSync(env.GENCE_KYSO_ERR) ? fs.readFileSync(env.GENCE_KYSO_ERR, "utf8").replace(/^﻿/, "").trim() : "";
      reject(new Error(err || stderr.trim().split(/\r?\n/).slice(-1)[0] || `PowerShell thoát mã ${code}`));
    });
  });
}

function tepTam(): { dir: string; f: (ten: string) => string; don: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gence-kyso-"));
  return {
    dir,
    f: (ten) => path.join(dir, ten),
    don: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/* ------------------------------ Chung thu ------------------------------ */

export async function chungThu(): Promise<ChungThu[]> {
  if (process.platform !== "win32") return [];
  const t = tepTam();
  try {
    await chayPs(PS_CHUNG_THU, { GENCE_KYSO_OUT: t.f("ds.json") }, 30_000);
    const raw = fs.readFileSync(t.f("ds.json"), "utf8").replace(/^﻿/, "");
    const ds = JSON.parse(raw) as ChungThu[];
    return Array.isArray(ds) ? ds : [];
  } finally {
    t.don();
  }
}

/* ------------------------------ Ky CMS qua kho Windows ------------------------------ */

class WindowsStoreSigner extends Signer {
  constructor(private readonly thumbprint: string) {
    super();
  }

  async sign(pdfBuffer: Buffer, signingTime?: Date): Promise<Buffer> {
    const t = tepTam();
    try {
      fs.writeFileSync(t.f("in.bin"), pdfBuffer);
      await chayPs(
        PS_KY,
        {
          GENCE_KYSO_TP: this.thumbprint,
          GENCE_KYSO_IN: t.f("in.bin"),
          GENCE_KYSO_OUT: t.f("sig.p7s"),
          GENCE_KYSO_ERR: t.f("err.txt"),
          GENCE_KYSO_LUC: String((signingTime ?? new Date()).getTime()),
        },
        180_000,
      );
      return fs.readFileSync(t.f("sig.p7s"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "HUY") throw new Error("Đã huỷ nhập PIN, chưa ký.");
      if (msg === "KHONG_THAY") throw new Error("Không thấy chứng thư đã chọn - USB token đã cắm chưa?");
      throw new Error("Không ký được: " + msg);
    } finally {
      t.don();
    }
  }
}

/* ------------------------------ Khoi chu ky hien tren trang ------------------------------ */

/** Ngay theo gio VN, dd/mm/yyyy - trung ngay cua Pkcs9SigningTime. */
function ngayVN(d: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")}`;
}

const thoatHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Khung + chu ve gap 8 lan kich thuoc tren trang (~576 dpi) - 1.1.3 ve gap 4, phong to thay nhoe (anh Phuc 16/11). */
const PX_MOI_PT = 8;
const MM = 72 / 25.4; // pt

/**
 * Dau tich LON mo ve duoi chu, giua-phai khung, cao 85% khung, net ~11% chieu cao khung, xanh rgba(60,170,90,0.35) - theo khung
 * ky tren hoa don dien tu (mau mau-khoi-ky-so-hkd.png).
 */
const DAU_TICH_MO =
  `<svg class="wm" viewBox="0 0 120 100" preserveAspectRatio="none">` +
  `<path d="M10 58 L42 90 L112 12" fill="none" stroke="rgba(60,170,90,0.35)" stroke-width="13" stroke-linejoin="miter"/></svg>`;

/**
 * Khung chu ky kieu hoa don dien tu, song ngu - CHI CHU, KHONG anh dau (anh Phuc 16/11/2026: "bo hinh anh dau, lam giong Ho
 * Kinh Doanh", ap cho ca Cong ty). Khung rong 7 cm, nen #E6F2FB, vien #96C4E8, cao theo noi dung, dau tich lon mo duoi chu:
 *   Chữ ký hợp lệ (Signature Valid)                        - xanh #1E7832
 *   Ký bởi (Signed By): <CN chung thu>
 *   Cấp bởi (Issued by): <CA, vd NC-CA SHA256>
 *   Số serial (Serial No.): <serial chung thu>              - trung so Foxit / Adobe hien khi mo chu ky
 *   Ký ngày (Signing Date): dd/mm/yyyy                     - chi ngay, gio VN
 * Hai dong CA / serial lay thang tu chung thu tren token (khong go tay) de nguoi nhan doi chieu duoc; anh Phuc chot bo dong
 * MST. Serial 32 ky tu dai hon mot dong -> dat rieng mot dong duoi nhan.
 * Ve bang HTML trong cua so an cua Electron roi chup PNG: chu tieng Viet dung Times New Roman cua Windows ma khong phai them
 * @pdf-lib/fontkit hay nhung font vao PDF.
 */
async function veKhoi(ct: ChungThu, luc: Date, rongPt: number): Promise<{ png: Buffer; rongPx: number; caoPx: number }> {
  const W = Math.round(rongPt * PX_MOI_PT);
  const px = (pt: number) => Math.max(1, Math.round(pt * PX_MOI_PT));
  const le = px(2.2 * MM);
  const dong = (nhan: string, giaTri: string, lop = "") =>
    giaTri ? `<div class="h ${lop}"><i>${nhan}: </i><b>${thoatHtml(giaTri)}</b></div>` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent}
    .k{position:relative;box-sizing:border-box;width:${W}px;padding:${le}px;background:#E6F2FB;border:${px(0.25 * MM)}px solid #96C4E8;
       border-radius:${px(0.7 * MM)}px;font-family:"Times New Roman",Times,serif;line-height:1.2;color:#18274B}
    .d1{position:relative;z-index:1;color:#1E7832;font-size:${px(7.2)}px}.d1 b{font-weight:700}.d1 i{font-weight:400}
    .h{position:relative;z-index:1;display:flex;font-size:${px(7)}px;margin-top:${px(0.5 * MM)}px}
    .h.dau{margin-top:${px(1 * MM)}px}
    .h.tach{display:block}.h.tach b{display:block;white-space:nowrap}
    .h i{flex:none;white-space:pre}.h b{font-weight:700}
    .wm{position:absolute;z-index:0;top:7.5%;left:45%;height:85%;aspect-ratio:1.2}
  </style></head><body><div class="k">${DAU_TICH_MO}
    <div class="d1"><b>Chữ ký hợp lệ</b><i> (Signature Valid)</i></div>
    ${dong("Ký bởi (Signed By)", ct.ten, "dau")}
    ${dong("Cấp bởi (Issued by)", ct.cap_boi)}
    ${dong("Số serial (Serial No.)", ct.serial, "tach")}
    ${dong("Ký ngày (Signing Date)", ngayVN(luc))}
  </div></body></html>`;

  // Cua so cao du cho moi khung, do chieu cao that cua khung roi cat anh chup.
  const H = Math.max(W * 2, 400);
  const win = new BrowserWindow({
    show: false,
    width: W,
    height: H,
    useContentSize: true,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true, javascript: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // Giu khung hinh MOI NHAT: su kien paint den tre, khung "dau tien sau invalidate" co the van la khung cu luc chua ve xong.
  let moiNhat: Electron.NativeImage | null = null;
  win.webContents.on("paint", (_e, _r, image) => {
    if (!image.isEmpty()) moiNhat = image;
  });
  try {
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    // Cho font va hai khung hinh ve xong roi moi do / chup - chup som la ra khung trong (da gap khi thu).
    const cao = Math.ceil(
      (await win.webContents.executeJavaScript(`document.fonts.ready
        .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
        .then(() => document.querySelector(".k").getBoundingClientRect().height)`)) as number,
    );
    win.webContents.invalidate();
    await new Promise((r) => setTimeout(r, 400));
    const chup = moiNhat as Electron.NativeImage | null;
    if (!chup) throw new Error("Không vẽ được khối chữ ký.");
    // Anh paint co the theo he so phong to cua man hinh - quy doi truoc khi cat.
    const tl = chup.getSize().width / W;
    const cat = chup.crop({ x: 0, y: 0, width: Math.round(W * tl), height: Math.min(chup.getSize().height, Math.round(cao * tl)) });
    return { png: cat.toPNG(), rongPx: W, caoPx: cao };
  } finally {
    win.destroy();
  }
}

/* ------------------------------ Tim cho ky tren trang ------------------------------ */

/**
 * Dong tieu de o ky cua ben Gence tren cac van ban (bo dau, viet hoa). Hop dong: "ĐẠI DIỆN BÊN B"; bao gia: "ĐƠN VỊ BÁN HÀNG".
 * Tim tu trang cuoi nguoc len, lay lan xuat hien CUOI.
 */
const MOC_O_KY = ["DAI DIEN BEN B", "DON VI BAN HANG", "DAI DIEN BEN BAN", "BEN BAN"];

const boDau = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "D")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

interface DongChu {
  y: number; // duong chan chu, toa do PDF (goc duoi trai)
  x0: number;
  x1: number;
  co: number; // co chu (pt)
  chu: string;
}

/**
 * Tim o ky cua ben Gence bang pdf.js (anh Phuc 16/11/2026: "can hien ngay duoi phan Dai dien"): gom chu thanh dong theo duong
 * chan, tim dong mang moc, lay them cac dong ngay duoi cung cot (vd "(Ký, ghi rõ họ tên, đóng dấu)"), tra tam ngang cot + dinh
 * cua cho dat khung. Khong thay -> null (kyPdf dat goc duoi phai trang cuoi nhu cu).
 */
async function timOKy(pdf: Uint8Array): Promise<{ trang: number; tamX: number; dinhY: number } | null> {
  // pdf.js chi co ban ESM; ma nay bien dich CommonJS nen tsc doi import() thanh require() - goi import() that qua Function.
  const nap = new Function("m", "return import(m)") as (m: string) => Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>;
  const pdfjs = await nap("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: pdf.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  try {
    for (let so = doc.numPages; so >= 1; so--) {
      const trang = await doc.getPage(so);
      const nd = await trang.getTextContent();
      const dongs: DongChu[] = [];
      for (const it of nd.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        const [a, b, , , e, f] = it.transform as number[];
        const co = Math.hypot(a, b) || 10;
        let d = dongs.find((x) => Math.abs(x.y - f) < co * 0.4 && e < x.x1 + co * 3 && e + it.width > x.x0 - co * 3);
        if (!d) {
          d = { y: f, x0: e, x1: e + it.width, co, chu: "" };
          dongs.push(d);
        }
        d.chu += (d.chu && e > d.x1 + co * 0.15 ? " " : "") + it.str;
        d.x0 = Math.min(d.x0, e);
        d.x1 = Math.max(d.x1, e + it.width);
      }
      for (const moc of MOC_O_KY) {
        const tim = dongs.filter((d) => boDau(d.chu).includes(moc)).sort((p, q) => p.y - q.y)[0];
        if (!tim) continue;
        // Cac dong ngay duoi cung cot, cach nhau khong qua 2 dong - lay dong thap nhat lam day cua phan tieu de o ky.
        let day = tim;
        for (;;) {
          const ke = dongs
            .filter((d) => d.y < day.y - 1 && day.y - d.y < day.co * 2.6 && d.x1 > tim.x0 - 20 && d.x0 < tim.x1 + 20)
            .sort((p, q) => q.y - p.y)[0];
          if (!ke) break;
          day = ke;
        }
        return { trang: so, tamX: (tim.x0 + tim.x1) / 2, dinhY: day.y - day.co * 0.5 - 4 };
      }
    }
    return null;
  } finally {
    await doc.destroy();
  }
}

/* ------------------------------ Ky PDF ------------------------------ */

export async function kyPdf(pdf: Uint8Array, tuyChon: TuyChonKy): Promise<Uint8Array> {
  if (process.platform !== "win32") throw new Error("Ký số chỉ chạy trên Gence Desktop cho Windows.");
  if (!(pdf instanceof Uint8Array) || pdf.byteLength === 0) throw new Error("Không có tệp PDF để ký.");
  if (pdf.byteLength > TRAN_PDF) throw new Error("Tệp PDF quá 30 MB.");
  if (!/^[0-9A-Fa-f]{40}$/.test(tuyChon?.thumbprint ?? "")) throw new Error("Chưa chọn chứng thư số.");
  const ct = (await chungThu()).find((c) => c.thumbprint.toUpperCase() === tuyChon.thumbprint.toUpperCase());
  if (!ct) throw new Error("Không thấy chứng thư đã chọn - USB token đã cắm chưa, chứng thư còn hạn không?");

  const luc = new Date();
  // Tim o ky truoc khi pdf-lib doc file (pdf.js lam viec tren ban sao). Loi doc chu -> dat goc duoi phai nhu cu, van ky.
  const oKy = tuyChon.viTri ? null : await timOKy(pdf).catch(() => null);
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const trangs = doc.getPages();
  const vt = tuyChon.viTri;
  const soTrang = vt?.trang && vt.trang >= 1 && vt.trang <= trangs.length ? vt.trang : (oKy?.trang ?? trangs.length);
  const trang = trangs[soTrang - 1];
  const { width: rongTrang } = trang.getSize();

  // Khung ve san thanh PNG (rong 7 cm). Dat: viTri cua web (vua khit, giu ti le) > ngay duoi tieu de o ky cua ben Gence
  // ("ĐẠI DIỆN BÊN B", can giua theo cot) > goc duoi phai trang cuoi.
  const khoi = await veKhoi(ct, luc, RONG_KHOI);
  const caoKhoi = (RONG_KHOI * khoi.caoPx) / khoi.rongPx;
  const o = vt
    ? { x: vt.x, y: vt.y, rong: vt.rong, cao: vt.cao }
    : oKy
      ? {
          x: Math.min(Math.max(oKy.tamX - RONG_KHOI / 2, 12), rongTrang - RONG_KHOI - 12),
          y: Math.max(oKy.dinhY - caoKhoi, 12),
          rong: RONG_KHOI,
          cao: caoKhoi,
        }
      : { x: rongTrang - RONG_KHOI - LE.phai, y: LE.duoi, rong: RONG_KHOI, cao: caoKhoi };
  const anh = await doc.embedPng(khoi.png);
  const tl = Math.min(o.rong / RONG_KHOI, o.cao / caoKhoi);
  const w = RONG_KHOI * tl;
  const h = caoKhoi * tl;
  trang.drawImage(anh, { x: o.x + (o.rong - w) / 2, y: o.y + (o.cao - h) / 2, width: w, height: h });

  pdflibAddPlaceholder({
    pdfDoc: doc,
    pdfPage: trang,
    reason: tuyChon.lyDo || "Ký số văn bản",
    location: tuyChon.diaDiem || "Việt Nam",
    name: ct.ten,
    contactInfo: "",
    signingTime: luc,
    signatureLength: DO_DAI_CHU_KY,
    subFilter: SUBFILTER_ADOBE_PKCS7_DETACHED,
    widgetRect: [o.x, o.y, o.x + o.rong, o.y + o.cao],
    appName: "Gence Desktop",
  });

  const coCho = Buffer.from(await doc.save({ useObjectStreams: false }));
  const daKy = await signpdf.sign(coCho, new WindowsStoreSigner(ct.thumbprint), luc);
  return new Uint8Array(daKy);
}
