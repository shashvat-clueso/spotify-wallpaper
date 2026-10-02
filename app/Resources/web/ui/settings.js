// The Customize window. Talks to the app through webkit.messageHandlers.app; the app calls App.receive().

const S = { templates: [], active: null, values: {}, state: null, selected: null };
const $ = (id) => document.getElementById(id);
const post = (msg) => window.webkit?.messageHandlers?.app?.postMessage(msg);
const tpl = () => S.templates.find((t) => t.id === S.selected);

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

// ---------- sidebar ----------

function renderList() {
  const ul = $("templates");
  ul.innerHTML = "";
  for (const t of S.templates) {
    const li = document.createElement("li");
    li.className = t.id === S.selected ? "selected" : "";
    li.innerHTML = `<span class="name"></span><span class="tag">${t.builtin ? "Built-in" : "Custom"}</span>`;
    li.querySelector(".name").textContent = t.name;
    if (t.id === S.active) li.querySelector(".name").insertAdjacentHTML("beforeend", `<span class="badge">● Active</span>`);
    li.onclick = () => { select(t.id, true); renderList(); };
    ul.appendChild(li);
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
  $("editCode").textContent = t.builtin ? "Duplicate & edit code" : "Edit code (opens folder)";
  renderParams();
  renderNowPlaying();
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
  frame.style.width = scr.width + "px";
  frame.style.height = scr.height + "px";
  frame.style.transform = `scale(${k})`;
  box.style.width = scr.width * k + "px";
  box.style.height = scr.height * k + "px";
  box.style.left = (wrap.width - scr.width * k) / 2 + "px";
  box.style.top = (wrap.height - scr.height * k) / 2 + "px";
}
window.addEventListener("resize", layoutPreview);

function sendPreview() {
  const t = tpl(), frame = $("preview");
  if (!t || !S.state || !frame.contentWindow) return;
  frame.contentWindow.postMessage({ type: "sw:live", payload: { ...S.state, params: S.values[t.id] || {} } }, "*");
}

function renderNowPlaying() {
  const tr = S.state && S.state.track;
  $("nowPlaying").textContent = !tr ? "" : tr.id === "sample"
    ? "Previewing with sample data — play something in Spotify to see it live."
    : `Live: ${tr.title} — ${tr.artist}`;
}

// ---------- inspector ----------

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
  if (!t.params.length) {
    box.innerHTML = `<div class="hint">This template has no settings. Add a "params" list to its manifest.json.</div>`;
    return;
  }
  const values = S.values[t.id] || {};
  for (const p of t.params) {
    const v = values[p.key] !== undefined ? values[p.key] : p.default;
    box.appendChild(control(p, v));
  }
}

function control(p, v) {
  const row = document.createElement("div");
  row.className = "row";
  const title = document.createElement("label");
  title.className = "title";
  title.textContent = p.label || p.key;
  row.appendChild(title);

  if (p.type === "number" || p.type === "int") {
    const value = Object.assign(document.createElement("span"), { className: "value" });
    const show = (x) => (value.textContent = (p.type === "int" ? x : +(+x).toFixed(2)) + (p.unit && p.unit !== "%" ? " " + p.unit : p.unit || ""));
    show(v);
    title.appendChild(value);
    const input = Object.assign(document.createElement("input"), {
      type: "range", min: p.min ?? 0, max: p.max ?? 100, step: p.type === "int" ? 1 : p.step ?? 0.1, value: v,
    });
    input.oninput = () => { show(input.value); setParam(p.key, +input.value); };
    row.appendChild(input);
  } else if (p.type === "bool") {
    row.classList.add("inline");
    const toggle = document.createElement("label");
    toggle.className = "toggle";
    toggle.innerHTML = `<input type="checkbox"><span></span>`;
    const input = toggle.querySelector("input");
    input.checked = !!v;
    input.onchange = () => setParam(p.key, input.checked);
    row.appendChild(toggle);
  } else if (p.type === "color") {
    const wrap = Object.assign(document.createElement("div"), { className: "color" });
    const sel = document.createElement("select");
    const colors = (S.state && S.state.colors) || {};
    for (const name of Wallpaper.autoColors) sel.add(new Option(`Auto · ${AUTO_LABELS[name] || name}`, "auto:" + name));
    sel.add(new Option("Custom", "custom"));
    const picker = Object.assign(document.createElement("input"), { type: "color" });
    const isAuto = typeof v === "string" && v.startsWith("auto:");
    sel.value = isAuto ? v : "custom";
    picker.value = isAuto ? colors[v.slice(5)] || "#888888" : v;
    sel.onchange = () => {
      if (sel.value === "custom") setParam(p.key, picker.value);
      else { picker.value = colors[sel.value.slice(5)] || picker.value; setParam(p.key, sel.value); }
    };
    picker.oninput = () => { sel.value = "custom"; setParam(p.key, picker.value); };
    wrap.append(sel, picker);
    row.appendChild(wrap);
  } else if (p.type === "font" || p.type === "select") {
    const sel = document.createElement("select");
    const opts = p.type === "font"
      ? Object.keys(Wallpaper.fonts).map((f) => ({ value: f, label: f }))
      : (p.options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
    for (const o of opts) sel.add(new Option(o.label, o.value));
    sel.value = v;
    sel.onchange = () => setParam(p.key, sel.value);
    row.appendChild(sel);
  } else {
    const input = Object.assign(document.createElement("input"), { type: "text", value: v ?? "" });
    input.oninput = () => setParam(p.key, input.value);
    row.appendChild(input);
  }
  return row;
}

// ---------- buttons ----------

$("activate").onclick = () => post({ type: "activate", id: S.selected });
$("reset").onclick = () => post({ type: "reset", id: S.selected });
$("editCode").onclick = () => post({ type: tpl().builtin ? "duplicate" : "openFolder", id: S.selected });
$("openFolder").onclick = () => post({ type: "openFolder" });
$("reload").onclick = () => post({ type: "reload" });

post({ type: "ready" });
