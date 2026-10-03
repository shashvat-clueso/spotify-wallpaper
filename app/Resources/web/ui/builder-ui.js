// Template Builder: a Figma-style, no-code editor for templates. A design is a background plus a list of layers
// positioned in % of the screen. The canvas iframe renders it with the real template runtime (builder.js), so the
// canvas is exactly what the wallpaper draws; the overlay on top handles selection, dragging and drawing.

const $ = (id) => document.getElementById(id);
const post = (m) => window.webkit?.messageHandlers?.app?.postMessage(m);
const clone = (o) => JSON.parse(JSON.stringify(o));
const round = (v, step = 0.1) => Math.round(v / step) * step;
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// ---------- icons (16px line icons) ----------

const P = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  move: P('<path d="M4 2.5l8 5-3.6.9 2.1 3.9-1.5.8-2.1-3.9L4 11.5z" fill="currentColor" stroke="none"/>'),
  text: P('<path d="M3.5 4V3h9v1M8 3v10M6 13h4"/>'),
  rect: P('<rect x="2.5" y="3.5" width="11" height="9" rx="1"/>'),
  ellipse: P('<ellipse cx="8" cy="8" rx="5.5" ry="5"/>'),
  line: P('<path d="M3 13L13 3"/>'),
  triangle: P('<path d="M8 2.8l5.5 9.7h-11z"/>'),
  star: P('<path d="M8 2.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.6 3.8-.5z"/>'),
  polygon: P('<path d="M8 2.5l5 3.6-1.9 5.9H4.9L3 6.1z"/>'),
  arrow: P('<path d="M2.5 8h10M9 4.5L12.5 8 9 11.5"/>'),
  image: P('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.1"/><path d="M13.5 10.5l-3-3-6.5 5.5"/>'),
  lyrics: P('<path d="M2.5 4h11M2.5 7h8M2.5 10h11M2.5 13h6"/>'),
  cover: P('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><circle cx="7" cy="10" r="1.5"/><path d="M8.5 10V5.5l3-1"/>'),
  vinyl: P('<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2"/><circle cx="8" cy="8" r=".4" fill="currentColor"/>'),
  progress: P('<rect x="2" y="7" width="12" height="2" rx="1"/><path d="M2.5 8h6" stroke-width="2.2"/>'),
  wave: P('<path d="M3 6.5v3M5.5 4.5v7M8 3v10M10.5 5v6M13 7v2"/>'),
  swatches: P('<rect x="2" y="4.5" width="3.4" height="7" rx=".6"/><rect x="6.3" y="4.5" width="3.4" height="7" rx=".6"/><rect x="10.6" y="4.5" width="3.4" height="7" rx=".6"/>'),
  shapes: P('<rect x="2.5" y="7" width="6" height="6" rx=".8"/><circle cx="10.5" cy="5.5" r="3"/>'),
  more: P('<circle cx="4" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12" cy="8" r=".9" fill="currentColor"/>'),
  undo: P('<path d="M5.5 4L2.5 7l3 3M2.8 7H10a3.5 3.5 0 010 7H8"/>'),
  redo: P('<path d="M10.5 4l3 3-3 3M13.2 7H6a3.5 3.5 0 000 7h2"/>'),
  code: P('<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5"/>'),
  eye: P('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
  eyeOff: P('<path d="M2 2l12 12M6.6 3.7A6.8 6.8 0 018 3.5C12.1 3.5 14.5 8 14.5 8a11 11 0 01-1.9 2.5M9.9 12.2A6.6 6.6 0 018 12.5C3.9 12.5 1.5 8 1.5 8a11.4 11.4 0 012.6-3"/>'),
  lock: P('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>'),
  unlock: P('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 014.9-.6"/>'),
  frame: P('<path d="M4.5 2v12M11.5 2v12M2 4.5h12M2 11.5h12"/>'),
  dup: P('<rect x="5" y="5" width="8.5" height="8.5" rx="1.2"/><path d="M11 5V3.7c0-.7-.5-1.2-1.2-1.2H3.7c-.7 0-1.2.5-1.2 1.2v6.1c0 .7.5 1.2 1.2 1.2H5"/>'),
  trash: P('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9"/>'),
  alignL: P('<path d="M2.5 2v12M5 5h8M5 11h5"/>'),
  alignC: P('<path d="M8 2v12M3.5 5h9M5 11h6"/>'),
  alignR: P('<path d="M13.5 2v12M3 5h8M6 11h5"/>'),
  alignT: P('<path d="M2 2.5h12M5 5v8M11 5v5"/>'),
  alignM: P('<path d="M2 8h12M5 3.5v9M11 5v6"/>'),
  alignB: P('<path d="M2 13.5h12M5 3v8M11 6v5"/>'),
  rotate: P('<path d="M12.5 7.5A4.5 4.5 0 104 10.5M12.5 3.5v4h-4"/>'),
  radius: P('<path d="M3 13V8a5 5 0 015-5h5"/>'),
  opacity: P('<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 010 11z" fill="currentColor"/>'),
  plus: P('<path d="M8 3v10M3 8h10"/>'),
  minus: P('<path d="M3 8h10"/>'),
  textL: P('<path d="M2.5 4h11M2.5 7h7M2.5 10h11M2.5 13h7"/>'),
  textC: P('<path d="M2.5 4h11M4.5 7h7M2.5 10h11M4.5 13h7"/>'),
  textR: P('<path d="M2.5 4h11M6.5 7h7M2.5 10h11M6.5 13h7"/>'),
};

// ---------- model ----------

const B = {
  id: null, name: "My Template", design: null, state: null, sel: null, hover: null,
  undo: [], redo: [], lastUndoKey: null, lastUndoAt: 0,
  screens: [{ name: "Laptop 16:10", width: 1512, height: 982 }, { name: "Ultrawide 21:9", width: 3440, height: 1440 }],
  screen: 0, saved: true, saving: false, autosave: null, tool: "move", clipboard: null, replaceTarget: null,
};

const TYPES = {
  text: { label: "Text", ic: "text" }, lyrics: { label: "Lyrics", ic: "lyrics" }, cover: { label: "Album Cover", ic: "cover" },
  image: { label: "Image", ic: "image" }, shape: { label: "Shape", ic: "rect" }, vinyl: { label: "Vinyl Record", ic: "vinyl" },
  progress: { label: "Progress Bar", ic: "progress" }, wave: { label: "Waveform", ic: "wave" }, swatches: { label: "Color Swatches", ic: "swatches" },
};
const SHAPE_KINDS = [["rect", "Rectangle"], ["ellipse", "Ellipse"], ["line", "Line"], ["triangle", "Triangle"], ["star", "Star"], ["polygon", "Polygon"], ["arrow", "Arrow"]];
const SHAPE_TOOLS = SHAPE_KINDS.map(([k]) => k);

const DEFAULTS = {
  text: { type: "text", content: "custom", text: "Your text", w: 30, h: 8, font: "SF Pro", size: 5, weight: 700, color: "#FFFFFF", align: "left", valign: "top", fit: false, lines: 1 },
  lyrics: { type: "lyrics", w: 45, h: 60, layout: "center", before: 1, after: 3, font: "SF Pro", size: 5, weight: 800, color: "#FFFFFF", dimColor: "#FFFFFF",
    nextOpacity: 0.45, pastOpacity: 0.25, fade: 0.75, spacing: 0.4, karaoke: true, align: "left" },
  cover: { type: "cover", w: 26, h: 40, radius: 1.5, shadow: true, square: true, align: "center", valign: "center" },
  image: { type: "image", w: 26, h: 30, fit: "cover", radius: 0 },
  shape: { type: "shape", kind: "rect", w: 24, h: 30, fillType: "solid", fill: "auto:vibrant", radius: 2 },
  vinyl: { type: "vinyl", w: 34, h: 52, rpm: 33, label: 36, labelType: "cover", shadow: true },
  progress: { type: "progress", w: 30, h: 0.8, color: "#FFFFFF", trackColor: "rgba(255,255,255,0.25)" },
  wave: { type: "wave", w: 22, h: 10, color: "#FFFFFF", bars: 48, bounce: 0.25 },
  swatches: { type: "swatches", w: 34, h: 8, count: 5, labels: true, labelColor: "#FFFFFF" },
};

const CONTENT = [["custom", "Custom text"], ["track.title", "Song title"], ["track.artist", "Artist"], ["track.album", "Album"],
  ["lyrics.current|note", "Current lyric"], ["lyrics.next1", "Next lyric"], ["lyrics.prev1", "Previous lyric"],
  ["track.elapsed", "Time played"], ["track.remaining", "Time left"], ["track.length", "Song length"],
  ["time.clock", "Clock (12-hour)"], ["time.clock24", "Clock (24-hour)"], ["time.date", "Date"], ["time.day", "Weekday"]];
