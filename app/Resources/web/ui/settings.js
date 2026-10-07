// The Customize window. Talks to the app through webkit.messageHandlers.app; the app calls App.receive().

const S = { templates: [], active: null, values: {}, state: null, selected: null, loadedPreview: null };
const $ = (id) => document.getElementById(id);
const post = (msg) => window.webkit?.messageHandlers?.app?.postMessage(msg);
const tpl = () => S.templates.find((t) => t.id === S.selected);
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const P = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  plus: P('<path d="M8 3v10M3 8h10"/>'),
  builtin: P('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6h11"/>'),
  builder: P('<path d="M3 13l3-1 7-7-2-2-7 7z"/><path d="M9.5 4.5l2 2"/>'),
  code: P('<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5"/>'),
};

window.App = {
  receive(msg) {
    if (msg.type === "init") {
      S.templates = msg.templates;
      S.active = msg.active;
      S.values = msg.values;
      S.state = msg.state;
      const keep = msg.select || (S.templates.some((t) => t.id === S.selected) ? S.selected : msg.active);
      select(keep, !!msg.select || keep !== S.loadedPreview);
      renderList();
    } else if (msg.type === "state") {
      S.state = msg.state;
      sendPreview();
      renderNowPlaying();
    } else if (msg.type === "clock") {
      if (S.state && S.state.track && S.state.track.id !== "sample") {
        Object.assign(S.state.track, msg.clock);
        $("preview").contentWindow?.postMessage({ type: "sw:clock", clock: msg.clock }, "*");
      }
    } else if (msg.type === "reloadPreview") {
      loadPreview();
    }
  },
};

// ---------- title bar: tell the app which parts are controls (the rest drags the window) ----------

