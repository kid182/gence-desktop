// Bang "Tep tai xuong". Nhan danh sach tu main (bar:downloads), gui lenh dl-* nguoc len.
const bar = window.genceBar;
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const tpl = document.getElementById("rowTpl");

// Giu nguyen dong theo id, chi cap nhat noi dung -> tien do nhay lien tuc khong lam truot cu bam.
const rows = new Map();

function fmtSize(n) {
  if (!n || n < 0) return "0 KB";
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)).toLocaleString("vi-VN") + " KB";
  const mb = n / (1024 * 1024);
  if (mb < 1024) return mb.toLocaleString("vi-VN", { maximumFractionDigits: 1 }) + " MB";
  return (mb / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + " GB";
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, "0");
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.toDateString() === new Date().toDateString() ? hm : `${p(d.getDate())}/${p(d.getMonth() + 1)} ${hm}`;
}

function makeRow(id) {
  const el = tpl.content.firstElementChild.cloneNode(true);
  const row = {
    el,
    name: el.querySelector(".name"),
    sub: el.querySelector(".sub"),
    pb: el.querySelector(".pb"),
    fill: el.querySelector(".pb i"),
    show: el.querySelector(".show"),
    x: el.querySelector(".x"),
    state: "",
  };
  row.name.onclick = () => bar.do("dl-open", id);
  row.show.onclick = () => bar.do("dl-show", id);
  row.x.onclick = () => bar.do(row.state === "progressing" ? "dl-cancel" : "dl-remove", id);
  return row;
}

function fill(row, d) {
  row.state = d.state;
  const active = d.state === "progressing";
  const openable = d.state === "completed" && !d.missing;

  row.name.textContent = d.name; // ten tep den tu ngoai -> chi gan dang chu
  row.name.title = openable ? "Mở tệp - " + d.path : d.name;
  row.name.disabled = !openable;
  row.show.hidden = d.missing || d.state === "cancelled" || d.state === "interrupted";
  row.pb.hidden = !active;
  row.x.title = active ? "Huỷ tải" : "Xoá khỏi danh sách";
  row.x.setAttribute("aria-label", row.x.title);

  let sub;
  if (active) {
    const pct = d.total > 0 ? Math.min(100, Math.floor((d.received / d.total) * 100)) : null;
    sub = pct === null ? `Đang tải - ${fmtSize(d.received)}` : `${fmtSize(d.received)} / ${fmtSize(d.total)} - ${pct}%`;
    row.fill.style.width = (pct === null ? 40 : pct) + "%";
  } else if (d.missing) sub = "Tệp đã bị xoá hoặc chuyển đi nơi khác";
  else if (d.state === "completed") sub = `${fmtSize(d.total || d.received)} - ${fmtTime(d.startedAt)}`;
  else if (d.state === "cancelled") sub = "Đã huỷ";
  else sub = "Tải lỗi - thử tải lại từ trang";
  row.sub.textContent = sub;
  row.sub.classList.toggle("bad", !active && (d.missing || d.state === "interrupted"));
}

function render(list) {
  const keep = new Set(list.map((d) => d.id));
  for (const [id, row] of rows) {
    if (keep.has(id)) continue;
    row.el.remove();
    rows.delete(id);
  }

  list.forEach((d, i) => {
    let row = rows.get(d.id);
    if (!row) {
      row = makeRow(d.id);
      rows.set(d.id, row);
    }
    fill(row, d);
    if (listEl.children[i] !== row.el) listEl.insertBefore(row.el, listEl.children[i] || null);
  });

  emptyEl.hidden = list.length > 0;
  listEl.hidden = list.length === 0;
  document.getElementById("clear").disabled = !list.some((d) => d.state !== "progressing");
  reportHeight();
}

// Bao chieu cao that cho main de view vua khit the.
let lastHeight = 0;
function reportHeight() {
  const h = Math.ceil(document.getElementById("card").getBoundingClientRect().height);
  if (h === lastHeight) return;
  lastHeight = h;
  bar.do("panel-height", h);
}

document.getElementById("folder").onclick = () => bar.do("dl-folder");
document.getElementById("clear").onclick = () => bar.do("dl-clear");
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") bar.do("panel-close");
});

bar.on("bar:downloads", render);
render([]);
bar.do("ready");