const AUTO = [["vibrant", "Vibrant"], ["dominant", "Dominant"], ["card", "Card"], ["deep", "Deep"], ["dark", "Dark"], ["light", "Light"],
  ["muted", "Muted"], ["paper", "Paper"], ["onDominant", "Text on dominant"]];
const WEIGHTS = [[100, "Thin"], [200, "Extra Light"], [300, "Light"], [400, "Regular"], [500, "Medium"], [600, "Semibold"], [700, "Bold"], [800, "Heavy"], [900, "Black"]];
const BLENDS = ["normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "difference", "color-dodge", "color-burn", "luminosity"];
const MOTIONS = [["none", "None"], ["spin", "Spin"], ["pulse", "Pulse"], ["float", "Float"], ["sway", "Sway"], ["breathe", "Breathe"], ["blink", "Blink"]];

// ---------- starters ----------

const STARTERS = [
  { name: "Blank", desc: "Blurred cover and centered lyrics", thumb: "linear-gradient(135deg,#3a3a40,#16161a)", design: {
    background: { type: "cover-blur", blur: 90, dim: 0.5, grain: true },
    layers: [{ ...DEFAULTS.lyrics, id: "l1", x: 15, y: 15, w: 70, h: 70, align: "center" }] } },
  { name: "Spotlight", desc: "Cover on the left, lyrics on a glow", thumb: "radial-gradient(circle at 30% 40%,#e76445,#4b2a7a 60%,#121018)", design: {
    background: { type: "mesh", brightness: 0.6, animate: true, grain: true },
    layers: [
      { ...DEFAULTS.cover, id: "c1", x: 7, y: 18, w: 26, h: 48, align: "left" },
      { ...DEFAULTS.text, id: "t1", x: 7, y: 70, w: 26, h: 5, size: 3.2, content: "track.title" },
      { ...DEFAULTS.text, id: "t2", x: 7, y: 75.5, w: 26, h: 4, size: 2.4, weight: 500, content: "track.artist", opacity: 0.65 },
      { ...DEFAULTS.progress, id: "p1", x: 7, y: 82, w: 26, h: 0.6 },
      { ...DEFAULTS.lyrics, id: "l1", x: 40, y: 8, w: 52, h: 84 }] } },
  { name: "Glass Card", desc: "Frosted card with the lyrics", thumb: "linear-gradient(135deg,#7a4b2a,#2a3d5a)", design: {
    background: { type: "cover-blur", blur: 60, dim: 0.25, grain: false },
    layers: [
      { ...DEFAULTS.shape, id: "s1", x: 30, y: 16, w: 40, h: 68, fill: "rgba(255,255,255,0.12)", glass: 40, radius: 3.5, borderWidth: 0.1, borderColor: "rgba(255,255,255,0.35)", shadow: true },
      { ...DEFAULTS.cover, id: "c1", x: 33, y: 21, w: 6, h: 9, radius: 0.8, shadow: false, align: "left" },
      { ...DEFAULTS.text, id: "t1", x: 40.5, y: 21.5, w: 27, h: 4, size: 2.2, content: "track.title" },
      { ...DEFAULTS.text, id: "t2", x: 40.5, y: 25.5, w: 27, h: 3.5, size: 1.9, weight: 500, content: "track.artist", opacity: 0.7 },
      { ...DEFAULTS.lyrics, id: "l1", x: 33, y: 34, w: 34, h: 42, layout: "flow", size: 3.8, before: 1, after: 4 },
      { ...DEFAULTS.progress, id: "p1", x: 33, y: 79, w: 34, h: 0.5 }] } },
  { name: "Headline", desc: "One huge line at a time", thumb: "linear-gradient(135deg,#111,#2b2b2b)", design: {
    background: { type: "solid", color: "#0B0B0D", grain: true },
    layers: [
      { ...DEFAULTS.text, id: "t1", x: 10, y: 28, w: 80, h: 34, content: "lyrics.current|note", font: "New York", size: 11, weight: 600,
        align: "center", valign: "center", fit: true, lines: 3, animate: true },
      { ...DEFAULTS.text, id: "t2", x: 20, y: 64, w: 60, h: 5, content: "lyrics.next1", font: "SF Mono", size: 1.8, weight: 400, align: "center", opacity: 0.45, animate: true },
      { ...DEFAULTS.wave, id: "w1", x: 42, y: 74, w: 16, h: 6 },
      { ...DEFAULTS.text, id: "t3", x: 20, y: 90, w: 60, h: 3, content: "track.title", font: "SF Mono", size: 1.4, weight: 400, align: "center", case: "lowercase", opacity: 0.5 }] } },
  { name: "Record Room", desc: "A spinning record and the lyrics", thumb: "radial-gradient(circle,#1b1b1b 30%,#3b2f25 31%,#111 70%)", design: {
    background: { type: "cover-blur", blur: 120, dim: 0.6, grain: true },
    layers: [
      { ...DEFAULTS.vinyl, id: "v1", x: 6, y: 12, w: 42, h: 76 },
      { ...DEFAULTS.text, id: "t1", x: 54, y: 14, w: 40, h: 5, size: 3, content: "track.title" },
      { ...DEFAULTS.text, id: "t2", x: 54, y: 19.5, w: 40, h: 4, size: 2.2, weight: 500, content: "track.artist", opacity: 0.6 },
      { ...DEFAULTS.lyrics, id: "l1", x: 54, y: 28, w: 40, h: 60, size: 4.4 }] } },
  { name: "Clock", desc: "A big clock with the song below", thumb: "linear-gradient(160deg,#5b4a8a,#1c1830)", design: {
    background: { type: "gradient", colorA: "auto:vibrant", colorB: "auto:dark", angle: 160, grain: false },
    layers: [
      { ...DEFAULTS.text, id: "t0", x: 25, y: 12, w: 50, h: 4, content: "time.date", size: 2.4, weight: 600, align: "center", opacity: 0.85 },
      { ...DEFAULTS.text, id: "t1", x: 15, y: 16, w: 70, h: 30, content: "time.clock24", font: "SF Pro Rounded", size: 22, weight: 600, align: "center", valign: "center", fit: true, lines: 1 },
      { ...DEFAULTS.text, id: "t2", x: 15, y: 52, w: 70, h: 10, content: "lyrics.current|note", size: 3.6, weight: 700, align: "center", animate: true, shadow: true },
      { ...DEFAULTS.cover, id: "c1", x: 43, y: 70, w: 14, h: 20, radius: 1.2, motion: "breathe", motionSpeed: 4 }] } },
];

// ---------- messages from the app ----------

window.App = {
  receive(m) {
    if (m.type === "init") {
      B.state = m.state;
      if (m.screens && m.screens.length) {
        const real = m.screens.map((s) => ({ name: s.name, width: s.width, height: s.height }));
        const same = (a, b) => Math.abs(a.width / a.height - b.width / b.height) < 0.02;
        B.screens = [...real, ...B.screens.filter((s) => !real.some((r) => same(r, s)))];
      }
      if (m.id) { B.id = m.id; B.name = m.name || B.name; }
      $("name").value = B.name;
      if (m.design && m.design.layers) { B.design = m.design; renderAll(); } else showStarters();
      renderScreens();
      layoutCanvas();
      updateStatus();
    } else if (m.type === "state") {
      B.state = m.state;
      sendLive();
    } else if (m.type === "clock") {
      if (B.state && B.state.track && B.state.track.id !== "sample") {
        Object.assign(B.state.track, m.clock);
        $("canvas").contentWindow?.postMessage({ type: "sw:clock", clock: m.clock }, "*");
      }
    } else if (m.type === "saved") {
      B.id = m.id; B.saving = false; B.saved = true;
      updateStatus(m.active ? "Saved · your wallpaper" : "Saved");
    } else if (m.type === "saveFailed") {
      B.saving = false; updateStatus("Couldn't save");
    } else if (m.type === "toast") {
      toast(m.text);
    }
  },
};

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 4500);
}

// ---------- title bar: tell the app which parts are controls (the rest drags the window) ----------

