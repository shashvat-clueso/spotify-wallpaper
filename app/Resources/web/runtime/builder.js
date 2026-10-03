/*
 * Renders a Template Builder design (design.json) into the page, using the runtime's bindings and components.
 * Layers are boxes positioned in % of the screen; sizes are in vmin, so a design adapts to any display.
 * The Builder's canvas also sends designs over postMessage ({type: "sw:design", design}) while you edit,
 * and asks for a standalone HTML version ({type: "sw:export"}) for "Edit Code".
 */
(function () {
  const W = window.Wallpaper;
  const style = document.createElement("style");
  document.head.appendChild(style);

  const col = (v, fallback) => (!v ? fallback : String(v).startsWith("auto:") ? `var(--${String(v).slice(5)})` : v);
  const font = (f) => W.fonts[f] || (f ? `'${f}', -apple-system, sans-serif` : W.fonts["SF Pro"]);
  const num = (v, d) => (v === undefined || v === null || v === "" || isNaN(+v) ? d : +v);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // ---------- shapes ----------

  function starPoints(points, inner) {
    const out = [];
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 ? inner : 1, a = (Math.PI * i) / points - Math.PI / 2;
      out.push(`${(50 + 50 * r * Math.cos(a)).toFixed(2)}% ${(50 + 50 * r * Math.sin(a)).toFixed(2)}%`);
    }
    return `polygon(${out.join(", ")})`;
  }

  function polygonPoints(sides) {
    const out = [];
    for (let i = 0; i < sides; i++) {
      const a = (2 * Math.PI * i) / sides - Math.PI / 2;
      out.push(`${(50 + 50 * Math.cos(a)).toFixed(2)}% ${(50 + 50 * Math.sin(a)).toFixed(2)}%`);
    }
    return `polygon(${out.join(", ")})`;
  }

  const CLIP = {
    triangle: () => "polygon(50% 0, 100% 100%, 0 100%)",
    star: (L) => starPoints(num(L.points, 5), num(L.inner, 0.45)),
    polygon: (L) => polygonPoints(num(L.sides, 6)),
    arrow: () => "polygon(0 35%, 62% 35%, 62% 8%, 100% 50%, 62% 92%, 62% 65%, 0 65%)",
  };

  function fill(L, fallback) {
    switch (L.fillType || "solid") {
      case "gradient": return `background: linear-gradient(${num(L.fillAngle, 135)}deg, ${col(L.fill, "var(--vibrant)")}, ${col(L.fillB, "var(--dark)")});`;
      case "radial": return `background: radial-gradient(circle at 50% 40%, ${col(L.fill, "var(--vibrant)")}, ${col(L.fillB, "var(--dark)")});`;
      case "cover": return `background: var(--cover-url) center / cover;`;
      case "image": return L.src ? `background: url("${L.src}") center / ${L.fit || "cover"} no-repeat;` : "background: transparent;";
      case "none": return "background: transparent;";
      default: return `background: ${col(L.fill, fallback || "var(--card)")};`;
    }
  }

  // ---------- background ----------

  function background(bg, css) {
    const el = document.createElement("div");
    el.className = "b-bg";
    css.push(`.b-bg { position: absolute; inset: 0; overflow: hidden; }`);
    const type = bg.type || "cover-blur";
    if (type === "cover-blur") {
      // blurred once per song by the app, not live
      el.innerHTML = `<div class="b-bg-img" data-cover-blur="${num(bg.blur, 80)}" data-cover-saturate="${num(bg.saturation, 1.2)}"></div><div class="b-bg-dim"></div>`;
      css.push(`.b-bg-img { position: absolute; inset: -12%; background: center / cover no-repeat; }
.b-bg-dim { position: absolute; inset: 0; background: ${col(bg.tint, "#000")}; opacity: ${num(bg.dim, 0.45)}; }`);
    } else if (type === "gradient") {
      css.push(`.b-bg { background: linear-gradient(${num(bg.angle, 135)}deg, ${col(bg.colorA, "var(--vibrant)")}, ${col(bg.colorB, "var(--dark)")}); }`);
    } else if (type === "mesh") {
      // soft radial-gradient blobs (no live blur), dimmed with an overlay
      el.innerHTML = `<div class="b-mesh"><i></i><i></i><i></i><i></i><i></i></div><div class="b-mesh-dim"></div>`;
      const blob = (c) => `background: radial-gradient(closest-side, ${c}, transparent);`;
      css.push(`.b-bg { background: var(--dark); }
.b-mesh { position: absolute; inset: -20%; }
.b-mesh i { position: absolute; width: 95vmax; height: 95vmax; border-radius: 50%; margin: -47.5vmax 0 0 -47.5vmax; will-change: transform; }
.b-mesh i:nth-child(1) { left: 18%; top: 22%; ${blob("var(--p0)")} }
.b-mesh i:nth-child(2) { left: 84%; top: 18%; ${blob("var(--vibrant)")} }
.b-mesh i:nth-child(3) { left: 70%; top: 86%; ${blob("var(--p2)")} }
.b-mesh i:nth-child(4) { left: 20%; top: 88%; ${blob("var(--p3)")} }
.b-mesh i:nth-child(5) { left: 50%; top: 50%; width: 65vmax; height: 65vmax; margin: -32.5vmax 0 0 -32.5vmax; ${blob("var(--p1)")} }
.b-mesh-dim { position: absolute; inset: 0; background: #000; opacity: ${(1 - num(bg.brightness, 0.6)).toFixed(2)}; }`);
      if (bg.animate !== false) {
        css.push(`.sw-live .b-mesh i { animation: b-drift 26s ease-in-out infinite alternate; }
.sw-live .b-mesh i:nth-child(2n) { animation-duration: 33s; animation-delay: -9s; }
.sw-live .b-mesh i:nth-child(3n) { animation-duration: 22s; animation-delay: -14s; }
@keyframes b-drift { to { transform: translate(14vmax, -10vmax) scale(1.25); } }`);
      }
    } else if (type === "image" && bg.src) {
      css.push(`.b-bg { background: url("${bg.src}") center / cover no-repeat; }`);
      if (num(bg.dim, 0)) { el.innerHTML = `<div class="b-bg-dim"></div>`; css.push(`.b-bg-dim { position: absolute; inset: 0; background: #000; opacity: ${num(bg.dim, 0)}; }`); }
    } else {
      css.push(`.b-bg { background: ${col(bg.color, "#0B0B0D")}; }`);
    }
    return el;
  }

  // ---------- layers ----------

  function textCSS(sel, L) {
    return `${sel} { font-family: ${font(L.font)}; font-weight: ${num(L.weight, 600)}; color: ${col(L.color, "#fff")};
  text-align: ${L.align || "left"}; line-height: ${num(L.lineHeight, 1.2)}; letter-spacing: ${num(L.letterSpacing, 0)}em;
  text-transform: ${L.case || "none"}; font-style: ${L.italic ? "italic" : "normal"};${L.shadow ? " text-shadow: 0 0.3vmin 2vmin rgba(0,0,0,.45);" : ""} }`;
  }

  /** Effects shared by every layer: rotation, blend mode, layer blur and drop shadow. */
  function frameCSS(id, L, index) {
    const filters = [];
    if (num(L.blur, 0)) filters.push(`blur(${num(L.blur, 0)}px)`);
    if (L.shadow && L.type !== "text" && L.type !== "lyrics") {
      filters.push(`drop-shadow(0 ${num(L.shadowY, 1.5)}vmin ${num(L.shadowBlur, 3)}vmin rgba(0,0,0,${num(L.shadowOpacity, 0.4)}))`);
    }
    return `${id} { position: absolute; left: ${num(L.x, 10)}%; top: ${num(L.y, 10)}%; width: ${num(L.w, 30)}%; height: ${num(L.h, 10)}%;
  opacity: ${num(L.opacity, 1)}; z-index: ${index + 1};${num(L.rotation, 0) ? ` transform: rotate(${num(L.rotation, 0)}deg);` : ""}
  ${L.blend && L.blend !== "normal" ? `mix-blend-mode: ${L.blend};` : ""}${filters.length ? ` filter: ${filters.join(" ")};` : ""} }`;
  }

  /** Looping motion on a layer's content (live layer only; stills stay put). */
  const MOTION = {
    spin: { kf: "to { transform: rotate(360deg); }", easing: "linear", dir: "normal" },
    pulse: { kf: "from { transform: scale(1); } to { transform: scale(1.07); }", easing: "ease-in-out", dir: "alternate" },
    float: { kf: "from { transform: translateY(0); } to { transform: translateY(-6%); }", easing: "ease-in-out", dir: "alternate" },
    sway: { kf: "from { transform: rotate(-4deg); } to { transform: rotate(4deg); }", easing: "ease-in-out", dir: "alternate" },
    blink: { kf: "from { opacity: 1; } to { opacity: 0.3; }", easing: "ease-in-out", dir: "alternate" },
    breathe: { kf: "from { opacity: 0.75; transform: scale(0.97); } to { opacity: 1; transform: scale(1.03); }", easing: "ease-in-out", dir: "alternate" },
  };
  function motionCSS(id, L, css) {
    const m = MOTION[L.motion];
    if (!m) return;
    css.push(`@keyframes b-${L.motion} { ${m.kf} }
.sw-live ${id} > * { animation: b-${L.motion} ${num(L.motionSpeed, 3)}s ${m.easing} infinite ${m.dir}; will-change: transform, opacity; }`);
    if (L.motionPlaying !== false) css.push(`.sw-live:not(.is-playing) ${id} > * { animation-play-state: paused; }`);
  }

  function strokeCSS(L) {
    return num(L.borderWidth, 0) ? `border: ${num(L.borderWidth, 0)}vmin solid ${col(L.borderColor, "#fff")}; box-sizing: border-box;` : "";
  }

  function layer(L, css, index) {
    const el = document.createElement("div");
    el.className = `b-layer b-${L.type}`;
    el.id = "b-" + L.id;
    const id = "#b-" + L.id;
    css.push(frameCSS(id, L, index));
    motionCSS(id, L, css);

    switch (L.type) {
      case "text": {
        const fit = !!L.fit;
        const tag = fit ? "fit-text" : "div";
        const bind = L.content && L.content !== "custom" ? ` data-bind="${esc(L.content)}"` : "";
        const anim = L.animate ? " data-animate" : "";
        const fitAttrs = fit ? ` max-lines="${num(L.lines, 1)}" min="1vmin" max="${num(L.size, 5)}vmin"` : "";
        el.innerHTML = `<${tag} class="b-text"${bind}${anim}${fitAttrs}>${bind ? "" : esc(L.text || "")}</${tag}>`;
        const v = { top: "flex-start", center: "center", bottom: "flex-end" }[L.valign || "top"];
        css.push(`${id} { display: flex; flex-direction: column; justify-content: ${v}; }
${id} .b-text { width: 100%; font-size: ${num(L.size, 5)}vmin; ${fit ? "max-height: 100%;" : "overflow: hidden;"} }`);
        css.push(textCSS(`${id} .b-text`, L));
        break;
      }
      case "lyrics": {
        el.innerHTML = `<lyrics-block layout="${L.layout || "center"}" before="${num(L.before, 1)}" after="${num(L.after, 3)}"
  class="${L.karaoke ? "karaoke" : ""}" empty="${esc(L.empty ?? "• • •")}"></lyrics-block>`;
        // lyrics stay inside their box; stacked/scrolling lists fade out at the bottom edge
        const fadeOut = (L.layout || "center") !== "center" ? "-webkit-mask-image: linear-gradient(to bottom, #000 82%, transparent);" : "";
        css.push(`${id} { overflow: hidden; }
${id} lyrics-block { width: 100%; height: 100%; overflow: hidden; ${fadeOut} }`);
        css.push(textCSS(`${id} .line`, L));
        css.push(`${id} .line { font-size: ${num(L.size, 5)}vmin; margin-bottom: ${num(L.spacing, 0.4)}em; }
${id} .line.next { color: ${col(L.dimColor, col(L.color, "#fff"))}; opacity: calc(${num(L.nextOpacity, 0.45)} * pow(${num(L.fade, 0.75)}, var(--dist) - 1)); }
${id} .line.past { color: ${col(L.dimColor, col(L.color, "#fff"))}; opacity: calc(${num(L.pastOpacity, 0.25)} * pow(${num(L.fade, 0.75)}, var(--dist) - 1)); }
${id} .line.current { opacity: 1; }
${id} lyrics-block.karaoke { --karaoke-on: ${col(L.color, "#fff")}; --karaoke-off: ${col(L.dimColor, "rgba(255,255,255,.4)")}; }`);
        break;
      }
      case "cover": {
        el.innerHTML = `<img class="b-cover${L.square !== false ? " b-square" : ""}" data-src="track.cover" alt="">`;
        css.push(`${id} { display: flex; align-items: ${{ bottom: "flex-end", center: "center" }[L.valign] || "flex-start"};
  justify-content: ${{ right: "flex-end", center: "center" }[L.align] || "flex-start"}; }
${id} .b-cover { width: 100%; height: 100%; object-fit: cover; border-radius: ${num(L.radius, 1.5)}vmin; ${strokeCSS(L)} }`);
        break;
      }
      case "image": {
        el.innerHTML = `<div class="b-image"></div>`;
        const f = [];
        if (num(L.grayscale, 0)) f.push(`grayscale(${num(L.grayscale, 0)})`);
        if (num(L.brightness, 1) !== 1) f.push(`brightness(${num(L.brightness, 1)})`);
        if (num(L.saturation, 1) !== 1) f.push(`saturate(${num(L.saturation, 1)})`);
        css.push(`${id} .b-image { width: 100%; height: 100%; ${fill({ fillType: "image", src: L.src, fit: L.fit })}
  border-radius: ${num(L.radius, 0)}vmin; ${strokeCSS(L)} ${f.length ? `filter: ${f.join(" ")};` : ""}
  ${L.flipX ? "transform: scaleX(-1);" : ""} }`);
        break;
      }
      case "shape": {
        el.innerHTML = `<div class="b-shape"></div>`;
        const kind = L.kind || "rect";
        const glass = num(L.glass, 0);
        const shapeOutline = kind === "ellipse" ? "border-radius: 50%;" : kind === "rect" || kind === "line" ? `border-radius: ${num(L.radius, kind === "line" ? 99 : 3)}vmin;` : "";
        const clip = CLIP[kind] ? `clip-path: ${CLIP[kind](L)};` : "";
        css.push(`${id} .b-shape { width: 100%; height: 100%; ${fill(L)} ${shapeOutline} ${clip}
  ${clip ? "" : strokeCSS(L)}
  ${glass ? `backdrop-filter: blur(${glass}px) saturate(1.4); -webkit-backdrop-filter: blur(${glass}px) saturate(1.4);` : ""} }`);
        break;
      }
      case "vinyl": {
        el.innerHTML = `<div class="b-disc b-square"><div class="b-label"></div><div class="b-hole"></div></div>`;
        const secs = (60 / num(L.rpm, 33)).toFixed(2);
        css.push(`${id} { display: flex; align-items: center; justify-content: center; }
${id} .b-disc { position: relative; border-radius: 50%;
  background: radial-gradient(circle, transparent 0 33%, rgba(255,255,255,.04) 33.5% 34%, transparent 34.5%),
    conic-gradient(from 20deg, rgba(255,255,255,.10), transparent 12%, rgba(255,255,255,.08) 25%, transparent 38%,
      rgba(255,255,255,.10) 50%, transparent 62%, rgba(255,255,255,.08) 75%, transparent 88%, rgba(255,255,255,.10)),
    repeating-radial-gradient(circle, #121212 0 0.35%, #1d1d1d 0.5% 0.7%), #111; }
${id} .b-label { position: absolute; inset: ${(50 - num(L.label, 36) / 2).toFixed(1)}%; border-radius: 50%;
  ${L.labelType === "color" ? `background: ${col(L.labelColor, "var(--vibrant)")};` : "background: var(--cover-url) center / cover;"} }
${id} .b-hole { position: absolute; inset: 48.6%; border-radius: 50%; background: #0b0b0b; }
.sw-live ${id} .b-disc { animation: b-spin ${secs}s linear infinite; }
.sw-live:not(.is-playing) ${id} .b-disc { animation-play-state: paused; }
@keyframes b-spin { to { transform: rotate(360deg); } }`);
        break;
      }
      case "progress": {
        el.innerHTML = `<progress-bar></progress-bar>`;
        css.push(`${id} progress-bar { height: 100%; color: ${col(L.color, "#fff")}; background: ${col(L.trackColor, "rgba(255,255,255,.25)")};
  border-radius: ${L.rounded === false ? 0 : 99}px; }`);
        break;
      }
      case "wave": {
        el.innerHTML = `<wave-form bars="${num(L.bars, 48)}" motion="${num(L.bounce, 0.25)}"></wave-form>`;
        css.push(`${id} wave-form { height: 100%; color: ${col(L.color, "#fff")}; gap: ${num(L.gap, 0.3)}vmin; }`);
        break;
      }
      case "swatches": {
        el.innerHTML = `<swatch-row count="${num(L.count, 5)}" ${L.labels !== false ? "labels" : ""}></swatch-row>`;
        css.push(`${id} swatch-row { height: 100%; gap: ${num(L.gap, 0.8)}vmin; }
${id} .swatch { display: flex; flex-direction: column; }
${id} .chip { flex: 1; height: auto; border-radius: ${num(L.radius, 0)}vmin; }
${id} .hex { color: ${col(L.labelColor, "#fff")}; }`);
        break;
      }
    }
    return el;
  }

  function assemble(design) {
    design = design || {};
    const css = [];
    const frag = document.createDocumentFragment();
    frag.appendChild(background(design.background || {}, css));
    (design.layers || []).forEach((L, i) => { if (!L.hidden) frag.appendChild(layer(L, css, i)); });
    if (design.background && design.background.grain) {
      frag.appendChild(Object.assign(document.createElement("div"), { className: "sw-grain" }));
      css.push(`.sw-grain { z-index: 9999; }`);
    }
    return { frag, css: css.join("\n") };
  }

  function build(design) {
    const { frag, css } = assemble(design);
    style.textContent = css;
    document.body.replaceChildren(frag);
  }

  // Square things (covers, records): the largest square that fits the box.
  function squares() {
    for (const el of document.querySelectorAll(".b-square")) {
      const box = el.parentElement, s = Math.min(box.clientWidth, box.clientHeight);
      el.style.width = el.style.height = s + "px";
    }
  }
  W.on("layout", squares);

  /** A standalone template (plain HTML/CSS + the runtime) for "Edit Code". */
  function exportHTML(design) {
    const { frag, css } = assemble(design);
    const holder = document.createElement("div");
    holder.appendChild(frag);
    const body = [...holder.children].map((n) => "  " + n.outerHTML).join("\n");
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<!-- Exported from the Template Builder. Edit anything; it reloads on your desktop when you save.
     Bindings, components and variables are documented in TEMPLATE_GUIDE.md in the templates folder. -->
<link rel="stylesheet" href="/runtime/runtime.css">
<script src="/runtime/runtime.js"></script>
<style>
${css}
</style>
</head>
<body>
${body}
<script>
  // keep covers and records square
  Wallpaper.on("layout", () => {
    for (const el of document.querySelectorAll(".b-square")) {
      const box = el.parentElement, s = Math.min(box.clientWidth, box.clientHeight);
      el.style.width = el.style.height = s + "px";
    }
  });
</script>
</body>
</html>
`;
  }

  // In a saved template the design sits next to index.html; in the Builder's canvas it arrives by message.
  W.waits.push(
    fetch("design.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && build(d))
      .catch(() => {})
  );

  window.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "sw:design") {
      build(m.design);
      W.refresh();
    } else if (m.type === "sw:export") {
      e.source && e.source.postMessage({ type: "sw:exported", html: exportHTML(m.design) }, "*");
    }
  });
})();