function reportTitlebarHoles() {
  const rects = [...$("topbar").querySelectorAll("button")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  post({ type: "titlebarHoles", rects });
}
new ResizeObserver(reportTitlebarHoles).observe($("topbar"));

// ---------- template list ----------

function renderList() {
  const box = $("templates");
  box.innerHTML = "";
  for (const t of S.templates) {
    const row = h("div", "row-item tpl-row" + (t.id === S.selected ? " sel" : ""));
    row.innerHTML = `<span class="dot">${t.builtin ? ICON.builtin : t.builder ? ICON.builder : ICON.code}</span>
      <span class="txt"><span class="nm"></span><span class="tag">${t.builtin ? "Built-in" : t.builder ? "Made in Builder" : "Custom code"}</span></span>
      ${t.id === S.active ? '<span class="live" title="Current wallpaper"></span>' : ""}`;
    row.querySelector(".nm").textContent = t.name;
    row.onclick = () => { select(t.id, true); renderList(); };
    row.ondblclick = () => { if (t.builder) post({ type: "openBuilder", id: t.id }); };
    box.appendChild(row);
  }
}

function select(id, reloadPreview) {
  S.selected = id;
  const t = tpl();
  if (!t) return;
  $("tplName").textContent = t.name;
  $("tplDesc").textContent = t.description;
  const isActive = t.id === S.active;
  $("activate").disabled = isActive;
  $("activate").textContent = isActive ? "Current Wallpaper" : "Use as Wallpaper";
  $("activeBadge").hidden = !isActive;
  $("editCode").textContent = t.builtin ? "Duplicate & edit code" : t.builder ? "Open in Template Builder" : "Edit code";
  $("reset").hidden = !!t.builder || !t.params.length;
  $("exportTpl").textContent = `Export “${t.name}”…`;
  renderParams();
  renderNowPlaying();
  reportTitlebarHoles();
  if (reloadPreview) loadPreview();
}

// ---------- preview ----------

function loadPreview() {
  const t = tpl();
  if (!t) return;
  S.loadedPreview = t.id;
  const frame = $("preview");
  frame.onload = () => { layoutPreview(); sendPreview(); };
  frame.src = `/template/${encodeURIComponent(t.id)}/index.html?preview=1&t=${Date.now()}`;
  layoutPreview();
}

function layoutPreview() {
  const scr = (S.state && S.state.screen) || { width: 1512, height: 982 };
  const wrap = $("previewWrap").getBoundingClientRect();
  const k = Math.min(wrap.width / scr.width, wrap.height / scr.height);
  const frame = $("preview"), box = $("previewFrame");
  Object.assign(frame.style, { width: scr.width + "px", height: scr.height + "px", transform: `scale(${k})` });
  Object.assign(box.style, { width: scr.width * k + "px", height: scr.height * k + "px",
    left: (wrap.width - scr.width * k) / 2 + "px", top: (wrap.height - scr.height * k) / 2 + "px" });
}
new ResizeObserver(layoutPreview).observe($("previewWrap"));

function sendPreview() {
  const t = tpl(), frame = $("preview");
  if (!t || !S.state || !frame.contentWindow) return;
  frame.contentWindow.postMessage({ type: "sw:live", payload: { ...S.state, params: S.values[t.id] || {} } }, "*");
}

function renderNowPlaying() {
  const tr = S.state && S.state.track;
  $("nowPlaying").textContent = !tr ? "" : tr.id === "sample"
    ? "Previewing with a sample song. Play something in Spotify to see it live."
    : `Live: ${tr.title} — ${tr.artist}`;
}

// ---------- settings ----------

const AUTO_LABELS = {
  vibrant: "Vibrant", dominant: "Dominant", card: "Card", deep: "Deep", dark: "Dark",
  light: "Light", muted: "Muted", paper: "Paper", onDominant: "Text on dominant",
};

function setParam(key, value) {
  const t = tpl();
  (S.values[t.id] = S.values[t.id] || {})[key] = value;
  sendPreview();
  post({ type: "setParam", id: t.id, key, value });
}

function renderParams() {
  const box = $("params");
  box.innerHTML = "";
  const t = tpl();
  if (t.builder) {
    const note = h("div", "builder-note", "This template was made in the Template Builder. Open it there to change the design.");
    const b = h("button", "btn primary wide", "Open in Template Builder");
    b.onclick = () => post({ type: "openBuilder", id: t.id });
    note.appendChild(b);
    box.appendChild(note);
    return;
  }
  if (!t.params.length) {
    box.appendChild(h("div", "builder-note", 'This template has no settings. Add a "params" list to its manifest.json.'));
    return;
  }
  const values = S.values[t.id] || {};
  const sec = h("div", "section");
  for (const p of t.params) sec.appendChild(control(p, values[p.key] !== undefined ? values[p.key] : p.default));
  box.appendChild(sec);
}

function control(p, v) {
  const row = h("div", "param");
  const label = p.label || p.key;

  if (p.type === "bool") {
    const r = h("div", "label-row");
    r.appendChild(h("span", null, label));
    const t = h("label", "toggle");
    t.innerHTML = `<input type="checkbox"><span></span>`;
    const input = t.querySelector("input");
    input.checked = !!v;
    input.onchange = () => setParam(p.key, input.checked);
    r.appendChild(t);
    row.appendChild(r);
    return row;
  }

  row.appendChild(h("div", "label", label));
  if (p.type === "number" || p.type === "int") {
    const wrap = h("div", "slider-row");
    const range = Object.assign(h("input"), { type: "range", min: p.min ?? 0, max: p.max ?? 100, step: p.type === "int" ? 1 : p.step ?? 0.1, value: v });
    const f = h("label", "field");
    const num = Object.assign(h("input"), { type: "text", value: v });
    f.appendChild(num);
    if (p.unit) f.appendChild(h("span", "suf", p.unit));
    range.oninput = () => { num.value = +(+range.value).toFixed(2); setParam(p.key, +range.value); };
    num.onchange = () => { const x = parseFloat(num.value); if (!isNaN(x)) { range.value = x; setParam(p.key, x); } };
    wrap.append(range, f);
    row.appendChild(wrap);
  } else if (p.type === "color") {
    const f = h("div", "field");
    const colors = (S.state && S.state.colors) || {};
    const isAuto = typeof v === "string" && v.startsWith("auto:");
    const resolved = (x) => (typeof x === "string" && x.startsWith("auto:") ? colors[x.slice(5)] || "#888888" : x);
    const sw = h("label", "swatch");
    const fill = h("i");
    fill.style.background = resolved(v);
    const picker = Object.assign(h("input"), { type: "color", value: /^#[0-9a-f]{6}$/i.test(resolved(v) || "") ? resolved(v) : "#888888" });
    sw.append(fill, picker);
    const sel = h("select");
    for (const name of Wallpaper.autoColors) sel.add(new Option(`Auto · ${AUTO_LABELS[name] || name}`, "auto:" + name));
    sel.add(new Option("Custom", "custom"));
    sel.value = isAuto ? v : "custom";
    const set = (x) => { fill.style.background = resolved(x); setParam(p.key, x); };
    sel.onchange = () => { if (sel.value === "custom") set(picker.value.toUpperCase()); else set(sel.value); };
    picker.oninput = () => { sel.value = "custom"; set(picker.value.toUpperCase()); };
    f.append(sw, sel);
    row.appendChild(f);
  } else if (p.type === "font" || p.type === "select") {
    const f = h("label", "field");
    const sel = h("select");
    const opts = p.type === "font" ? Object.keys(Wallpaper.fonts).map((k) => ({ value: k, label: k }))
      : (p.options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
    for (const o of opts) sel.add(new Option(o.label, o.value));
    sel.value = v;
    sel.onchange = () => setParam(p.key, sel.value);
    f.appendChild(sel);
    row.appendChild(f);
  } else {
    const f = h("label", "field");
    const input = Object.assign(h("input"), { type: "text", value: v ?? "" });
    input.oninput = () => setParam(p.key, input.value);
    f.appendChild(input);
    row.appendChild(f);
  }
  return row;
}

// ---------- buttons ----------

$("newTemplate").innerHTML = ICON.plus;
$("newTemplate").onclick = () => post({ type: "newTemplate" });
$("openBuilderTop").onclick = () => post({ type: "newTemplate" });
$("activate").onclick = () => post({ type: "activate", id: S.selected });
$("reset").onclick = () => post({ type: "reset", id: S.selected });
$("editCode").onclick = () => {
  const t = tpl();
  post(t.builder ? { type: "openBuilder", id: t.id } : { type: t.builtin ? "duplicate" : "openFolder", id: t.id });
};
$("openFolder").onclick = () => post({ type: "openFolder" });
$("importTpl").onclick = () => post({ type: "importTemplate" });
$("exportTpl").onclick = () => post({ type: "exportTemplate", id: S.selected });
$("reload").onclick = () => post({ type: "reload" });

post({ type: "ready" });