function reportTitlebarHoles() {
  const rects = [...$("topbar").querySelectorAll("button, input, .seg")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  post({ type: "titlebarHoles", rects });
}
new ResizeObserver(reportTitlebarHoles).observe($("topbar"));

// ---------- canvas ----------

const canvas = $("canvas");
canvas.addEventListener("load", () => { sendDesign(); sendLive(); });
const currentScreen = () => B.screens[B.screen] || B.screens[0];

function layoutCanvas() {
  const scr = currentScreen(), stage = $("stage").getBoundingClientRect();
  const k = Math.min((stage.width - 80) / scr.width, (stage.height - 140) / scr.height);
  const w = scr.width * k, hgt = scr.height * k, left = (stage.width - w) / 2, top = (stage.height - 60 - hgt) / 2 + 10;
  Object.assign($("frame").style, { width: w + "px", height: hgt + "px", left: left + "px", top: top + "px" });
  Object.assign(canvas.style, { width: scr.width + "px", height: scr.height + "px", transform: `scale(${k})` });
  Object.assign($("frameLabel").style, { left: left + "px", top: top - 20 + "px" });
  $("frameLabel").textContent = `${scr.name}  ·  ${Math.round(scr.width)} × ${Math.round(scr.height)}`;
}
new ResizeObserver(layoutCanvas).observe($("stage"));

let designQueued = false;
function sendDesign() {
  if (designQueued) return;
  designQueued = true;
  requestAnimationFrame(() => {
    designQueued = false;
    if (B.design) canvas.contentWindow?.postMessage({ type: "sw:design", design: B.design }, "*");
  });
}

function sendLive() {
  if (!B.state) return;
  const scr = currentScreen();
  canvas.contentWindow?.postMessage({ type: "sw:live", payload: { ...B.state, params: {}, screen: { width: scr.width, height: scr.height, scale: 2 } } }, "*");
}

function renderScreens() {
  const box = $("screens");
  box.innerHTML = "";
  B.screens.forEach((s, i) => {
    const b = h("button", i === B.screen ? "on" : "", s.name);
    b.onclick = () => { B.screen = i; renderScreens(); layoutCanvas(); sendLive(); renderOverlay(); };
    box.appendChild(b);
  });
  reportTitlebarHoles();
}

// ---------- editing ----------

const layerById = (id) => B.design.layers.find((l) => l.id === id);
const selected = () => (B.sel ? layerById(B.sel) : null);
const newId = () => "l" + Math.random().toString(36).slice(2, 8);

/** Applies a change with undo; rapid changes to the same control undo as one step. */
function commit(mutate, key, rebuildInspector) {
  const now = Date.now();
  if (!(key && key === B.lastUndoKey && now - B.lastUndoAt < 700)) {
    B.undo.push(clone(B.design));
    if (B.undo.length > 150) B.undo.shift();
    B.redo = [];
  }
  B.lastUndoKey = key; B.lastUndoAt = now;
  mutate();
  changed(rebuildInspector);
}

function changed(rebuildInspector) {
  B.saved = false;
  sendDesign();
  renderLayers();
  renderOverlay();
  if (rebuildInspector) renderInspector();
  updateStatus();
  scheduleAutosave();
}

function undo() {
  if (!B.undo.length) return;
  B.redo.push(clone(B.design));
  B.design = B.undo.pop();
  if (B.sel && !layerById(B.sel)) B.sel = null;
  B.lastUndoKey = null;
  changed(true);
}

function redo() {
  if (!B.redo.length) return;
  B.undo.push(clone(B.design));
  B.design = B.redo.pop();
  if (B.sel && !layerById(B.sel)) B.sel = null;
  B.lastUndoKey = null;
  changed(true);
}

function select(id) {
  B.sel = id;
  renderLayers();
  renderOverlay();
  renderInspector();
}

function addLayer(L) {
  L.id = newId();
  commit(() => B.design.layers.push(L));
  select(L.id);
  return L;
}

function makeLayer(type, rect, extra) {
  const L = { ...clone(DEFAULTS[type]), ...(extra || {}) };
  if (rect) Object.assign(L, rect);
  else {
    const same = B.design.layers.filter((l) => l.type === type).length;
    Object.assign(L, { x: round(50 - L.w / 2 + same * 2), y: round(50 - L.h / 2 + same * 2) });
  }
  return L;
}

function deleteLayer(id) { commit(() => { B.design.layers = B.design.layers.filter((l) => l.id !== id); }); select(null); }

function duplicateLayer(id) {
  const L = layerById(id);
  if (!L) return;
  const copy = { ...clone(L), id: newId(), x: round(L.x + 2), y: round(L.y + 2), name: L.name ? L.name + " copy" : undefined };
  commit(() => B.design.layers.splice(B.design.layers.indexOf(L) + 1, 0, copy));
  select(copy.id);
}

function reorder(id, where) {
  const arr = B.design.layers, i = arr.findIndex((l) => l.id === id);
  if (i < 0) return;
  const j = where === "front" ? arr.length - 1 : where === "back" ? 0 : Math.max(0, Math.min(arr.length - 1, i + where));
  if (i === j) return;
  commit(() => { const [L] = arr.splice(i, 1); arr.splice(j, 0, L); });
}

// ---------- tool bar ----------

const TOOLS = [
  ["move", "Move (V)"], ["sep"], ["text", "Text (T)"], ["rect", "Rectangle (R)"], ["ellipse", "Ellipse (O)"], ["line", "Line (L)"],
  ["shapes", "More shapes", true], ["image", "Image (I)"], ["sep"], ["lyrics", "Lyrics (Y)"], ["cover", "Album cover (C)"],
  ["vinyl", "Vinyl record"], ["more", "Progress, waveform, swatches", true],
];
const SHAPE_MENU = [["triangle", "Triangle"], ["star", "Star"], ["polygon", "Polygon"], ["arrow", "Arrow"]];
const MORE_MENU = [["progress", "Progress bar"], ["wave", "Waveform"], ["swatches", "Color swatches"]];
const toolInMenu = (menu) => (menu === "shapes" ? SHAPE_MENU : MORE_MENU).some(([k]) => k === B.tool);

function renderToolbar() {
  const bar = $("toolbar");
  bar.innerHTML = "";
  for (const [tool, title, isMenu] of TOOLS) {
    if (tool === "sep") { bar.appendChild(h("span", "sep")); continue; }
    const active = B.tool === tool || (isMenu && toolInMenu(tool));
    const b = h("button", "icon-btn" + (active ? " on" : ""));
    b.title = title;
    b.innerHTML = ICON[isMenu && active ? B.tool : tool];
    b.onclick = (e) => {
      if (tool === "image") { pickImage(); return; }
      if (isMenu) {
        openMenu(e.currentTarget, (tool === "shapes" ? SHAPE_MENU : MORE_MENU).map(([k, l]) => ({ icon: k, label: l, run: () => setTool(k) })), "up");
        return;
      }
      setTool(tool);
    };
    bar.appendChild(b);
  }
}

function setTool(tool) {
  B.tool = tool;
  $("overlay").classList.toggle("drawing", tool !== "move");
  renderToolbar();
}

/** The layer a drawing tool creates. */
function layerForTool(tool, rect) {
  if (SHAPE_TOOLS.includes(tool)) {
    const extra = { kind: tool };
    if (tool === "line") Object.assign(extra, { fill: "#FFFFFF", radius: 99 });
    if (tool === "line" && rect) rect.h = 0.4;
    return makeLayer("shape", rect, extra);
  }
  return makeLayer(tool, rect);
}

// ---------- images ----------

function pickImage(target) {
  B.replaceTarget = target || null;
  $("file").value = "";
  $("file").click();
}
$("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) addImageFile(f); });
$("addImageHead").innerHTML = ICON.image;
$("addImageHead").onclick = () => pickImage();

/** Reads an image (shrinking big photos) and adds it as a layer, or puts it into the layer / background being replaced. */
function addImageFile(file, at) {
  const target = B.replaceTarget;
  B.replaceTarget = null;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      let data = reader.result;
      const max = 2200;
      if (Math.max(img.width, img.height) > max && !/gif|svg/.test(file.type)) {
        const k = max / Math.max(img.width, img.height), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        data = c.toDataURL(/png/.test(file.type) ? "image/png" : "image/jpeg", 0.9);
      }
      if (target === "background") { commit(() => { B.design.background.src = data; }, null, true); return; }
      if (target) { const L = layerById(target); if (L) commit(() => { L.src = data; }, null, true); return; }
      const scr = currentScreen();
      const w = 28, hgt = Math.min(90, round((w * scr.width / scr.height) / (img.width / img.height)));
      const x = at ? round(at.x - w / 2) : round(50 - w / 2), y = at ? round(at.y - hgt / 2) : round(50 - hgt / 2);
      addLayer({ ...clone(DEFAULTS.image), src: data, name: file.name.replace(/\.[^.]+$/, ""), x, y, w, h: hgt });
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

// drop images from Finder onto the canvas
const stage = $("stage");
stage.addEventListener("dragover", (e) => {
  if (![...e.dataTransfer.items].some((i) => i.kind === "file")) return;
  e.preventDefault();
  if (!$("frame").querySelector(".drop-hint")) $("frame").appendChild(h("div", "drop-hint", "Drop to add image"));
});
stage.addEventListener("dragleave", (e) => { if (!stage.contains(e.relatedTarget)) $("frame").querySelector(".drop-hint")?.remove(); });
stage.addEventListener("drop", (e) => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  $("frame").querySelector(".drop-hint")?.remove();
  const r = $("overlay").getBoundingClientRect();
  for (const f of e.dataTransfer.files) {
    if (f.type.startsWith("image/")) addImageFile(f, { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  }
});

// ---------- layers panel ----------

function layerName(L) {
  if (L.name) return L.name;
  if (L.type === "text") return L.content === "custom" ? (L.text || "Text") : (CONTENT.find((c) => c[0] === L.content) || [0, "Text"])[1];
  if (L.type === "shape") return (SHAPE_KINDS.find(([k]) => k === (L.kind || "rect")) || [0, "Shape"])[1];
  return TYPES[L.type].label;
}
const layerIcon = (L) => ICON[L.type === "shape" ? L.kind || "rect" : TYPES[L.type].ic];

function renderLayers() {
  const box = $("layers");
  box.innerHTML = "";
  if (!B.design) return;
  const root = h("div", "row-item frame-row" + (!B.sel ? " sel" : ""));
  root.innerHTML = `<span class="ic">${ICON.frame}</span><span class="nm">Wallpaper</span>`;
  root.onclick = () => select(null);
  box.appendChild(root);
  [...B.design.layers].reverse().forEach((L) => {
    const row = h("div", "row-item child" + (L.id === B.sel ? " sel" : "") + (L.hidden ? " hidden-layer" : ""));
    row.draggable = true;
    row.innerHTML = `<span class="ic">${layerIcon(L)}</span><span class="nm"></span><span class="acts${L.hidden || L.locked ? " keep" : ""}">
      <button class="icon-btn lk" title="Lock">${L.locked ? ICON.lock : ICON.unlock}</button>
      <button class="icon-btn ey" title="Show/hide">${L.hidden ? ICON.eyeOff : ICON.eye}</button></span>`;
    row.querySelector(".nm").textContent = layerName(L);
    row.onclick = () => select(L.id);
    row.ondblclick = () => renameInline(row, L);
    row.oncontextmenu = (e) => { e.preventDefault(); select(L.id); layerMenu(L, e.clientX, e.clientY); };
    row.onmouseenter = () => { B.hover = L.id; renderOverlay(); };
    row.onmouseleave = () => { B.hover = null; renderOverlay(); };
    row.querySelector(".ey").onclick = (e) => { e.stopPropagation(); commit(() => { L.hidden = !L.hidden; }); };
    row.querySelector(".lk").onclick = (e) => { e.stopPropagation(); commit(() => { L.locked = !L.locked; }); };
    // drag to reorder (the list runs front to back)
    row.ondragstart = (e) => { e.dataTransfer.setData("text/layer", L.id); e.dataTransfer.effectAllowed = "move"; };
    row.ondragover = (e) => {
      if (!e.dataTransfer.types.includes("text/layer")) return;
      e.preventDefault();
      const above = e.offsetY < row.clientHeight / 2;
      row.classList.toggle("drop-above", above);
      row.classList.toggle("drop-below", !above);
    };
    row.ondragleave = () => row.classList.remove("drop-above", "drop-below");
    row.ondrop = (e) => {
      e.preventDefault();
      const above = row.classList.contains("drop-above");
      row.classList.remove("drop-above", "drop-below");
      const dragId = e.dataTransfer.getData("text/layer");
      if (!dragId || dragId === L.id) return;
      commit(() => {
        const arr = B.design.layers, from = arr.findIndex((l) => l.id === dragId);
        const [moved] = arr.splice(from, 1);
        const target = arr.findIndex((l) => l.id === L.id);
        arr.splice(above ? target + 1 : target, 0, moved);  // higher in the list = in front
      });
    };
    box.appendChild(row);
  });
}

function renameInline(row, L) {
  const nm = row.querySelector(".nm");
  const input = Object.assign(h("input", "rename"), { value: layerName(L) });
  nm.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save) commit(() => { L.name = input.value.trim() || undefined; }); else renderLayers();
  };
  input.onkeydown = (e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); e.stopPropagation(); };
  input.onblur = () => finish(true);
}

// ---------- menus ----------

function openMenu(anchor, items, dir, x, y) {
  const m = $("menu");
  m.innerHTML = "";
  for (const it of items) {
    if (it === "-") { m.appendChild(h("hr")); continue; }
    const b = h("button");
    b.innerHTML = `${it.icon ? ICON[it.icon] : ""}<span>${it.label}</span>${it.key ? `<span class="k">${it.key}</span>` : ""}`;
    b.onclick = () => { closeMenu(); it.run(); };
    m.appendChild(b);
  }
  m.hidden = false;
  const mr = m.getBoundingClientRect();
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.min(innerWidth - mr.width - 8, r.left) + "px";
    m.style.top = (dir === "up" ? r.top - mr.height - 8 : r.bottom + 6) + "px";
  } else {
    m.style.left = Math.min(innerWidth - mr.width - 8, x) + "px";
    m.style.top = Math.min(innerHeight - mr.height - 8, y) + "px";
  }
}
function closeMenu() { $("menu").hidden = true; }
window.addEventListener("mousedown", (e) => { if (!$("menu").contains(e.target)) closeMenu(); }, true);

