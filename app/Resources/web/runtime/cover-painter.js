/*
 * Paints the album cover itself as a coarse knife painting (used by the Painted Cover templates).
 *
 * The cover is repainted in three passes of sharp, flat strokes: large slabs, medium strokes, then small ones only
 * where the cover has detail. Strokes run along the edges in the image, so shapes read as painted, not pixelated.
 *
 *   <html data-layout="square">  the cover as a square beside the text (needs a .col element for the text)
 *   <html data-layout="wide">    the cover cropped to fill the screen, text on a solid .panel
 *
 * Params it reads: side, speed, detail ("grow" | "fixed"), level (1–3), ridge, strokes.
 * - strokes: "mixed" (knife slabs, curved sweeps, dry brush, impasto and hatching, each where it suits the cover),
 *   or one kind throughout: "knife", "sweep", "dry", "impasto".
 * - grow: a new song starts as large slabs and gets finer as it plays; the still shows mid detail.
 * - Live layer: a new song is painted over the old one, coarse to fine. Each lyric line refines a band.
 */
(function () {
  const B = Brush, rand = B.rand;
  const COUNTS = { square: [12, 26, 54], wide: [22, 46, 96] };  // strokes across the painting, per pass
  // each kind's length/width relative to a knife stroke in the same cell
  const SHAPE = { knife: [1, 1], sweep: [1.15, 0.95], dry: [1.1, 1], impasto: [0.55, 0.9], hatch: [0.6, 1] };

  let p, g, studio, W = 0, H = 0;
  let cov = null, region = null, layout = "square", side = "left", params = {};
  let passes = [[], [], []], shown = [0, 0, 0], quietUntil = 0, painted = false, paintKey = "", pending = null, flowAngle = 0;

  const ready = new Promise((resolve) => {
    new p5((sk) => {
      p = sk;
      sk.setup = () => {
        sk.pixelDensity(1);
        sk.createCanvas(innerWidth, innerHeight).elt.classList.add("paint");
        sk.noLoop();
        g = sk.drawingContext;
        studio = B.studio(sk);
        resolve();
      };
      sk.draw = draw;
      sk.windowResized = () => { paintKey = ""; if (Wallpaper.ctx) prepare(Wallpaper.ctx); };
    });
  });

  // ---------- geometry ----------
  function computeRegion() {
    if (layout === "wide") {
      // cover-fit crop of the (square) cover to the screen
      const A = W / H, crop = A >= 1 ? { x0: 0, x1: 1, y0: (1 - 1 / A) / 2, y1: 1 - (1 - 1 / A) / 2 } : { x0: (1 - A) / 2, x1: 1 - (1 - A) / 2, y0: 0, y1: 1 };
      return { x: 0, y: 0, w: W, h: H, crop };
    }
    const size = Math.min(H * 0.84, W * 0.52), gap = W * 0.06;
    const x = side === "left" ? W - gap - size : gap;
    return { x, y: (H - size) / 2, w: size, h: size, crop: { x0: 0, x1: 1, y0: 0, y1: 1 } };
  }
  const toCover = (fx, fy) => [region.crop.x0 + fx * (region.crop.x1 - region.crop.x0), region.crop.y0 + fy * (region.crop.y1 - region.crop.y0)];

  // ---------- the three passes ----------
  /** Which kind of mark a stroke is. Mixed: big slabs and sweeps block in, dry brush and sweeps model the middle,
   *  and the finest pass is knife edges and hatching on edges, impasto and dry brush on detail. */
  function pickKind(level, edge) {
    const style = params.strokes || "mixed";
    if (style !== "mixed") return SHAPE[style] ? style : "knife";
    const r = Math.random();
    if (level === 0) return r < 0.7 ? "knife" : "sweep";
    if (level === 1) return r < 0.4 ? "knife" : r < 0.7 ? "sweep" : "dry";
    if (edge) return r < 0.6 ? "knife" : "hatch";
    return r < 0.45 ? "impasto" : r < 0.75 ? "dry" : "sweep";
  }
  const put = (s, o) => studio[s.kind]({ ...s, ...o });

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /** Knife strokes for one pass: one per grid cell (finer passes only where the cover has detail). */
  function buildPass(level, band) {
    // the coarse pass is laid twice (offset) so it covers everything; finer passes once
    const across = COUNTS[layout][level], cell = region.w / across, rows = Math.ceil(region.h / cell), out = [];
    const reps = level === 0 ? 2 : 1;
    for (let r = 0; r < reps; r++) for (let j = 0; j < rows; j++) for (let i = 0; i < across; i++) {
      const cx = region.x + (i + 0.5 + r * 0.5 + rand(-0.3, 0.3)) * cell, cy = region.y + (j + 0.5 + r * 0.5 + rand(-0.3, 0.3)) * cell;
      if (band && (cy < band[0] || cy > band[1])) continue;
      const fx = (cx - region.x) / region.w, fy = (cy - region.y) / region.h, half = 0.5 * cell / region.w;
      const [ax, ay] = toCover(fx - half, fy - half * region.w / region.h), [bx, by] = toCover(fx + half, fy + half * region.w / region.h);
      const { color, dev } = cov.box(ax, ay, bx, by, level === 0 ? 4 : 3);
      if (level === 1 && dev < 5 && Math.random() < 0.55) continue;
      if (level === 2 && dev < 13) continue;
      const [gx0, gy0] = toCover(fx, fy), gr = cov.grad(gx0, gy0);
      // along edges where there are edges; elsewhere a lazy, mostly horizontal hand
      // one calm direction for the whole painting, bending along real edges in the cover
      const flow = flowAngle + (p.noise(fx * 1.6, fy * 1.6, 9) - 0.5) * 0.7;
      let a = flow;
      if (gr.mag > 22) {
        let e = Math.atan2(gr.gy, gr.gx) + Math.PI / 2;
        if (Math.cos(e - flow) < 0) e += Math.PI;  // keep strokes pointing the same general way
        const w = Math.min(1, (gr.mag - 22) / 40);
        a = Math.atan2(Math.sin(flow) * (1 - w) + Math.sin(e) * w, Math.cos(flow) * (1 - w) + Math.cos(e) * w);
      }
      const sizeK = [1, 0.95, 0.85][level], kind = pickKind(level, gr.mag > 30), [lk, wk] = SHAPE[kind];
      // sweeps bow the way the flow field is turning here, so neighbouring curves agree
      const bend = (p.noise(fx * 3, fy * 3, 4) - 0.5) * 0.8;
      out.push({ kind, x: cx, y: cy, a: a + rand(-0.08, 0.08), len: cell * rand(1.6, 2.4) * sizeK * lk, width: cell * rand(0.85, 1.1) * sizeK * wk,
        bend, color: B.shade(color, rand(-5, 5)), ridge: params.ridge === false ? 0 : 1, level });
    }
    return shuffle(out);
  }

  /** How much of each pass should be on the canvas at this point in the song. */
  function targets(progress) {
    if (params.detail === "fixed") { const L = +params.level || 2; return [1, L >= 2 ? 1 : 0, L >= 3 ? 1 : 0]; }
    const s = (t, a, b) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
    return [1, s(progress, 0.06, 0.5), s(progress, 0.45, 0.95)];
  }

  // ---------- painting ----------
  function paint(gradual, progress) {
    W = p.width; H = p.height;
    region = computeRegion();
    studio.clip = { x: region.x, y: region.y, w: region.w, h: region.h };
    studio.clear();
    flowAngle = rand(-0.35, 0.35);
    passes = [0, 1, 2].map((k) => buildPass(k));
    const t = targets(progress);
    if (!gradual) {
      g.clearRect(0, 0, W, H);
      underpaint();
      for (let k = 0; k < 3; k++) {
        shown[k] = Math.round(passes[k].length * t[k]);
        for (let i = 0; i < shown[k]; i++) put(passes[k][i]);
        studio.finish();
      }
    } else {
      // the new cover goes on over the old one: the large slabs first, spread over a few seconds
      const n = passes[0].length, spread = 7;
      passes[0].forEach((s, i) => put(s, { delay: (i / n) * spread + rand(0.4), duration: rand(0.7, 1.2) }));
      shown = [n, 0, 0];
      quietUntil = performance.now() + (spread + 1) * 1000 * studio.tempo;
    }
    painted = true;
  }

  /** A flat, blocky first layer of the cover (like a painter's blocking-in), so no background shows between strokes. */
  function underpaint() {
    if (!cov.image) return;
    const n = COUNTS[layout][0], c = document.createElement("canvas");
    c.width = n; c.height = Math.max(1, Math.round(n * region.h / region.w));
    const im = cov.image, iw = im.naturalWidth, ih = im.naturalHeight, cr = region.crop;
    c.getContext("2d").drawImage(im, cr.x0 * iw, cr.y0 * ih, (cr.x1 - cr.x0) * iw, (cr.y1 - cr.y0) * ih, 0, 0, c.width, c.height);
    g.save(); g.imageSmoothingEnabled = false;
    g.drawImage(c, region.x, region.y, region.w, region.h);
    g.restore();
  }

  /** Live: add finer strokes as the song plays, a few at a time so they appear one by one. */
  function grow() {
    if (performance.now() < quietUntil || !Wallpaper.ctx) return;
    const t = targets(Wallpaper.ctx.track.progress || 0);
    let budget = 3;
    for (let k = 1; k < 3 && budget > 0; k++) {
      const want = Math.round(passes[k].length * t[k]);
      while (shown[k] < want && budget-- > 0) put(passes[k][shown[k]++], { duration: rand(0.8, 1.4) });
    }
  }

  /** Each lyric line: a horizontal band is repainted with the next finer pass, left to right. */
  function refineBand() {
    const t = targets(Wallpaper.ctx ? Wallpaper.ctx.track.progress || 0 : 0);
    const level = t[2] > 0.5 ? 2 : t[1] > 0.5 ? 2 : 1;
    const bh = region.h * rand(0.08, 0.16), y0 = region.y + rand(0, region.h - bh);
    for (const s of buildPass(level, [y0, y0 + bh])) {
      put(s, { delay: ((s.x - region.x) / region.w) * 1.6, duration: rand(0.5, 0.9) });
    }
  }

  function prepare(ctx) {
    params = ctx.params || {};
    layout = document.documentElement.dataset.layout || "square";
    side = params.side || "left";
    document.documentElement.dataset.side = side;
    // keyed on the cover image, not the song: the next track off the same album keeps painting the same canvas
    const key = [ctx.track.coverKey || ctx.track.cover, layout, side, params.detail, params.level, params.ridge, params.strokes,
      innerWidth, innerHeight].join("|");
    if (key === paintKey) return null;
    const sameSize = paintKey.endsWith("|" + innerWidth + "|" + innerHeight);
    paintKey = key;
    return ready.then(async () => {
      const density = Wallpaper.live ? 1 : Math.min(2, devicePixelRatio || 1);
      if (p.pixelDensity() !== density) p.pixelDensity(density);
      if (p.width !== innerWidth || p.height !== innerHeight) p.resizeCanvas(innerWidth, innerHeight);
      g = p.drawingContext;
      cov = await B.cover(ctx.track.cover, 128);
      studio.tempo = 1 / Math.max(0.1, +params.speed || 0.7);
      // a still shows the painting at mid detail; the live layer starts from wherever the song is
      const progress = Wallpaper.live ? ctx.track.progress || 0 : Math.max(0.55, ctx.track.progress || 0);
      pending = { gradual: Wallpaper.live && painted && sameSize, progress };
      if (Wallpaper.live) setTimeout(flush, 0);
    });
  }

  function flush() {
    if (!pending) return;
    const { gradual, progress } = pending;
    pending = null;
    paint(gradual, progress);
    sync();
  }

  function sync() {
    if (!p) return;
    p.frameRate(Math.min(Wallpaper.fps || 30, 30));
    Wallpaper.live && !Wallpaper.paused ? p.loop() : p.noLoop();
  }

  function draw() {
    if (!painted || !Wallpaper.live || Wallpaper.paused) return;
    const ctx = Wallpaper.ctx;
    if (ctx && ctx.track.isPlaying) grow();
    studio.update(Math.min(p.deltaTime / 1000, 0.1));
  }

  Wallpaper.on("render", (ctx) => {
    const job = prepare(ctx);
    if (job && !Wallpaper.live) Wallpaper.hold(job);
    if (studio) { studio.tempo = 1 / Math.max(0.1, +ctx.params.speed || 0.7); sync(); }
  });
  Wallpaper.on("layout", () => { if (!Wallpaper.live) flush(); });
  Wallpaper.on("line", (ctx) => {
    if (!painted || !ctx.params.refine || !ctx.track.isPlaying || performance.now() < quietUntil) return;
    if ((ctx.lyrics.current || "").trim()) refineBand();
  });
  Wallpaper.on("pause", sync);
  Wallpaper.on("resume", sync);
})();
