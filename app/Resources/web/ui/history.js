// The History Wall. Talks to the app through webkit.messageHandlers.app; the app calls App.receive().

const S = { entries: [], enabled: true, query: "", month: "", shown: [], open: -1, busy: false };
const $ = (id) => document.getElementById(id);
const post = (msg) => window.webkit?.messageHandlers?.app?.postMessage(msg);
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const P = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  search: P('<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L13.5 13.5"/>'),
  close: P('<path d="M4 4l8 8M12 4l-8 8"/>'),
  prev: P('<path d="M10 3.5L5.5 8l4.5 4.5"/>'),
  next: P('<path d="M6 3.5L10.5 8 6 12.5"/>'),
};

const monthName = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }); };
const songs = (n) => `${n.toLocaleString("en-US")} ${n === 1 ? "song" : "songs"}`;
const when = (ts) => new Date(ts).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const longWhen = (ts) => new Date(ts).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

window.App = {
  receive(msg) {
    if (msg.type === "init") {
      const openID = S.open >= 0 ? S.shown[S.open]?.id : null;
      S.entries = [...msg.entries].sort((a, b) => b.timestamp - a.timestamp);  // newest first
      S.enabled = msg.enabled !== false;
      renderMonths();
      render();
      if (openID) { const i = S.shown.findIndex((e) => e.id === openID); i >= 0 ? openViewer(i) : closeViewer(); }
    } else if (msg.type === "busy") {
      S.busy = true;
      updateButtons();
      toast(msg.text, true);
    } else if (msg.type === "toast") {
      S.busy = false;
      updateButtons();
      toast(msg.text);
    }
  },
};

// ---------- title bar: tell the app which parts are controls (the rest drags the window) ----------

function reportTitlebarHoles() {
  const els = [...$("topbar").querySelectorAll("button, .field")];
  if (!$("viewer").hidden) els.push($("vClose"));
  post({ type: "titlebarHoles", rects: els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }) });
}
new ResizeObserver(reportTitlebarHoles).observe($("topbar"));

// ---------- filtering ----------

function matches(e, q) {
  if (!q) return true;
  const hay = `${e.title} ${e.artist} ${e.album} ${e.templateName || e.template}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function renderMonths() {
  const sel = $("month"), months = [...new Set(S.entries.map((e) => e.month))];
  if (S.month && !months.includes(S.month)) S.month = "";
  sel.innerHTML = "";
  sel.add(new Option("All months", ""));
  for (const m of months) sel.add(new Option(monthName(m), m));
  sel.value = S.month;
}

function render() {
  const q = S.query.trim().toLowerCase();
  S.shown = S.entries.filter((e) => (!S.month || e.month === S.month) && matches(e, q));
  const total = S.entries.length;
  $("count").textContent = total ? (S.shown.length === total ? songs(total) : `${S.shown.length.toLocaleString("en-US")} of ${songs(total)}`) : "";
  updateButtons();

  const wall = $("wall");
  wall.innerHTML = "";
  wall.scrollTop = 0;
  if (!S.shown.length) {
    const box = h("div", "empty");
    if (!total) {
      box.append(h("h3", null, "No wallpapers yet"),
        h("p", null, S.enabled ? "Every song you play gets its wallpaper saved here, one per song. Play something in Spotify."
          : "History is off. Turn on “Keep a History of Wallpapers” in the menu bar to start collecting."));
    } else {
      box.append(h("h3", null, "Nothing matches"), h("p", null, "Try another word, or pick All months."));
    }
    wall.appendChild(box);
    return;
  }
  let grid = null, month = null, i = 0;
  const counts = {};
  for (const e of S.shown) counts[e.month] = (counts[e.month] || 0) + 1;
  for (const e of S.shown) {
    if (e.month !== month) {
      month = e.month;
      const head = h("div", "month-head");
      head.append(h("h2", null, monthName(month)), h("span", null, "· " + songs(counts[month])));
      grid = h("div", "grid");
      wall.append(head, grid);
    }
    grid.appendChild(tile(e, i++));
  }
}

function tile(e, index) {
  const t = h("div", "tile");
  if (e.width && e.height) t.style.aspectRatio = `${e.width} / ${e.height}`;
  const img = h("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.src = e.thumb;
  img.alt = "";
  const cap = h("div", "cap");
  cap.append(h("b", null, e.title), h("span", null, e.artist), h("span", null, when(e.timestamp)));
  t.append(img, cap);
  t.onclick = () => openViewer(index);
  return t;
}

function updateButtons() {
  $("exportSheet").disabled = S.busy || !S.shown.length;
  $("exportGif").disabled = S.busy || !S.shown.length;
}

// what the exports cover: the month picked, the filter, or everything shown
function heading() {
  const n = S.shown.length, q = S.query.trim();
  const base = S.month ? monthName(S.month) : q ? `“${q}”` : "Listening history";
  return S.month && q ? `${base} · “${q}” · ${songs(n)}` : `${base} · ${songs(n)}`;
}

// ---------- viewer ----------

function openViewer(i) {
  if (i < 0 || i >= S.shown.length) return;
  S.open = i;
  const e = S.shown[i];
  $("vImg").src = e.image;
  $("vTitle").textContent = e.title;
  $("vSub").textContent = [e.artist, e.album, e.templateName || e.template, longWhen(e.timestamp)].filter(Boolean).join(" · ");
  $("vPos").textContent = `${i + 1} / ${S.shown.length}`;
  $("vPrev").disabled = i === 0;
  $("vNext").disabled = i === S.shown.length - 1;
  // warm the neighbours so arrowing is instant
  for (const j of [i - 1, i + 1]) if (S.shown[j]) new Image().src = S.shown[j].image;
  if ($("viewer").hidden) { $("viewer").hidden = false; reportTitlebarHoles(); }
}

function closeViewer() {
  S.open = -1;
  $("viewer").hidden = true;
  reportTitlebarHoles();
}

document.addEventListener("keydown", (ev) => {
  if ($("viewer").hidden) {
    if (ev.key === "Escape" && S.query) { S.query = $("filter").value = ""; render(); }
    return;
  }
  if (ev.key === "ArrowLeft") { openViewer(S.open - 1); ev.preventDefault(); }
  else if (ev.key === "ArrowRight") { openViewer(S.open + 1); ev.preventDefault(); }
  else if (ev.key === "Escape") closeViewer();
});
$("viewer").addEventListener("click", (ev) => { if (ev.target === $("viewer") || ev.target.tagName === "FIGURE") closeViewer(); });

// ---------- toast ----------

let toastTimer = 0;
function toast(text, sticky) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- wiring ----------

$("searchIcon").innerHTML = ICON.search;
$("vClose").innerHTML = ICON.close;
$("vPrev").innerHTML = ICON.prev;
$("vNext").innerHTML = ICON.next;
$("vClose").onclick = closeViewer;
$("vPrev").onclick = () => openViewer(S.open - 1);
$("vNext").onclick = () => openViewer(S.open + 1);
$("vReveal").onclick = () => S.shown[S.open] && post({ type: "reveal", id: S.shown[S.open].id });
let filterTimer = 0;
$("filter").oninput = () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => { S.query = $("filter").value; render(); }, 120); };
$("month").onchange = () => { S.month = $("month").value; render(); };
$("exportSheet").onclick = () => post({ type: "exportSheet", ids: S.shown.map((e) => e.id), heading: heading() });
$("exportGif").onclick = () => post({ type: "exportGif", ids: S.shown.map((e) => e.id), heading: heading() });

post({ type: "ready" });