function layerMenu(L, x, y) {
  openMenu(null, [
    { label: "Bring to Front", key: "⌘]", run: () => reorder(L.id, "front") },
    { label: "Bring Forward", run: () => reorder(L.id, 1) },
    { label: "Send Backward", run: () => reorder(L.id, -1) },
    { label: "Send to Back", key: "⌘[", run: () => reorder(L.id, "back") },
    "-",
    { label: "Copy", key: "⌘C", run: copyLayer },
    { label: "Paste", key: "⌘V", run: pasteLayer },
    { label: "Duplicate", key: "⌘D", run: () => duplicateLayer(L.id) },
    "-",
    { label: L.hidden ? "Show" : "Hide", run: () => commit(() => { L.hidden = !L.hidden; }) },
    { label: L.locked ? "Unlock" : "Lock", run: () => commit(() => { L.locked = !L.locked; }) },
    "-",
    { label: "Delete", key: "⌫", run: () => deleteLayer(L.id) },
  ], null, null, x, y);
}

function copyLayer() { const L = selected(); if (L) B.clipboard = clone(L); }
function pasteLayer() {
  if (!B.clipboard) return;
  const L = { ...clone(B.clipboard), x: round(B.clipboard.x + 2), y: round(B.clipboard.y + 2) };
  B.clipboard = clone(L);
  addLayer(L);
}

// ---------- overlay: select, move, resize, draw ----------

const overlay = $("overlay");
const HANDLES = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };

function renderOverlay() {
  overlay.querySelectorAll(".ov-box").forEach((n) => n.remove());
  if (!B.design) return;
  const scr = currentScreen();
  B.design.layers.forEach((L) => {
    if (L.hidden) return;
    const box = h("div", "ov-box" + (L.id === B.sel ? " sel" : "") + (L.id === B.hover ? " hover" : "") + (L.locked ? " locked" : ""));
    Object.assign(box.style, { left: L.x + "%", top: L.y + "%", width: L.w + "%", height: Math.max(L.h, 0.4) + "%",
      transform: L.rotation ? `rotate(${L.rotation}deg)` : "" });
    box.dataset.id = L.id;
    if (L.id === B.sel && !L.locked) {
      for (const [d, [hx, hy]] of Object.entries(HANDLES)) {
        const hd = h("div", "handle");
        hd.dataset.d = d;
        Object.assign(hd.style, { left: hx + "%", top: hy + "%" });
        box.appendChild(hd);
      }
      box.appendChild(h("div", "ov-size", `${Math.round((L.w / 100) * scr.width)} × ${Math.round((L.h / 100) * scr.height)}`));
    }
    overlay.appendChild(box);
  });
}

overlay.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || !B.design) return;
  const r = overlay.getBoundingClientRect();
  const pt = { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  if (B.tool !== "move") { drawLayer(pt); return; }
  const handle = e.target.closest(".handle"), box = e.target.closest(".ov-box");
  if (!box) { select(null); return; }
  const L = layerById(box.dataset.id);
  if (L.id !== B.sel) select(L.id);
  dragLayer(e, L, handle ? handle.dataset.d : "move");
  e.preventDefault();
});

overlay.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const box = e.target.closest(".ov-box");
  if (!box) return;
  const L = layerById(box.dataset.id);
  select(L.id);
  layerMenu(L, e.clientX, e.clientY);
});

