// Thanh tren cung. Moi lenh gui len main qua window.genceBar (src/toolbar-preload.ts);
// main day trang thai xuong qua cac kenh bar:*.
const bar = window.genceBar;
const $ = (id) => document.getElementById(id);

const reloadBtn = $("reload");
const find = $("find");
const findInput = $("findInput");
const findCount = $("findCount");
let loading = false;
let panelOpen = false;

/* ---------- Dieu huong ---------- */
$("back").onclick = () => bar.do("back");
$("forward").onclick = () => bar.do("forward");
$("home").onclick = () => bar.do("home");
// Giu Shift / Ctrl khi bam = tai lai bo bo nho dem.
reloadBtn.onclick = (e) => bar.do(loading ? "stop" : "reload", e.shiftKey || e.ctrlKey);
$("zoom").onclick = () => bar.do("zoom-reset");
$("update").onclick = () => bar.do("update-install");
$("dl").onclick = () => bar.do("downloads-toggle");
$("more").onclick = () => {
  const r = $("more").getBoundingClientRect();
  bar.do("menu", { x: r.left, y: r.bottom + 4 });
};

bar.on("bar:state", (s) => {
  $("back").disabled = !s.canGoBack;
  $("forward").disabled = !s.canGoForward;

  loading = !!s.loading;
  reloadBtn.classList.toggle("loading", loading);
  reloadBtn.title = loading ? "Dừng tải trang" : "Tải lại trang (F5)";
  reloadBtn.setAttribute("aria-label", reloadBtn.title);
  $("load").hidden = !loading;

  $("zoom").hidden = s.zoom === 100;
  $("zoom").textContent = s.zoom + "%";

  $("update").hidden = !s.update;
  if (s.update) $("update").title = `Đã tải bản ${s.update} - bấm để khởi động lại và cập nhật`;

  panelOpen = !!s.panelOpen;
  $("dl").classList.toggle("on", panelOpen);
  if (panelOpen) $("dlDot").hidden = true;
});

/* ---------- Tep tai xuong: vach tien do + cham bao tep moi ---------- */
const seenDone = new Set();
let firstList = true;
bar.on("bar:downloads", (list) => {
  const active = list.filter((d) => d.state === "progressing");
  const total = active.reduce((n, d) => n + (d.total || 0), 0);
  const received = active.reduce((n, d) => n + (d.received || 0), 0);
  $("dlProg").hidden = active.length === 0;
  // Server khong bao dung luong -> khong tinh duoc phan tram, de vach o muc giua.
  $("dlFill").style.width = total > 0 ? Math.min(100, (received / total) * 100) + "%" : "40%";

  for (const d of list) {
    if (d.state !== "completed" || seenDone.has(d.id)) continue;
    seenDone.add(d.id);
    if (!firstList && !panelOpen) $("dlDot").hidden = false;
  }
  firstList = false;
});

/* ---------- Tim trong trang ---------- */
function openFind() {
  find.hidden = false;
  $("findBtn").classList.add("on");
  findInput.focus();
  findInput.select();
  if (findInput.value) bar.do("find", { text: findInput.value });
}

function closeFind() {
  if (find.hidden) return;
  find.hidden = true;
  $("findBtn").classList.remove("on");
  findCount.textContent = "";
  bar.do("find-stop");
}

function findStep(forward) {
  if (findInput.value) bar.do("find", { text: findInput.value, next: true, forward });
}

$("findBtn").onclick = () => (find.hidden ? openFind() : closeFind());
$("findClose").onclick = closeFind;
$("findPrev").onclick = () => findStep(false);
$("findNext").onclick = () => findStep(true);
findInput.oninput = () => bar.do("find", { text: findInput.value });
findInput.onkeydown = (e) => {
  if (e.key === "Enter") findStep(!e.shiftKey);
  else if (e.key === "Escape") closeFind();
};

bar.on("bar:find-open", openFind);
bar.on("bar:find", (r) => {
  const has = !!findInput.value;
  findCount.textContent = has ? `${r.active}/${r.total}` : "";
  findCount.classList.toggle("none", has && r.total === 0);
});

/* ---------- Dong thong bao ngan ---------- */
let toastTimer = null;
bar.on("bar:toast", (text) => {
  const el = $("toast");
  el.textContent = String(text);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
});

// macOS dung phim Cmd va khong co Alt + mui ten -> sua goi y cho dung.
if (bar.platform === "darwin") {
  $("back").title = "Quay lại (⌘ [)";
  $("forward").title = "Tiến tới (⌘ ])";
  $("findBtn").title = "Tìm trong trang (⌘ F)";
  $("dl").title = "Tệp tải xuống (⌘ J)";
}

bar.do("ready");
