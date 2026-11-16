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

/* ---------- Tab lam viec (src/tabs.ts) ---------- */
// Main day danh sach qua bar:tabs: [{ id, title, loading, active }].
// ⚠ Cap nhat TAI CHO theo id, khong ve lai ca dai: ban 1.1.1 ve lai moi lan -> nhan chuot vao dau x lan len tab, tab duoc
//   chon lai, dai ve lai, nut x bi thay giua luc nhan va nha -> khong dong duoc tab (anh Phuc 16/11). Keo tha cung dut vi the.
const tabsEl = $("tabs");
const theTab = new Map(); // id -> phan tu
let dsTab = [];
let keoId = null;

function taoTab(id) {
  const el = document.createElement("div");
  el.className = "tab";
  el.setAttribute("role", "tab");
  el.draggable = true;
  el.dataset.id = id;
  const ic = document.createElement("span");
  ic.className = "ic";
  const ten = document.createElement("span");
  ten.className = "t";
  const x = document.createElement("button");
  x.className = "x";
  x.title = "Đóng tab (Ctrl + W)";
  x.draggable = false;
  x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  // Nhan chuot o dau x KHONG duoc lan len tab (se chon tab va lam lech luot bam).
  x.onmousedown = (e) => e.stopPropagation();
  x.onclick = (e) => {
    e.stopPropagation();
    bar.do("tab-close", id);
  };
  el.append(ic, ten, x);

  el.onmousedown = (e) => {
    if (e.button === 0 && !el.classList.contains("on")) bar.do("tab-activate", id);
  };
  // Chuot giua = dong tab, nhu trinh duyet.
  el.onauxclick = (e) => {
    if (e.button === 1) bar.do("tab-close", id);
  };
  el.ondragstart = (e) => {
    keoId = id;
    el.classList.add("keo");
    e.dataTransfer.effectAllowed = "move";
  };
  el.ondragend = () => {
    keoId = null;
    el.classList.remove("keo");
    tabsEl.querySelectorAll(".dich").forEach((n) => n.classList.remove("dich"));
  };
  el.ondragover = (e) => {
    if (keoId == null) return;
    e.preventDefault();
    tabsEl.querySelectorAll(".dich").forEach((n) => n.classList.remove("dich"));
    el.classList.add("dich");
  };
  el.ondrop = (e) => {
    e.preventDefault();
    if (keoId == null || keoId === id) return;
    bar.do("tab-move", { id: keoId, to: dsTab.findIndex((t) => t.id === id) });
  };
  return el;
}

function veTabs(list) {
  dsTab = list;
  const mot = list.length === 1;
  const conLai = new Set(list.map((t) => t.id));
  for (const [id, el] of theTab) {
    if (!conLai.has(id)) {
      el.remove();
      theTab.delete(id);
    }
  }
  list.forEach((t, i) => {
    let el = theTab.get(t.id);
    if (!el) {
      el = taoTab(t.id);
      theTab.set(t.id, el);
    }
    el.classList.toggle("on", t.active);
    el.classList.toggle("mot", mot);
    el.setAttribute("aria-selected", t.active ? "true" : "false");
    el.title = t.title;
    el.querySelector(".ic").classList.toggle("spin", !!t.loading);
    const ten = el.querySelector(".t");
    if (ten.textContent !== t.title) ten.textContent = t.title;
    el.querySelector(".x").setAttribute("aria-label", "Đóng tab " + t.title);
    // Dat dung thu tu (chi di chuyen phan tu khi lech, khong tao lai).
    if (tabsEl.children[i] !== el) tabsEl.insertBefore(el, tabsEl.children[i] ?? null);
  });
  doBeRong();
  // Giu tab dang chon trong tam nhin khi dai tab tran.
  tabsEl.querySelector(".tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** Be rong that cua mot tab (cac tab bang nhau) -> bat lop hep / rathep cho dai tab, nhu Chrome bot dau x va chu khi chat. */
function doBeRong() {
  const mau = tabsEl.querySelector(".tab");
  const w = mau ? mau.getBoundingClientRect().width : 999;
  tabsEl.classList.toggle("hep", w < 96);
  tabsEl.classList.toggle("rathep", w < 56);
}
new ResizeObserver(doBeRong).observe(tabsEl);

bar.on("bar:tabs", veTabs);
$("newTab").onclick = () => bar.do("tab-new");
// Lan chuot tren dai tab = cuon ngang.
tabsEl.addEventListener("wheel", (e) => {
  if (e.deltaY) {
    tabsEl.scrollLeft += e.deltaY;
    e.preventDefault();
  }
}, { passive: false });

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
// Doi tab: luot tim cu thuoc tab truoc -> dong o tim (main da xoa to sang o tab cu).
bar.on("bar:find-reset", () => {
  if (find.hidden) return;
  find.hidden = true;
  $("findBtn").classList.remove("on");
  findCount.textContent = "";
});
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
  $("newTab").title = "Tab mới - nhân bản trang đang mở (⌘ T)";
}

bar.do("ready");