function drawLayer(start) {
  const r = overlay.getBoundingClientRect();
  const ghost = h("div", "draw-ghost");
  overlay.appendChild(ghost);
  let rect = null;
  const move = (ev) => {
    const x = ((ev.clientX - r.left) / r.width) * 100, y = ((ev.clientY - r.top) / r.height) * 100;
    rect = { x: round(Math.min(x, start.x)), y: round(Math.min(y, start.y)), w: round(Math.abs(x - start.x)), h: round(Math.abs(y - start.y)) };
    Object.assign(ghost.style, { left: rect.x + "%", top: rect.y + "%", width: rect.w + "%", height: rect.h + "%" });
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    ghost.remove();
    const tool = B.tool;
    if (!rect || rect.w < 1 || rect.h < 0.5) {  // a click: default size, centered there
      const d = DEFAULTS[SHAPE_TOOLS.includes(tool) ? "shape" : tool];
      rect = { x: round(start.x - d.w / 2), y: round(start.y - d.h / 2), w: d.w, h: tool === "line" ? 0.4 : d.h };
    }
    const L = addLayer(layerForTool(tool, rect));
    setTool("move");
    if (L.type === "text") setTimeout(() => { const t = document.querySelector('[data-focus="text"]'); if (t) { t.focus(); t.select(); } }, 30);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

function snapTargets(except) {
  const xs = [0, 50, 100], ys = [0, 50, 100];
  for (const o of B.design.layers) {
    if (o.id === except || o.hidden) continue;
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  return { xs, ys };
}

function dragLayer(e, L, mode) {
  if (L.locked) return;
  const rect = overlay.getBoundingClientRect();
  const start = { mx: e.clientX, my: e.clientY, x: L.x, y: L.y, w: L.w, h: L.h };
  const { xs, ys } = snapTargets(L.id);
  let committed = false;
  const snap = (v, targets) => {
    let best = null;
    for (const t of targets) if (Math.abs(t - v) < 0.8 && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t;
    return best;
  };
  const move = (ev) => {
    const dx = ((ev.clientX - start.mx) / rect.width) * 100, dy = ((ev.clientY - start.my) / rect.height) * 100;
    if (!committed && Math.abs(dx) + Math.abs(dy) < 0.15) return;
    if (!committed) { B.undo.push(clone(B.design)); B.redo = []; B.lastUndoKey = null; committed = true; }
    let { x, y, w, h: hh } = start;
    const guides = [];
    if (mode === "move") {
      x = start.x + dx; y = start.y + dy;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) y = start.y; else x = start.x; }
      if (!ev.altKey) {
        for (const [edge, off] of [[x, 0], [x + w / 2, w / 2], [x + w, w]]) { const s = snap(edge, xs); if (s !== null) { x = s - off; guides.push(["v", s]); break; } }
        for (const [edge, off] of [[y, 0], [y + hh / 2, hh / 2], [y + hh, hh]]) { const s = snap(edge, ys); if (s !== null) { y = s - off; guides.push(["h", s]); break; } }
      }
    } else {
      if (mode.includes("e")) w = Math.max(1, start.w + dx);
      if (mode.includes("s")) hh = Math.max(0.3, start.h + dy);
      if (mode.includes("w")) { w = Math.max(1, start.w - dx); x = start.x + start.w - w; }
      if (mode.includes("n")) { hh = Math.max(0.3, start.h - dy); y = start.y + start.h - hh; }
      if (ev.shiftKey && mode.length === 2) {  // keep proportions from corners
        const k = Math.max(w / start.w, hh / start.h);
        w = start.w * k; hh = start.h * k;
        if (mode.includes("w")) x = start.x + start.w - w;
        if (mode.includes("n")) y = start.y + start.h - hh;
      }
      if (!ev.altKey) {
        if (mode.includes("e")) { const s = snap(x + w, xs); if (s !== null) { w = s - x; guides.push(["v", s]); } }
        if (mode.includes("w")) { const s = snap(x, xs); if (s !== null) { w += x - s; x = s; guides.push(["v", s]); } }
        if (mode.includes("s")) { const s = snap(y + hh, ys); if (s !== null) { hh = s - y; guides.push(["h", s]); } }
        if (mode.includes("n")) { const s = snap(y, ys); if (s !== null) { hh += y - s; y = s; guides.push(["h", s]); } }
      }
    }
    Object.assign(L, { x: round(x), y: round(y), w: round(w), h: round(hh) });
    B.saved = false;
    sendDesign();
    renderOverlay();
    overlay.querySelectorAll(".guide").forEach((g) => g.remove());
    for (const [dir, at] of guides) {
      const g = h("div", "guide " + dir);
      g.style[dir === "v" ? "left" : "top"] = at + "%";
      overlay.appendChild(g);
    }
    renderInspectorSoon();
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    overlay.querySelectorAll(".guide").forEach((g) => g.remove());
    if (committed) changed(true);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

// ---------- inspector controls ----------

function section(box, title, action) {
  const s = h("div", "section");
  if (title !== null) {
    const head = h("div", "section-head");
    head.appendChild(h("h4", null, title));
    if (action) head.appendChild(action);
    s.appendChild(head);
  }
  box.appendChild(s);
  return s;
}

const spaced = (el) => { el.style.marginTop = "6px"; return el; };

/** Number field with an inline label; drag the label sideways to scrub the value, like Figma. */
function numField(pre, value, opts, onChange) {
  const f = h("label", "field");
  const p = h("span", "pre");
  p.innerHTML = ICON[pre] || pre;
  const fmt = (v) => (v === undefined || v === null || v === "" ? "" : String(+(+v).toFixed(opts.decimals ?? 1)));
  const input = Object.assign(h("input"), { type: "text", value: fmt(value) });
  f.append(p, input);
  if (opts.suffix) f.appendChild(h("span", "suf", opts.suffix));
  const clampV = (v) => Math.min(opts.max ?? Infinity, Math.max(opts.min ?? -Infinity, v));
  const apply = (v) => { v = clampV(v); input.value = fmt(v); onChange(v); };
  input.onchange = () => { const v = parseFloat(input.value); if (!isNaN(v)) apply(v); else input.value = fmt(value); };
  input.onkeydown = (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      apply((parseFloat(input.value) || 0) + (opts.step || 1) * (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1));
    }
    if (e.key === "Enter") input.blur();
  };
  p.onmousedown = (e) => {
    e.preventDefault();
    const x0 = e.clientX, v0 = parseFloat(input.value) || 0;
    const mv = (ev) => apply(round(v0 + (ev.clientX - x0) * (opts.step || 1) * (ev.shiftKey ? 10 : 1) * 0.5, opts.step || 0.1));
    const upf = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", upf); };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", upf);
  };
  return f;
}

function selectField(options, value, onChange) {
  const f = h("label", "field");
  const sel = h("select");
  for (const o of options) { const [v, l] = Array.isArray(o) ? o : [o, o]; sel.add(new Option(l, v)); }
  sel.value = value;
  sel.onchange = () => onChange(sel.value);
  f.appendChild(sel);
  return f;
}

function textField(value, onChange, focusKey) {
  const f = h("label", "field");
  const input = Object.assign(h("input"), { type: "text", value: value || "" });
  if (focusKey) input.dataset.focus = focusKey;
  input.oninput = () => onChange(input.value);
  f.appendChild(input);
  return f;
}

/** Color: a swatch (opens the color picker) plus either Auto (from each song's cover) or a custom value. */
function colorField(value, onChange) {
  const f = h("div", "field color-field");
  const colors = (B.state && B.state.colors) || {};
  const resolved = (v) => (typeof v === "string" && v.startsWith("auto:") ? colors[v.slice(5)] || "#888888" : v);
  const sw = h("label", "swatch");
  const fill = h("i");
  fill.style.background = resolved(value);
  const pickerValue = /^#[0-9a-f]{6}$/i.test(resolved(value) || "") ? resolved(value) : "#ffffff";
  const picker = Object.assign(h("input"), { type: "color", value: pickerValue });
  sw.append(fill, picker);
  const sel = h("select");
  for (const [v, l] of AUTO) sel.add(new Option("Auto · " + l, "auto:" + v));
  const isAuto = typeof value === "string" && value.startsWith("auto:");
  if (isAuto) sel.value = value;
  const hex = Object.assign(h("input", "hex"), { type: "text", value: isAuto ? "" : String(value || "").replace(/^#/, "") });
  hex.style.flex = "1";
  sel.hidden = !isAuto;
  hex.hidden = isAuto;
  const set = (v) => { fill.style.background = resolved(v); onChange(v); };
  picker.oninput = () => { sel.hidden = true; hex.hidden = false; hex.value = picker.value.slice(1).toUpperCase(); set(picker.value.toUpperCase()); };
  sel.onchange = () => set(sel.value);
  hex.onchange = () => {
    const v = hex.value.trim();
    if (/^[0-9a-f]{3,8}$/i.test(v)) set("#" + v.toUpperCase()); else if (/^(rgba?|hsla?)\(/.test(v) || v.startsWith("#")) set(v);
  };
  const mode = h("button", "icon-btn");
  mode.title = isAuto ? "Use a custom color" : "Use a color from the album cover";
  mode.innerHTML = ICON.opacity;
  mode.style.width = mode.style.height = "20px";
  mode.onclick = (e) => {
    e.preventDefault();
    if (sel.hidden) { sel.hidden = false; hex.hidden = true; sel.value = "auto:vibrant"; set("auto:vibrant"); }
    else { sel.hidden = true; hex.hidden = false; hex.value = picker.value.slice(1).toUpperCase(); set(picker.value.toUpperCase()); }
  };
  f.append(sw, sel, hex, mode);
  return f;
}

function toggleRow(label, value, onChange) {
  const r = h("div", "label-row");
  r.appendChild(h("span", null, label));
  const t = h("label", "toggle");
  t.innerHTML = `<input type="checkbox"><span></span>`;
  const input = t.querySelector("input");
  input.checked = !!value;
  input.onchange = () => onChange(input.checked);
  r.appendChild(t);
  return r;
}

function sliderRow(label, value, opts, onChange) {
  const wrap = h("div");
  if (label) wrap.appendChild(h("div", "label", label));
  const row = h("div", "slider-row");
  const range = Object.assign(h("input"), { type: "range", min: opts.min, max: opts.max, step: opts.step, value });
  const num = numField("", value, { ...opts, decimals: opts.decimals ?? 2 }, (v) => { range.value = v; onChange(v); });
  num.querySelector(".pre").remove();
  range.oninput = () => { num.querySelector("input").value = +(+range.value).toFixed(opts.decimals ?? 2); onChange(+range.value); };
  row.append(range, num);
  wrap.appendChild(row);
  return wrap;
}

function segField(options, value, onChange) {
  const s = h("div", "seg");
  for (const [v, l, ic] of options) {
    const b = h("button", String(value) === String(v) ? "on" : "");
    if (ic) { b.innerHTML = ICON[ic]; b.title = l; } else b.textContent = l;
    b.onclick = () => onChange(v);
    s.appendChild(b);
  }
  return s;
}

// ---------- inspector ----------

function renderInspector() {
  const box = $("inspector");
  box.innerHTML = "";
  if (!B.design) return;
  const L = selected();
  $("inspTitle").textContent = L ? "Design" : "Wallpaper";
  if (!L) return backgroundInspector(box);

  // set(key) → change handler with undo; rebuild = also re-render the inspector (for fields that show/hide others)
  const set = (key, rebuild) => (v) => commit(() => { L[key] = v; }, L.id + ":" + key, rebuild);

  // header + alignment
  const head = section(box, null);
  const hd = h("div", "layer-head");
  hd.innerHTML = `<span class="ic">${layerIcon(L)}</span>`;
  const nm = Object.assign(h("input"), { value: L.name || "", placeholder: layerName(L) });
  nm.oninput = () => commit(() => { L.name = nm.value || undefined; }, L.id + ":name");
  const dup = h("button", "icon-btn"); dup.innerHTML = ICON.dup; dup.title = "Duplicate (⌘D)"; dup.onclick = () => duplicateLayer(L.id);
  const del = h("button", "icon-btn"); del.innerHTML = ICON.trash; del.title = "Delete (⌫)"; del.onclick = () => deleteLayer(L.id);
  hd.append(nm, dup, del);
  head.appendChild(hd);
  const al = h("div", "align-row");
  al.style.marginTop = "8px";
  for (const [ic, title, fn] of [
    ["alignL", "Align left", () => ({ x: 0 })], ["alignC", "Align horizontal centers", () => ({ x: round(50 - L.w / 2) })],
    ["alignR", "Align right", () => ({ x: round(100 - L.w) })], ["alignT", "Align top", () => ({ y: 0 })],
    ["alignM", "Align vertical centers", () => ({ y: round(50 - L.h / 2) })], ["alignB", "Align bottom", () => ({ y: round(100 - L.h) })]]) {
    const b = h("button", "icon-btn"); b.innerHTML = ICON[ic]; b.title = title;
    b.onclick = () => commit(() => Object.assign(L, fn()), null, true);
    al.appendChild(b);
  }
  head.appendChild(al);

  // position & layout
  const pos = section(box, "Position");
  const g1 = h("div", "grid2");
  g1.append(numField("X", L.x, { step: 0.5, suffix: "%" }, set("x")), numField("Y", L.y, { step: 0.5, suffix: "%" }, set("y")));
  pos.appendChild(g1);
  pos.appendChild(spaced(Object.assign(h("div", "grid2"))).appendChild(numField("rotate", L.rotation || 0, { step: 1, suffix: "°", decimals: 0 }, set("rotation"))).parentElement);
  const lay = section(box, "Layout");
  const g3 = h("div", "grid2");
  g3.append(numField("W", L.w, { step: 0.5, min: 0.3, suffix: "%" }, set("w")), numField("H", L.h, { step: 0.5, min: 0.3, suffix: "%" }, set("h")));
  lay.appendChild(g3);

  // appearance
  const ap = section(box, "Appearance");
  const g4 = h("div", "grid2");
  g4.appendChild(numField("opacity", Math.round((L.opacity ?? 1) * 100), { step: 1, min: 0, max: 100, suffix: "%", decimals: 0 }, (v) => set("opacity")(v / 100)));
  const rounded = ["cover", "image"].includes(L.type) || (L.type === "shape" && ["rect", "line"].includes(L.kind || "rect"));
  if (rounded) g4.appendChild(numField("radius", L.radius ?? 0, { step: 0.1, min: 0, suffix: "vmin" }, set("radius")));
  ap.appendChild(g4);
  ap.appendChild(spaced(selectField(BLENDS.map((b) => [b, b[0].toUpperCase() + b.slice(1).replace("-", " ")]), L.blend || "normal", set("blend"))));

  // what this kind of layer is about
  ({ text: textInspector, lyrics: lyricsInspector, cover: coverInspector, image: imageInspector, shape: shapeInspector,
     vinyl: vinylInspector, progress: progressInspector, wave: waveInspector, swatches: swatchesInspector })[L.type](box, L, set);

  // stroke
  if (["cover", "image"].includes(L.type) || (L.type === "shape" && ["rect", "ellipse"].includes(L.kind || "rect"))) {
    const has = +L.borderWidth > 0;
    const add = h("button", "icon-btn");
    add.innerHTML = has ? ICON.minus : ICON.plus;
    add.title = has ? "Remove stroke" : "Add stroke";
    add.onclick = () => commit(() => { L.borderWidth = has ? 0 : 0.2; L.borderColor = L.borderColor || "#FFFFFF"; }, null, true);
    const st = section(box, "Stroke", add);
    if (has) {
      st.appendChild(colorField(L.borderColor || "#FFFFFF", set("borderColor")));
      const g = spaced(h("div", "grid2"));
      g.append(numField("W", L.borderWidth, { step: 0.05, min: 0, suffix: "vmin", decimals: 2 }, set("borderWidth")));
      st.appendChild(g);
    }
  }

  // effects
  const ef = section(box, "Effects");
  if (!["text", "lyrics"].includes(L.type)) {
    ef.appendChild(toggleRow("Drop shadow", L.shadow, set("shadow", true)));
    if (L.shadow) {
      const g = h("div", "grid3");
      g.append(numField("Y", L.shadowY ?? 1.5, { step: 0.1 }, set("shadowY")), numField("B", L.shadowBlur ?? 3, { step: 0.1, min: 0 }, set("shadowBlur")),
        numField("opacity", Math.round((L.shadowOpacity ?? 0.4) * 100), { step: 1, min: 0, max: 100, suffix: "%", decimals: 0 }, (v) => set("shadowOpacity")(v / 100)));
      ef.appendChild(g);
    }
  } else {
    ef.appendChild(toggleRow("Text shadow", L.shadow, set("shadow")));
  }
  ef.appendChild(sliderRow("Layer blur", L.blur || 0, { min: 0, max: 40, step: 0.5, decimals: 1 }, set("blur")));
  if (L.type === "shape") ef.appendChild(sliderRow("Background blur (frosted glass)", L.glass || 0, { min: 0, max: 80, step: 1, decimals: 0 }, set("glass")));

  // motion
  const mo = section(box, "Motion");
  mo.appendChild(selectField(MOTIONS, L.motion || "none", set("motion", true)));
  if (L.motion && L.motion !== "none") {
    mo.appendChild(sliderRow("Seconds per cycle", L.motionSpeed ?? 3, { min: 0.3, max: 20, step: 0.1, decimals: 1 }, set("motionSpeed")));
    mo.appendChild(toggleRow("Only while music plays", L.motionPlaying !== false, set("motionPlaying")));
  }
  if (L.type === "text") mo.appendChild(toggleRow("Animate in on each new line", L.animate, set("animate")));
}

function typography(box, L, set) {
  const ty = section(box, "Typography");
  ty.appendChild(selectField(Object.keys(Wallpaper.fonts).map((k) => [k, k]), L.font || "SF Pro", set("font")));
  const g = spaced(h("div", "grid2"));
  g.append(selectField(WEIGHTS, String(L.weight || 600), (v) => set("weight")(+v)), numField("Aa", L.size || 5, { step: 0.1, min: 0.5, suffix: "vmin" }, set("size")));
  ty.appendChild(g);
  const g2 = spaced(h("div", "grid2"));
  g2.append(numField("↕", L.lineHeight ?? 1.2, { step: 0.05, min: 0.6, decimals: 2 }, set("lineHeight")),
    numField("↔", L.letterSpacing ?? 0, { step: 0.01, decimals: 2, suffix: "em" }, set("letterSpacing")));
  ty.appendChild(g2);
  const g3 = spaced(h("div", "grid2"));
  g3.append(segField([["left", "Left", "textL"], ["center", "Center", "textC"], ["right", "Right", "textR"]], L.align || "left", set("align", true)),
    selectField([["none", "As written"], ["uppercase", "UPPERCASE"], ["lowercase", "lowercase"]], L.case || "none", set("case")));
  ty.appendChild(g3);
  ty.appendChild(toggleRow("Italic", L.italic, set("italic")));
  return ty;
}

function textInspector(box, L, set) {
  const c = section(box, "Content");
  c.appendChild(selectField(CONTENT, L.content || "custom", set("content", true)));
  if ((L.content || "custom") === "custom") c.appendChild(spaced(textField(L.text, set("text"), "text")));
  if (String(L.content).startsWith("time.")) c.appendChild(spaced(h("div", "hint", "Updates live on your desktop.")));
  const ty = typography(box, L, set);
  ty.appendChild(h("div", "label", "Vertical alignment"));
  ty.appendChild(segField([["top", "Top", "alignT"], ["center", "Middle", "alignM"], ["bottom", "Bottom", "alignB"]], L.valign || "top", set("valign", true)));
  ty.appendChild(toggleRow("Shrink to fit box", L.fit, set("fit", true)));
  if (L.fit) ty.appendChild(numField("lines", L.lines || 1, { step: 1, min: 1, max: 6, decimals: 0 }, set("lines")));
  section(box, "Fill").appendChild(colorField(L.color || "#FFFFFF", set("color")));
}

function lyricsInspector(box, L, set) {
  const c = section(box, "Lyrics");
  c.appendChild(segField([["center", "Centered"], ["top", "Scrolling"], ["flow", "Stacked"]], L.layout || "center", set("layout", true)));
  const g = spaced(h("div", "grid2"));
  g.append(numField("↑", L.before ?? 1, { step: 1, min: 0, max: 8, decimals: 0 }, set("before")), numField("↓", L.after ?? 3, { step: 1, min: 0, max: 14, decimals: 0 }, set("after")));
  c.appendChild(g);
  c.appendChild(spaced(h("div", "hint", "↑ lines shown before, ↓ lines shown after the current one.")));
  c.appendChild(toggleRow("Karaoke sweep", L.karaoke, set("karaoke")));
  typography(box, L, set).appendChild(sliderRow("Gap between lines", L.spacing ?? 0.4, { min: 0, max: 2, step: 0.05 }, set("spacing")));
  const f = section(box, "Fill");
  f.appendChild(h("div", "label", "Current line"));
  f.appendChild(colorField(L.color || "#FFFFFF", set("color")));
  f.appendChild(h("div", "label", "Other lines"));
  f.appendChild(colorField(L.dimColor || L.color || "#FFFFFF", set("dimColor")));
  f.appendChild(sliderRow("Upcoming opacity", L.nextOpacity ?? 0.45, { min: 0, max: 1, step: 0.05 }, set("nextOpacity")));
  f.appendChild(sliderRow("Past opacity", L.pastOpacity ?? 0.25, { min: 0, max: 1, step: 0.05 }, set("pastOpacity")));
  f.appendChild(sliderRow("Fade per line", L.fade ?? 0.75, { min: 0.3, max: 1, step: 0.05 }, set("fade")));
}

function coverInspector(box, L, set) {
  const c = section(box, "Album cover");
  c.appendChild(toggleRow("Keep square", L.square !== false, set("square", true)));
  if (L.square !== false) {
    const g = h("div", "grid2");
    g.append(segField([["left", "Left", "alignL"], ["center", "Center", "alignC"], ["right", "Right", "alignR"]], L.align || "center", set("align", true)),
      segField([["top", "Top", "alignT"], ["center", "Middle", "alignM"], ["bottom", "Bottom", "alignB"]], L.valign || "center", set("valign", true)));
    c.appendChild(g);
  }
}

function imageInspector(box, L, set) {
  const c = section(box, "Image");
  const thumb = h("div", "img-thumb");
  if (L.src) thumb.style.backgroundImage = `url("${L.src}")`;
  c.appendChild(thumb);
  const rep = h("button", "btn wide", "Replace image…");
  rep.onclick = () => pickImage(L.id);
  c.appendChild(rep);
  c.appendChild(h("div", "label", "Fit"));
  c.appendChild(segField([["cover", "Fill"], ["contain", "Fit"], ["100% 100%", "Stretch"]], L.fit || "cover", set("fit", true)));
  c.appendChild(toggleRow("Flip horizontally", L.flipX, set("flipX")));
  const a = section(box, "Adjust");
  a.appendChild(sliderRow("Brightness", L.brightness ?? 1, { min: 0, max: 2, step: 0.05 }, set("brightness")));
  a.appendChild(sliderRow("Saturation", L.saturation ?? 1, { min: 0, max: 2, step: 0.05 }, set("saturation")));
  a.appendChild(sliderRow("Black & white", L.grayscale ?? 0, { min: 0, max: 1, step: 0.05 }, set("grayscale")));
}

function shapeInspector(box, L, set) {
  const c = section(box, "Shape");
  c.appendChild(selectField(SHAPE_KINDS, L.kind || "rect", set("kind", true)));
  if (L.kind === "star") {
    const g = spaced(h("div", "grid2"));
    g.append(numField("pts", L.points ?? 5, { step: 1, min: 3, max: 16, decimals: 0 }, set("points")),
      numField("in", L.inner ?? 0.45, { step: 0.05, min: 0.1, max: 0.95, decimals: 2 }, set("inner")));
    c.appendChild(g);
  }
  if (L.kind === "polygon") c.appendChild(spaced(numField("sides", L.sides ?? 6, { step: 1, min: 3, max: 12, decimals: 0 }, set("sides"))));
  const f = section(box, "Fill");
  const t = L.fillType || "solid";
  f.appendChild(segField([["solid", "Solid"], ["gradient", "Gradient"], ["cover", "Cover"], ["image", "Image"], ["none", "None"]], t, set("fillType", true)));
  if (t === "solid" || t === "gradient") f.appendChild(spaced(colorField(L.fill || "auto:vibrant", set("fill"))));
  if (t === "gradient") {
    f.appendChild(spaced(colorField(L.fillB || "auto:dark", set("fillB"))));
    f.appendChild(spaced(numField("rotate", L.fillAngle ?? 135, { step: 5, suffix: "°", decimals: 0 }, set("fillAngle"))));
  }
  if (t === "cover") f.appendChild(spaced(h("div", "hint", "Filled with the current song's album cover.")));
  if (t === "image") {
    const b = spaced(h("button", "btn wide", L.src ? "Replace image…" : "Choose image…"));
    b.onclick = () => pickImage(L.id);
    f.appendChild(b);
  }
}

function vinylInspector(box, L, set) {
  const c = section(box, "Record");
  c.appendChild(h("div", "label", "Speed"));
  c.appendChild(segField([[12, "Slow"], [33, "33⅓"], [45, "45"]], +L.rpm || 33, (v) => set("rpm", true)(+v)));
  c.appendChild(sliderRow("Label size", L.label ?? 36, { min: 15, max: 70, step: 1, decimals: 0 }, set("label")));
  c.appendChild(h("div", "label", "Label"));
  c.appendChild(segField([["cover", "Album cover"], ["color", "Color"]], L.labelType || "cover", set("labelType", true)));
  if (L.labelType === "color") c.appendChild(spaced(colorField(L.labelColor || "auto:vibrant", set("labelColor"))));
  c.appendChild(spaced(h("div", "hint", "Spins while music plays.")));
}

function progressInspector(box, L, set) {
  const f = section(box, "Fill");
  f.appendChild(h("div", "label", "Bar"));
  f.appendChild(colorField(L.color || "#FFFFFF", set("color")));
  f.appendChild(h("div", "label", "Track"));
  f.appendChild(colorField(L.trackColor || "rgba(255,255,255,0.25)", set("trackColor")));
  f.appendChild(toggleRow("Rounded", L.rounded !== false, set("rounded")));
}

function waveInspector(box, L, set) {
  const c = section(box, "Waveform");
  c.appendChild(sliderRow("Bars", L.bars ?? 48, { min: 8, max: 160, step: 1, decimals: 0 }, set("bars")));
  c.appendChild(sliderRow("Bounce", L.bounce ?? 0.25, { min: 0, max: 1, step: 0.05 }, set("bounce")));
  c.appendChild(sliderRow("Gap", L.gap ?? 0.3, { min: 0, max: 2, step: 0.05 }, set("gap")));
  section(box, "Fill").appendChild(colorField(L.color || "#FFFFFF", set("color")));
}

function swatchesInspector(box, L, set) {
  const c = section(box, "Swatches");
  c.appendChild(sliderRow("Colors", L.count ?? 5, { min: 2, max: 6, step: 1, decimals: 0 }, set("count")));
  c.appendChild(sliderRow("Gap", L.gap ?? 0.8, { min: 0, max: 4, step: 0.1 }, set("gap")));
  c.appendChild(toggleRow("Hex labels", L.labels !== false, set("labels", true)));
  if (L.labels !== false) c.appendChild(colorField(L.labelColor || "#FFFFFF", set("labelColor")));
}

function backgroundInspector(box) {
  const bg = (B.design.background = B.design.background || { type: "cover-blur" });
  const set = (key, rebuild) => (v) => commit(() => { bg[key] = v; }, "bg:" + key, rebuild);
  const s = section(box, "Background");
  const t = bg.type || "cover-blur";
  s.appendChild(selectField([["cover-blur", "Blurred album cover"], ["mesh", "Glow from cover colors"], ["gradient", "Gradient"], ["image", "Image"], ["solid", "Solid color"]], t, set("type", true)));
  if (t === "cover-blur") {
    s.appendChild(sliderRow("Blur", bg.blur ?? 80, { min: 0, max: 200, step: 1, decimals: 0 }, set("blur")));
    s.appendChild(sliderRow("Darken", bg.dim ?? 0.45, { min: 0, max: 0.95, step: 0.01 }, set("dim")));
    s.appendChild(sliderRow("Saturation", bg.saturation ?? 1.2, { min: 0, max: 2, step: 0.05 }, set("saturation")));
  } else if (t === "mesh") {
    s.appendChild(sliderRow("Brightness", bg.brightness ?? 0.6, { min: 0.2, max: 1, step: 0.01 }, set("brightness")));
    s.appendChild(toggleRow("Moving", bg.animate !== false, set("animate")));
  } else if (t === "gradient") {
    s.appendChild(h("div", "label", "From"));
    s.appendChild(colorField(bg.colorA || "auto:vibrant", set("colorA")));
    s.appendChild(h("div", "label", "To"));
    s.appendChild(colorField(bg.colorB || "auto:dark", set("colorB")));
    s.appendChild(spaced(numField("rotate", bg.angle ?? 135, { step: 5, suffix: "°", decimals: 0 }, set("angle"))));
  } else if (t === "image") {
    const thumb = h("div", "img-thumb");
    if (bg.src) thumb.style.backgroundImage = `url("${bg.src}")`;
    s.appendChild(spaced(thumb));
    const b = h("button", "btn wide", bg.src ? "Replace image…" : "Choose image…");
    b.onclick = () => pickImage("background");
    s.appendChild(b);
    s.appendChild(sliderRow("Darken", bg.dim ?? 0, { min: 0, max: 0.95, step: 0.01 }, set("dim")));
  } else {
    s.appendChild(spaced(colorField(bg.color || "#0B0B0D", set("color"))));
  }
  s.appendChild(toggleRow("Film grain", bg.grain, set("grain")));
  const tip = section(box, "Tips");
  tip.appendChild(h("div", "hint", "Pick a tool in the bar under the canvas and drag on the canvas to draw. Drop images from Finder onto the canvas. Colors set to Auto follow each song's cover. Right-click a layer for more options."));
}

let inspectorQueued = false;
function renderInspectorSoon() {
  if (inspectorQueued) return;
  inspectorQueued = true;
  requestAnimationFrame(() => {
    inspectorQueued = false;
    if (!document.activeElement || document.activeElement.tagName !== "INPUT" || document.activeElement.type === "range") renderInspector();
  });
}

// ---------- saving, code, status ----------

$("name").addEventListener("input", () => { B.name = $("name").value; B.saved = false; updateStatus(); scheduleAutosave(); });

function save(activate) {
  if (!B.design) return;
  B.saving = true;
  clearTimeout(B.autosave);
  updateStatus("Saving…");
  post({ type: "save", name: B.name.trim() || "My Template", design: B.design, activate: !!activate });
}

/** After the first save, changes save themselves. */
function scheduleAutosave() {
  if (!B.id) return;
  clearTimeout(B.autosave);
  B.autosave = setTimeout(() => save(false), 900);
}

function updateStatus(text) {
  $("status").textContent = text || (B.saving ? "Saving…" : B.saved ? (B.id ? "Saved" : "") : B.id ? "Edited" : "Not saved yet");
  $("undo").disabled = !B.undo.length;
  $("redo").disabled = !B.redo.length;
}

/** Edit Code: the canvas turns the design into a plain HTML/CSS template; the app saves it and opens your editor. */
function editCode() {
  if (!B.design) return;
  const onMsg = (e) => {
    if (!e.data || e.data.type !== "sw:exported") return;
    window.removeEventListener("message", onMsg);
    post({ type: "exportCode", name: B.name.trim() || "My Template", html: e.data.html });
  };
  window.addEventListener("message", onMsg);
  canvas.contentWindow?.postMessage({ type: "sw:export", design: B.design }, "*");
}

$("undo").innerHTML = ICON.undo;
$("redo").innerHTML = ICON.redo;
$("code").innerHTML = `${ICON.code}<span>Edit Code</span>`;
$("undo").onclick = undo;
$("redo").onclick = redo;
$("save").onclick = () => save(false);
$("use").onclick = () => save(true);
$("code").onclick = editCode;

// ---------- starters ----------

function showStarters() {
  const grid = $("starterGrid");
  grid.innerHTML = "";
  for (const s of STARTERS) {
    const b = h("button", "starter");
    b.innerHTML = `<div class="thumb" style="background:${s.thumb}"></div><div class="meta"><b></b><span></span></div>`;
    b.querySelector("b").textContent = s.name;
    b.querySelector("span").textContent = s.desc;
    b.onclick = () => {
      B.design = clone(s.design);
      B.name = s.name === "Blank" ? "My Template" : "My " + s.name;
      $("name").value = B.name;
      $("starters").hidden = true;
      B.undo = [];
      B.redo = [];
      renderAll();
      B.saved = false;
      updateStatus();
    };
    grid.appendChild(b);
  }
  $("starters").hidden = false;
}

function renderAll() { renderLayers(); renderOverlay(); renderInspector(); renderToolbar(); sendDesign(); }

// ---------- keyboard ----------

window.addEventListener("keydown", (e) => {
  const el = document.activeElement;
  const typing = (el.tagName === "INPUT" && !["range", "checkbox", "color"].includes(el.type)) || el.tagName === "SELECT" || el.tagName === "TEXTAREA";
  const cmd = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (cmd && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (cmd && k === "s") { e.preventDefault(); save(false); return; }
  if (typing || !B.design) return;
  if (!cmd && !e.altKey) {
    const tool = { v: "move", t: "text", r: "rect", o: "ellipse", l: "line", y: "lyrics", c: "cover" }[k];
    if (tool) { setTool(tool); return; }
    if (k === "i") { pickImage(); return; }
    if (e.key === "Escape" && B.tool !== "move") { setTool("move"); return; }
  }
  if (cmd && k === "v") { e.preventDefault(); pasteLayer(); return; }
  const L = selected();
  if (!L) return;
  if (cmd && k === "c") { e.preventDefault(); copyLayer(); return; }
  if (cmd && k === "d") { e.preventDefault(); duplicateLayer(L.id); return; }
  if (cmd && e.key === "]") { e.preventDefault(); reorder(L.id, "front"); return; }
  if (cmd && e.key === "[") { e.preventDefault(); reorder(L.id, "back"); return; }
  if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); deleteLayer(L.id); return; }
  if (e.key === "Escape") { select(null); return; }
  const step = e.shiftKey ? 5 : 0.5;
  const d = { arrowleft: ["x", -step], arrowright: ["x", step], arrowup: ["y", -step], arrowdown: ["y", step] }[k];
  if (d && !L.locked) { e.preventDefault(); commit(() => { L[d[0]] = round(L[d[0]] + d[1]); }, L.id + ":nudge"); renderInspectorSoon(); }
});

renderToolbar();
renderScreens();
layoutCanvas();
post({ type: "ready" });
