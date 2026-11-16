import { BrowserWindow, nativeImage } from "electron";
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
  /** Het han, ISO 8601. */
  het_han: string;
}

export interface TuyChonKy {
  thumbprint: string;
  lyDo?: string;
  diaDiem?: string;
  /** PNG dau do + chu ky + ten giam doc, dat giua dong "Chu ky so dien tu" va dong "Ky boi". Khong co (HKD) thi bo. */
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
 * Khung chu ky rong 7 cm (= 198 pt), cao theo noi dung (~5,8 cm khi co anh dau). Mac dinh dat goc duoi phai trang
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

/** Anh ve gap 4 lan kich thuoc tren trang (~288 dpi) cho net khi in. 1 pt = 4 px. */
const PX_MOI_PT = 4;
const MM = 72 / 25.4; // pt

/**
 * Khoi chu ky kieu hoa don dien tu, song ngu - anh Phuc chot 16/11/2026 (mau mau-khoi-ky-so.png):
 * khung rong 7 cm, bo goc ~0,7 mm, nen #E6F2FB, vien #96C4E8 ~0,25 mm, le trong ~2,2 mm, cao theo noi dung. Can trai theo le:
 *   1. vong tron xanh #1E7832 dau tich trang (~2,4 mm) + "Chữ ký hợp lệ" dam + " (Signature Valid)" nghieng, #1E7832 ~7,2 pt - song ngu nhu cac dong duoi (anh chot 16/11).
 *   2. anh dau + chu ky + "GIAM DOC Pham Minh Phuc" (web truyen), rong het khung tru le, giu ti le. Khong co anh (HKD) thi bo.
 *   3. "Ký bởi (Signed By): " nghieng + CN chung thu dam, ~7 pt #18274B; ten dai xuong dong thut bang nhan.
 *   4. "Ký ngày (Signing Date): " nghieng + dd/mm/yyyy dam - chi ngay, gio VN.
 * Ve bang HTML trong cua so an cua Electron roi chup PNG: chu tieng Viet dung Times New Roman cua Windows ma khong phai them
 * @pdf-lib/fontkit hay nhung font vao PDF.
 */
/** Vong tron xanh dau tich trang dau dong 1 - chi khung CTY (co anh dau). */
const VONG_TICH = (d: number) =>
  `<svg width="${d}" height="${d}" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#1E7832"/>` +
  `<path d="M5.2 10.4l3.1 3.1 6.5-6.7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * Khung HKD (khong anh) - anh chot 16/11 theo khung ky tren hoa don dien tu HKD (mau mau-khoi-ky-so-hkd.png): dau tich LON mo
 * ve duoi chu, giua-phai khung, cao 85% khung, net dày ~11% chieu cao khung (13 / 100 cua 85%), xanh rgba(60,170,90,0.35).
 */
const WATERMARK_HKD =
  `<svg class="wm" viewBox="0 0 120 100" preserveAspectRatio="none">` +
  `<path d="M10 58 L42 90 L112 12" fill="none" stroke="rgba(60,170,90,0.35)" stroke-width="13" stroke-linejoin="miter"/></svg>`;

async function veKhoi(anhPng: Uint8Array | null, ten: string, luc: Date, rongPt: number): Promise<{ png: Buffer; rongPx: number; caoPx: number }> {
  const W = Math.round(rongPt * PX_MOI_PT);
  const px = (pt: number) => Math.max(1, Math.round(pt * PX_MOI_PT));
  const le = px(2.2 * MM);
  const vong = px(2.4 * MM);
  // Anh goc ~2500 px: thu ve dung be rong vung noi dung (gap 4) - du net, va URL data: nho duoi tran 2 MB cua Chromium.
  const anh = anhPng
    ? `<img src="data:image/png;base64,${nativeImage
        .createFromBuffer(Buffer.from(anhPng))
        .resize({ width: W - 2 * le, quality: "best" })
        .toPNG()
        .toString("base64")}">`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent}
    .k{box-sizing:border-box;width:${W}px;padding:${le}px;background:#E6F2FB;border:${px(0.25 * MM)}px solid #96C4E8;
       border-radius:${px(0.7 * MM)}px;font-family:"Times New Roman",Times,serif;line-height:1.2;color:#18274B}
    .d1{display:flex;align-items:center;gap:${px(1.2)}px;color:#1E7832;font-size:${px(7.2)}px}
    .d1 svg{flex:none}.d1 b{font-weight:700}.d1 i{font-weight:400}
    img{display:block;width:100%;height:auto;margin-top:${px(1 * MM)}px}
    .h{display:flex;font-size:${px(7)}px;margin-top:${px(0.5 * MM)}px}
    .h.dau{margin-top:${px(1 * MM)}px}
    .h i{flex:none;white-space:pre}.h b{font-weight:700}
    .k{position:relative}.d1,.h,img{position:relative;z-index:1}
    .wm{position:absolute;z-index:0;top:7.5%;left:45%;height:85%;aspect-ratio:1.2}
  </style></head><body><div class="k">
    ${anhPng ? "" : WATERMARK_HKD}
    <div class="d1">${anhPng ? VONG_TICH(vong) : ""}
      <span><b>Chữ ký hợp lệ</b><i> (Signature Valid)</i></span></div>
    ${anh}
    <div class="h dau"><i>Ký bởi (Signed By): </i><b>${thoatHtml(ten)}</b></div>
    <div class="h"><i>Ký ngày (Signing Date): </i><b>${ngayVN(luc)}</b></div>
  </div></body></html>`;

  // Cua so cao du cho moi anh, do chieu cao that cua khoi roi cat anh chup.
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
  // Giu khung hinh MOI NHAT: su kien paint den tre, khung "dau tien sau invalidate" co the van la khung cu luc anh chua ve.
  let moiNhat: Electron.NativeImage | null = null;
  win.webContents.on("paint", (_e, _r, image) => {
    if (!image.isEmpty()) moiNhat = image;
  });
  try {
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    // Cho font + anh giai ma xong va hai khung hinh ve xong roi moi do / chup - chup som la ra khoi trong (da gap khi thu).
    const cao = Math.ceil(
      (await win.webContents.executeJavaScript(`Promise.all([document.fonts.ready,
        ...Array.from(document.images).map((i) => i.decode().catch(() => null))])
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

/* ------------------------------ Ky PDF ------------------------------ */

export async function kyPdf(pdf: Uint8Array, tuyChon: TuyChonKy): Promise<Uint8Array> {
  if (process.platform !== "win32") throw new Error("Ký số chỉ chạy trên Gence Desktop cho Windows.");
  if (!(pdf instanceof Uint8Array) || pdf.byteLength === 0) throw new Error("Không có tệp PDF để ký.");
  if (pdf.byteLength > TRAN_PDF) throw new Error("Tệp PDF quá 30 MB.");
  if (!/^[0-9A-Fa-f]{40}$/.test(tuyChon?.thumbprint ?? "")) throw new Error("Chưa chọn chứng thư số.");
  const anhPng = tuyChon.anhKhoiKy?.byteLength ? tuyChon.anhKhoiKy : null;
  if (anhPng && !(anhPng[0] === 0x89 && anhPng[1] === 0x50 && anhPng[2] === 0x4e && anhPng[3] === 0x47)) {
    throw new Error("Ảnh khối ký phải là PNG.");
  }

  const ct = (await chungThu()).find((c) => c.thumbprint.toUpperCase() === tuyChon.thumbprint.toUpperCase());
  if (!ct) throw new Error("Không thấy chứng thư đã chọn - USB token đã cắm chưa, chứng thư còn hạn không?");

  const luc = new Date();
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const trangs = doc.getPages();
  const vt = tuyChon.viTri;
  const soTrang = vt?.trang && vt.trang >= 1 && vt.trang <= trangs.length ? vt.trang : trangs.length;
  const trang = trangs[soTrang - 1];
  const { width: rongTrang } = trang.getSize();

  // Khoi ve san thanh PNG (rong 7 cm), dat vao o: viTri cua web (vua khit, giu ti le, can giua) hoac goc duoi phai.
  const khoi = await veKhoi(anhPng, ct.ten, luc, RONG_KHOI);
  const caoKhoi = (RONG_KHOI * khoi.caoPx) / khoi.rongPx;
  const o = vt
    ? { x: vt.x, y: vt.y, rong: vt.rong, cao: vt.cao }
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
