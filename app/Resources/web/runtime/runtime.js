/*
 * Spotify Wallpaper template runtime. Every template includes this. It:
 *   - binds data to the page:      data-bind="track.title|upper"  data-src="track.cover"
 *                                  data-show="lyrics.hasLyrics"    data-attr-after="params.linesAfter"
 *   - exposes CSS variables:       --progress --line-progress --cover-url --vibrant --p0… --param-<key>
 *   - drives smart components:     <lyrics-block> <fit-text> <swatch-row> <wave-form> <progress-bar>
 *   - offers hooks for custom JS:  Wallpaper.on('render', ctx => …)
 * See TEMPLATE_GUIDE.md in the templates folder for the full reference.
 */
(function () {
  const FONTS = {
    "SF Pro": "-apple-system, system-ui, sans-serif",
    "SF Pro Variable": "'SF Var', -apple-system, sans-serif",
    "SF Pro Rounded": "ui-rounded, -apple-system, sans-serif",
    "SF Mono": "ui-monospace, Menlo, monospace",
    "New York": "ui-serif, 'New York', Georgia, serif",
    "Helvetica Neue": "'Helvetica Neue', Helvetica, sans-serif",
    "Avenir Next": "'Avenir Next', Avenir, sans-serif",
    "Futura": "Futura, sans-serif",
    "Gill Sans": "'Gill Sans', sans-serif",
    "Optima": "Optima, sans-serif",
    "Didot": "Didot, serif",
    "Bodoni 72": "'Bodoni 72', serif",
    "Baskerville": "Baskerville, serif",
    "Georgia": "Georgia, serif",
    "American Typewriter": "'American Typewriter', serif",
    "Courier New": "'Courier New', monospace",
    "Snell Roundhand": "'Snell Roundhand', cursive",
    "Marker Felt": "'Marker Felt', fantasy",
  };
  const AUTO_COLORS = ["vibrant", "dominant", "card", "deep", "dark", "light", "muted", "paper", "onDominant"];

  const listeners = {};
  const Wallpaper = (window.Wallpaper = {
    fonts: FONTS,
    autoColors: AUTO_COLORS,
    manifest: null,
    ctx: null,
    on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },
  });
  const emit = (event, ...args) =>
    (listeners[event] || []).forEach((fn) => { try { fn(...args); } catch (e) { console.error(e); } });

  // ---------- helpers ----------

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };
  const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const PIPES = {
    upper: (v) => String(v ?? "").toUpperCase(),
    lower: (v) => String(v ?? "").toLowerCase(),
    note: (v) => (String(v ?? "").trim() ? v : "• • •"),
    time: (v) => fmtTime(v),
    pct: (v) => Math.round((v || 0) * 100) + "%",
    hex: (v) => String(v ?? "").toUpperCase(),
    kclass: (v) => (v ? "karaoke" : ""),
  };
  function evaluate(expr, ctx) {
    expr = expr.trim();
    let negate = false;
    if (expr.startsWith("!")) { negate = true; expr = expr.slice(1); }
    const [path, ...pipes] = expr.split("|").map((s) => s.trim());
    let v = get(ctx, path);
    for (const p of pipes) if (PIPES[p]) v = PIPES[p](v);
    return negate ? !v : v;
  }
  function toPx(v, fallback) {
    if (v == null || v === "") return fallback;
    const m = String(v).match(/^([\d.]+)\s*(px|vmin|vmax|vw|vh)?$/);
    if (!m) return fallback;
    const n = parseFloat(m[1]), W = innerWidth, H = innerHeight;
    return { px: n, vmin: (n * Math.min(W, H)) / 100, vmax: (n * Math.max(W, H)) / 100, vw: (n * W) / 100, vh: (n * H) / 100 }[m[2] || "px"];
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // ---------- state → template context ----------

  function resolveParams(raw, colors) {
    const out = {};
    for (const p of (Wallpaper.manifest && Wallpaper.manifest.params) || []) {
      let v = raw[p.key] !== undefined ? raw[p.key] : p.default;
      if (p.type === "color" && typeof v === "string" && v.startsWith("auto:")) v = colors[v.slice(5)] || "#888888";
      out[p.key] = v;
    }
    for (const k in raw) if (!(k in out)) out[k] = raw[k];
    return out;
  }

  function derive(payload) {
    const t = payload.track || {};
    const L = payload.lyrics || {};
    const lines = L.lines || [];
    const i = L.index ?? -1;
    const text = (k) => (k >= 0 && k < lines.length ? lines[k].text : "");
    const colors = payload.colors || {};
    const lineStart = i >= 0 ? lines[i].t : 0;
    const lineEnd = i + 1 < lines.length ? lines[i + 1].t : t.duration || lineStart + 4;
    const prev = [], next = [];
    for (let k = 1; k <= 8; k++) { prev.push(text(i - k)); next.push(text(i + k)); }
    const current = text(i);
    return {
      track: {
        ...t,
        progress: t.duration ? clamp(t.position / t.duration, 0, 1) : 0,
        elapsed: fmtTime(t.position),
        remaining: "-" + fmtTime((t.duration || 0) - (t.position || 0)),
        length: fmtTime(t.duration),
      },
      lyrics: {
        lines, index: i, current, prev, next,
        prev1: prev[0], next1: next[0], next2: next[1], next3: next[2],
        lineProgress: i >= 0 ? clamp((t.position - lineStart) / Math.max(0.1, lineEnd - lineStart), 0, 1) : 0,
        synced: !!L.synced,
        hasLyrics: lines.length > 0,
        isInstrumental: lines.length > 0 && !current.trim(),
      },
      colors,
      params: resolveParams(payload.params || {}, colors),
      screen: payload.screen || { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
    };
  }

  // ---------- applying the context ----------

  function applyVariables(ctx) {
    const root = document.documentElement, s = root.style;
    s.setProperty("--progress", ctx.track.progress);
    s.setProperty("--line-progress", ctx.lyrics.lineProgress);
    s.setProperty("--cover-url", ctx.track.cover ? `url("${ctx.track.cover}")` : "none");
    for (const name of AUTO_COLORS) if (ctx.colors[name]) s.setProperty("--" + name, ctx.colors[name]);
    (ctx.colors.palette || []).forEach((c, k) => s.setProperty("--p" + k, c));

    for (const p of (Wallpaper.manifest && Wallpaper.manifest.params) || []) {
      let v = ctx.params[p.key];
      if (p.type === "font") v = FONTS[v] || v;
      else if (p.type === "bool") { root.classList.toggle("param-" + p.key, !!v); v = v ? 1 : 0; }
      else if ((p.type === "number" || p.type === "int") && p.unit) v = v + p.unit;
      s.setProperty("--param-" + p.key, v);
    }
    const flags = {
      "is-playing": ctx.track.isPlaying, "has-lyrics": ctx.lyrics.hasLyrics, synced: ctx.lyrics.synced,
      instrumental: ctx.lyrics.isInstrumental, ultrawide: ctx.screen.width / ctx.screen.height > 2,
    };
    for (const k in flags) root.classList.toggle(k, !!flags[k]);
  }

  function applyBindings(ctx) {
    for (const el of document.querySelectorAll("*")) {
      for (const attr of [...el.attributes]) {
        if (!attr.name.startsWith("data-attr-")) continue;
        const name = attr.name.slice(10), v = String(evaluate(attr.value, ctx) ?? "");
        if (el.getAttribute(name) !== v) el.setAttribute(name, v);
      }
    }
    for (const el of document.querySelectorAll("[data-bind]")) {
      const raw = evaluate(el.dataset.bind, ctx), v = raw == null ? "" : String(raw);
      if (el.textContent !== v) el.textContent = v;
    }
    for (const el of document.querySelectorAll("[data-src]")) {
      const v = evaluate(el.dataset.src, ctx);
      if (v && el.getAttribute("src") !== v) el.setAttribute("src", v);
    }
    for (const el of document.querySelectorAll("[data-show]")) {
      const hide = !evaluate(el.dataset.show, ctx);
      if (el.hidden !== hide) el.hidden = hide;
    }
  }

  // ---------- components ----------

  // Children are an intro line ("• • •" before the first lyric) followed by one .line per lyric.
  function lyricsBlock(el, ctx) {
    const { lines, index } = ctx.lyrics;
    const before = +(el.getAttribute("before") ?? 2), after = +(el.getAttribute("after") ?? 3);
    const layout = el.getAttribute("layout") || "flow";
    const empty = el.getAttribute("empty") ?? "• • •";
    const sig = ctx.track.id + ":" + lines.length + ":" + empty;
    let inner = el.querySelector(":scope > .lines");
    if (!inner || el._sig !== sig) {
      el.innerHTML = "";
      inner = document.createElement("div");
      inner.className = "lines";
      el.appendChild(inner);
      if (lines.length) for (const text of [empty, ...lines.map((l) => (l.text.trim() ? l.text : empty))]) {
        inner.appendChild(Object.assign(document.createElement("div"), { textContent: text }));
      }
      el._sig = sig;
    }
    el.dataset.layout = layout;
    [...inner.children].forEach((d, k) => {
      const isIntro = k === 0;
      const off = k - 1 - index;
      const state = off < 0 ? "past" : off === 0 ? "current" : "next";
      const out = off < -before || off > after || (isIntro && index >= 0);
      const gap = isIntro || !lines[k - 1].text.trim();
      d.className = "line " + state + (out ? " out" : "") + (gap ? " gap" : "");
      d.dataset.offset = off;
      d.style.setProperty("--offset", off);
      d.style.setProperty("--dist", Math.abs(off));
    });
  }

  function positionLyrics(el, ctx) {
    const inner = el.querySelector(":scope > .lines");
    if (!inner || el.dataset.layout === "flow" || !inner.children.length) return;
    const kids = inner.children;
    const cur = Math.min(kids.length - 1, ctx.lyrics.index + 1);
    let y;
    if (el.dataset.layout === "top") {
      const first = [...kids].findIndex((d) => !d.classList.contains("out"));
      y = -kids[Math.max(0, first)].offsetTop;
    } else {
      y = el.clientHeight / 2 - (kids[cur].offsetTop + kids[cur].offsetHeight / 2);
    }
    inner.style.transform = `translateY(${y}px)`;
  }

  function fitText(el) {
    const maxLines = +(el.getAttribute("max-lines") || 1);
    let lo = toPx(el.getAttribute("min"), 8), hi = toPx(el.getAttribute("max"), 400), best = lo;
    const fits = () => {
      const cs = getComputedStyle(el);
      let lh = parseFloat(cs.lineHeight);
      if (isNaN(lh)) lh = parseFloat(cs.fontSize) * 1.2;
      return el.scrollHeight <= lh * maxLines + 1 && el.scrollWidth <= el.clientWidth + 1;
    };
    for (let n = 0; n < 16; n++) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = mid + "px";
      if (fits()) { best = mid; lo = mid; } else hi = mid;
    }
    el.style.fontSize = best + "px";
  }

  function swatchRow(el, ctx) {
    const n = +(el.getAttribute("count") || 5);
    const labels = el.hasAttribute("labels") && el.getAttribute("labels") !== "false";
    el.innerHTML = (ctx.colors.palette || []).slice(0, n).map((c) =>
      `<div class="swatch"><div class="chip" style="background:${c}"></div>${labels ? `<div class="hex">${c.toUpperCase()}</div>` : ""}</div>`
    ).join("");
  }

  function waveForm(el, ctx) {
    const n = +(el.getAttribute("bars") || 56);
    let seed = hash(ctx.track.id + ":" + ctx.lyrics.index);
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    if (el.children.length !== n) {
      el.innerHTML = "";
      for (let k = 0; k < n; k++) el.appendChild(Object.assign(document.createElement("div"), { className: "bar" }));
      el._cur = null;
    }
    el._target = [...el.children].map((_, k) => {
      const env = 0.25 + 0.75 * Math.pow(1 - Math.abs(k - n / 2) / (n / 2), 0.6);
      return Math.max(8, env * (25 + 75 * rnd()));
    });
    if (!live || !el._cur) {
      el._cur = el._target.slice();
      [...el.children].forEach((b, k) => (b.style.height = el._cur[k] + "%"));
    }
  }

  function animateWaves(now, playing) {
    for (const el of document.querySelectorAll("wave-form")) {
      if (!el._target || !el._cur) continue;
      const bars = el.children;
      for (let k = 0; k < bars.length; k++) {
        el._cur[k] += (el._target[k] - el._cur[k]) * 0.12;
        const wobble = playing ? 0.82 + 0.18 * Math.sin(now / 260 + k * 0.7) : 1;
        bars[k].style.height = Math.max(6, el._cur[k] * wobble) + "%";
      }
    }
  }

  function progressBar(el) {
    if (!el.querySelector(":scope > .fill")) el.appendChild(Object.assign(document.createElement("div"), { className: "fill" }));
  }

  // ---------- render ----------

  function applyAll(ctx) {
    Wallpaper.ctx = ctx;
    applyVariables(ctx);
    applyBindings(ctx);
    document.querySelectorAll("lyrics-block").forEach((el) => lyricsBlock(el, ctx));
    document.querySelectorAll("swatch-row").forEach((el) => swatchRow(el, ctx));
    document.querySelectorAll("wave-form").forEach((el) => waveForm(el, ctx));
    document.querySelectorAll("progress-bar").forEach(progressBar);
    emit("render", ctx);
  }

  function layoutAll(ctx) {
    document.querySelectorAll("fit-text").forEach(fitText);
    document.querySelectorAll("lyrics-block").forEach((el) => positionLyrics(el, ctx));
    emit("layout", ctx);
  }

  async function settle(ctx) {
    try { await document.fonts.ready; } catch (e) {}
    const waits = [...document.images].filter((i) => i.getAttribute("src")).map((i) => i.decode().catch(() => {}));
    if (ctx.track.cover) {
      const img = new Image();
      img.src = ctx.track.cover;
      waits.push(img.decode().catch(() => {}));
    }
    await Promise.all(waits);
  }

  const ready = new Promise((resolve) => {
    const boot = async () => {
      try {
        const res = await fetch("manifest.json", { cache: "no-store" });
        Wallpaper.manifest = await res.json();
      } catch (e) {
        Wallpaper.manifest = { params: [] };
      }
      resolve();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  });

  // One-off render, used for the still that becomes the real wallpaper.
  async function render(payload) {
    await ready;
    const ctx = derive(payload);
    applyAll(ctx);
    await settle(ctx);
    layoutAll(ctx);
    await sleep(30);
  }

  // Renders are serialized; if several arrive while one runs, only the newest is drawn.
  let running = null, queued = null;
  function schedule(payload) {
    if (running) {
      queued = payload;
      return running.then(() => (queued ? schedule(queued) : null));
    }
    queued = null;
    running = render(payload).finally(() => { running = null; });
    return running;
  }

  // ---------- live mode (desktop layer + preview) ----------
  // The app sends full state when the song/settings change and a playback clock every 0.1s. Between those,
  // the page runs its own clock, so a lyric line changes on its exact timestamp, and animates on every frame.

  const LEAD = 0.1;  // seconds a line shows before its timestamp
  let live = null, liveDirty = false, liveIdx = null, lastBind = 0, looping = false, lastFrame = 0;

  function livePosition() {
    const t = live.track;
    const p = (t.position || 0) + (t.isPlaying ? (Date.now() - (t.stamp || Date.now())) / 1000 : 0);
    return t.duration ? Math.min(p, t.duration) : p;
  }

  function indexAt(lines, pos) {
    let i = -1;
    for (let k = 0; k < lines.length; k++) {
      if (lines[k].t <= pos + LEAD) i = k; else break;
    }
    return i;
  }

  function liveContext() {
    const pos = livePosition();
    const lines = (live.lyrics && live.lyrics.lines) || [];
    return derive({ ...live, track: { ...live.track, position: pos }, lyrics: { ...live.lyrics, index: indexAt(lines, pos) } });
  }

  function restartEnterAnimations() {
    for (const el of document.querySelectorAll("[data-animate]")) {
      el.classList.remove("sw-enter");
      void el.offsetWidth;
      el.classList.add("sw-enter");
    }
  }

  function frame(now) {
    if (!live) { looping = false; return; }
    // optional frame-rate cap (the app's Refresh Rate setting); 0 = every display frame
    const fps = +live.fps || 0;
    if (fps && now - lastFrame < 1000 / fps - 2) { requestAnimationFrame(frame); return; }
    lastFrame = now;
    const ctx = liveContext();
    const lineChanged = ctx.lyrics.index !== liveIdx;
    if (liveDirty || lineChanged) {
      const firstForTrack = liveDirty;
      liveDirty = false;
      liveIdx = ctx.lyrics.index;
      applyAll(ctx);
      layoutAll(ctx);
      if (lineChanged) { restartEnterAnimations(); emit("line", ctx); }
      if (firstForTrack) settle(ctx).then(() => live && layoutAll(Wallpaper.ctx));
    } else {
      const s = document.documentElement.style;
      s.setProperty("--progress", ctx.track.progress);
      s.setProperty("--line-progress", ctx.lyrics.lineProgress);
      if (now - lastBind > 250) { lastBind = now; Wallpaper.ctx = ctx; applyBindings(ctx); }
    }
    animateWaves(now, ctx.track.isPlaying);
    emit("frame", ctx);
    requestAnimationFrame(frame);
  }

  function startLive(payload) {
    live = payload;
    liveDirty = true;
    document.documentElement.classList.add("sw-live");
    ready.then(() => {
      if (!looping) { looping = true; requestAnimationFrame(frame); }
    });
  }

  function setClock(c) {
    if (!live) return;
    live.track = { ...live.track, position: c.position, isPlaying: c.isPlaying, stamp: c.stamp };
  }

  window.__sw = { render: schedule, live: startLive, clock: setClock };
  // The Customize window's preview talks over postMessage.
  window.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "sw:update") schedule(m.payload);
    else if (m.type === "sw:live") startLive(m.payload);
    else if (m.type === "sw:clock") setClock(m.clock);
  });
})();
