/*
 * Brushwork: an oil painting made from the cover, with p5.js and the runtime's brush (/runtime/brush.js).
 *
 * - Still (the real wallpaper): the whole painting is laid down at once, before the snapshot.
 * - Live layer: on load the painting appears finished, then keeps being worked on, slowly. Each new lyric line adds
 *   a flourish (a star, a flower, an ink splash, a paisley). A new song is painted over the old one gradually.
 * - The text panel is the DOM (.panel); the sketch paints a ground behind it and keeps other strokes off it.
 */
(function () {
  const B = Brush, TAU = B.TAU, rand = B.rand, mix = B.mix, shade = B.shade;
  const pick = (a) => a[(Math.random() * a.length) | 0];

  let p, g, studio, W = 0, H = 0, u = 1;
  let cov = { at: () => [128, 128, 128] }, pal = null, style = "night", side = "left", panel = null;
  let painted = false, paintKey = "", pending = null, spawn = 0, sinceGround = 0;

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
  // Every style is composed with the text on the left; X() mirrors it when the text is on the right.
  const X = (f) => (side === "left" ? f : 1 - f) * W;
  /** The box around the text actually shown (title to last lyric), plus a margin. */
  function readPanel() {
    const els = [...document.querySelectorAll(".panel > *")].filter((e) => e.offsetParent && e.getBoundingClientRect().height > 0);
    const rs = els.map((e) => e.getBoundingClientRect()), m = u * 2;
    if (!rs.length) { panel = { x0: -1, x1: -1, y0: -1, y1: -1 }; return; }
    panel = { x0: Math.min(...rs.map((r) => r.left)) - m, x1: Math.max(...rs.map((r) => r.right)) + m,
              y0: Math.min(...rs.map((r) => r.top)) - m, y1: Math.max(...rs.map((r) => r.bottom)) + m };
  }
  const inPanel = (x, y, pad = 0) => x > panel.x0 - pad && x < panel.x1 + pad && y > panel.y0 - pad && y < panel.y1 + pad;
  /** A random point in [x0,x1]×[y0,y1] (fractions, before mirroring) that is clear of the text panel. */
  function spot(x0 = 0, x1 = 1, y0 = 0, y1 = 1, pad = 0) {
    for (let i = 0; i < 30; i++) {
      const x = X(rand(x0, x1)), y = rand(y0, y1) * H;
      if (!inPanel(x, y, pad)) return [x, y];
    }
    return [X(rand(.75, .95)), rand(y0, y1) * H];
  }

  function palette(ctx) {
    const c = ctx.colors || {}, p6 = (c.palette || []).map(B.rgb);
    while (p6.length < 6) p6.push(mix(p6[p6.length - 1] || [140, 120, 160], [255, 255, 255], .3));
    // a night ground: the darkest, coolest cover colour pushed toward black (the app's "deep" can be a warm red)
    const darkest = [...p6, B.rgb(c.deep || "#1c1030")].sort((a, b) => (B.lum(a) - (a[2] - a[0]) * .3) - (B.lum(b) - (b[2] - b[0]) * .3))[0];
    return {
      night: mix(darkest, [6, 6, 16], .72),
      p: p6, vibrant: B.rgb(c.vibrant || p6[0]), deep: B.rgb(c.deep || c.dark || "#1c1030"), dark: B.rgb(c.dark || "#120a1e"),
      light: B.rgb(c.light || "#f4ece0"), paper: B.rgb(c.paper || "#f5ece1"),
    };
  }
  /** Runs fn now (instant paint) or after `delay` seconds of painting time (gradual). */
  function later(delay, fn) { if (delay <= 0) fn(); else setTimeout(fn, delay * studio.tempo * 1000); }

  // ---------- the painted ground under the text ----------
  function ground(spread, color, alpha = .92) {
    const n = Math.round(((panel.x1 - panel.x0) * (panel.y1 - panel.y0)) / (u * u * 15));
    for (let i = 0; i < n; i++) {
      const y = rand(panel.y0, panel.y1), x = rand(panel.x0 - u * 4, panel.x1 - u * 4);
      studio.stroke({ x, y, a: rand(-.12, .12), turn: rand(-.01, .01), size: u * rand(4, 7.5), color: shade(color, rand(-8, 8)),
        len: 12, step: u * 1.1, dry: .35, alpha, jitter: 10, delay: spread ? spread * .55 + rand(spread * .45) : 0, duration: rand(1.6, 2.6) });
    }
  }

  // ================= styles =================
  const STYLES = {};

  // ---- Swirling Night (after Van Gogh): the cover is the moon ----
  STYLES.night = {
    bg: () => pal.night,
    groundColor: () => pal.night,
    setup() {
      const m = Math.min(W, H);
      this.moon = { x: X(.8), y: H * .26, r: m * .14 };
      this.vort = [{ x: X(.52), y: H * .3, r: u * 13, d: 1 }, { x: X(.67), y: H * .14, r: u * 9, d: -1 }, { x: this.moon.x, y: this.moon.y, r: u * 17, d: 1 }];
      this.cool = [...pal.p].sort((a, b) => (b[2] - b[0]) - (a[2] - a[0]));
    },
    horizon(x) { return H * (.7 + .05 * Math.sin(x / W * TAU * 1.2 + 1) + .025 * Math.sin(x / W * 19)); },
    cyp(x, y) { const top = H * .1, cx = X(.95) + Math.sin(y * .02) * u * .8; if (y < top) return false; return Math.abs(x - cx) < (y - top) / (H - top) * u * 6 + u; },
    field(x, y) {
      if (this.cyp(x, y)) return -Math.PI / 2 + Math.sin(y * .05 + x * .03) * .6;
      if (y > this.horizon(x)) return Math.sin(x * .008 + y * .03) * .35 + (p.noise(x * .004, y * .004) - .5) * .8;
      let vx = 1, vy = .15 + (p.noise(x * .003, y * .003) - .5) * .9;
      for (const v of this.vort) {
        const dx = x - v.x, dy = y - v.y, d = Math.hypot(dx, dy) + 1, w = 3.2 * Math.exp(-d / v.r);
        vx += (-dy / d) * v.d * w; vy += (dx / d) * v.d * w;
      }
      return Math.atan2(vy, vx);
    },
    color(x, y) {
      const c = this.cool;
      if (this.cyp(x, y)) return Math.random() < .15 ? shade(c[2], -10) : mix(pal.night, c[0], rand(.08, .35));
      if (y > this.horizon(x)) return Math.random() < .12 ? shade(pal.vibrant, -20) : mix(pick(c.slice(0, 4)), pal.deep, rand(.35, .65));
      const near = this.vort.some((v) => Math.hypot(x - v.x, y - v.y) < v.r * .9);
      if (Math.random() < (near ? .38 : .12)) return mix(pal.light, pick(pal.p), rand(0, .4));
      return mix(pick(c.slice(0, 3)), pal.night, rand(0, .45));
    },
    dash(size, len, delay, duration, avoid) {
      const x = rand(W), y = rand(H), m = this.moon;
      if (Math.hypot(x - m.x, y - m.y) < m.r || (avoid && inPanel(x, y))) return;
      studio.stroke({ x, y, size, color: this.color(x, y), len, step: size * .55, field: (a, b) => this.field(a, b), alpha: .92, dry: .35, jitter: 16, delay, duration });
    },
    moonDabs(n, spread) {
      const m = this.moon;
      for (let i = 0; i < n; i++) {
        const a = rand(TAU), rr = Math.sqrt(Math.random()) * m.r * .98, x = m.x + Math.cos(a) * rr, y = m.y + Math.sin(a) * rr;
        studio.stroke({ x, y, a: a + Math.PI / 2, turn: .15, size: u * rand(.6, 1.1), color: cov.at((x - m.x) / (2 * m.r) + .5, (y - m.y) / (2 * m.r) + .5),
          len: 4, step: u * .4, dry: .2, jitter: 10, delay: rand(spread), duration: rand(.5, 1) });
      }
    },
    halo(cx, cy, r0, rings, delay) {
      for (let k = 0; k < rings; k++) {
        const r = r0 * (1 + k * .22), n = Math.round(r / (u * .9));
        for (let i = 0; i < n; i++) {
          const a = i / n * TAU + rand(.1);
          studio.stroke({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, a: a + Math.PI / 2, turn: (u * .9) / r * 1.1, size: u * rand(.6, 1),
            color: k % 2 ? shade(pal.vibrant, 40) : pal.light, len: 3, step: u * .5, dry: .2, alpha: .9, delay: delay + k * .45 + i / n * .5, duration: .7 });
        }
      }
    },
    compose(spread) {
      const n = Math.round(W * H / (u * u) * .62);
      for (let i = 0; i < n; i++) this.dash(u * rand(.8, 1.7), (rand(6, 13)) | 0, rand(spread), rand(1.2, 2.4));
      this.moonDabs(900, spread * .8);
      const m = this.moon;
      this.halo(m.x, m.y, m.r * 1.08, 4, spread * .9);
      for (let i = 0; i < 7; i++) {
        const [x, y] = spot(.3, .97, .04, .5, u * 3);
        if (Math.hypot(x - m.x, y - m.y) > m.r * 1.8) this.halo(x, y, u * rand(1, 1.8), 3, rand(spread));
      }
    },
    ambient(dt) {
      spawn += dt * 7;
      while (spawn >= 1) { spawn--; this.dash(u * rand(.7, 1.4), (rand(5, 10)) | 0, 0, rand(1.4, 2.6), true); }
      if (Math.random() < dt * .8) this.moonDabs(6, 1);
    },
    bloom() {
      const m = this.moon; let x, y, n = 0;
      do { [x, y] = spot(.3, .97, .04, .5, u * 4); n++; } while (Math.hypot(x - m.x, y - m.y) < m.r * 1.8 && n < 20);
      for (let i = 0; i < 6; i++) studio.dab(x + rand(-1, 1) * u * .6, y + rand(-1, 1) * u * .6, u * 1.3, i % 2 ? pal.light : shade(pal.vibrant, 50), { delay: i * .08, duration: .5 });
      this.halo(x, y, u * rand(1.6, 2.4), 4, .3);
    },
  };

  // ---- Impasto Jungle (after Rousseau): the cover smeared into oil, leaves and flowers over it ----
  STYLES.jungle = {
    bg: () => pal.deep,
    groundColor: () => mix(pal.deep, pal.dark, .4),
    setup() { this.seed = rand(100); },
    field(x, y) { return p.noise(x * .0028, y * .0028, this.seed) * TAU * 2.2; },
    under(size, len, alpha, delay, duration, avoid) {
      const x = rand(W), y = rand(H);
      if (avoid && inPanel(x, y)) return;
      studio.stroke({ x, y, size, color: cov.at(x / W, y / H), len, step: size * .32, field: (a, b) => this.field(a, b), alpha, dry: .5, jitter: 28, delay, duration });
    },
    leaf(x, y, a, len, col, delay) {
      const steps = 16, step = len / steps, bend = rand(-.05, .05), size = u * rand(2.6, 3.6), pts = [];
      let cx = x, cy = y, ca = a;
      for (let i = 0; i <= steps; i++) { pts.push([cx, cy, ca]); cx += Math.cos(ca) * step; cy += Math.sin(ca) * step; ca += bend; }
      studio.stroke({ x, y, a, turn: bend, size: size * .22, color: shade(col, -45), len: steps, step, dry: .1, alpha: .95, delay, duration: 1.8 });
      for (let i = 1; i < steps; i++) {
        const [px, py, pa] = pts[i], fl = len * .5 * Math.sin(Math.PI * (i / steps) * .95 + .1) + size * .4;
        for (const sd of [-1, 1]) {
          studio.stroke({ x: px, y: py, a: pa + sd * rand(.75, 1.15), turn: -sd * .055, size: size * rand(.38, .6), color: shade(mix(col, pick(pal.p), .15), rand(-28, 22)),
            len: 9, step: fl / 9, dry: .55, alpha: .92, delay: delay + .3 + i * .11 + (sd > 0 ? .05 : 0), duration: rand(.8, 1.2) });
        }
      }
    },
    edgeLeaf(delay) {
      const pos = pick([[rand(W), H + u * 2], [rand(W), -u * 2], [X(1) + (side === "left" ? u * 2 : -u * 2), rand(H)]]);
      const a = Math.atan2(H * rand(.3, .7) - pos[1], X(rand(.55, .8)) - pos[0]) + rand(-.6, .6);
      this.leaf(pos[0], pos[1], a, u * rand(16, 30), mix(pick(pal.p), pal.deep, rand(.35, .6)), delay);
    },
    flower(x, y, r, delay) {
      const k = (rand(6, 11)) | 0, a0 = rand(TAU), c1 = shade(pal.vibrant, 30), c2 = shade(pick(pal.p.filter((c) => c !== pal.vibrant)), 25);
      for (let i = 0; i < k; i++) { const a = a0 + i * TAU / k; studio.stroke({ x: x + Math.cos(a) * r * .12, y: y + Math.sin(a) * r * .12, a, turn: rand(-.04, .04), size: r * .5, color: c1, len: 8, step: r * .13, dry: .35, alpha: .95, delay: delay + i * .12, duration: .9 }); }
      for (let i = 0; i < k; i++) { const a = a0 + (i + .5) * TAU / k; studio.stroke({ x, y, a, turn: rand(-.05, .05), size: r * .32, color: c2, len: 7, step: r * .08, dry: .3, delay: delay + 1 + i * .08, duration: .7 }); }
      for (let i = 0; i < 7; i++) studio.dab(x + rand(-r, r) * .12, y + rand(-r, r) * .12, r * .14, i % 2 ? pal.light : shade(pal.deep, 40), { delay: delay + 1.8 + i * .07 });
    },
    compose(spread) {
      const n = Math.round(W * H / (u * u) * .11);
      for (let i = 0; i < n; i++) this.under(u * rand(3.5, 8), 14, .9, rand(spread * .6), rand(2, 3.2), false);
      for (let i = 0; i < 12; i++) this.edgeLeaf(spread * .3 + rand(spread * .6));
      for (let i = 0; i < 6; i++) { const [x, y] = spot(.45, .95, .1, .9, u * 6); this.flower(x, y, u * rand(5, 9), spread * .5 + rand(spread * .5)); }
    },
    ambient(dt) {
      spawn += dt * 1.6;
      while (spawn >= 1) { spawn--; this.under(u * rand(1.2, 3), 10, .55, 0, rand(1.8, 2.8), true); }
      if (Math.random() < dt / 14) this.edgeLeaf(0);
    },
    bloom() {
      const [x, y] = spot(.45, .95, .1, .9, u * 6);
      this.flower(x, y, u * rand(5, 10), 0);
      for (let i = 0; i < 6; i++) { const [px, py] = spot(.4, 1, 0, 1); studio.dab(px, py, u * .5, pal.light, { delay: .4 + i * .25 }); }
    },
  };

  // ---- Ink, Wave & Gold (after Hokusai): dry brush on paper, the cover inside an ensō ----
  STYLES.ink = {
    bg: () => pal.paper,
    groundColor: () => pal.paper,
    setup() {
      this.inkC = mix(pal.deep, [8, 8, 12], .55);
      this.gold = mix([...pal.p].sort((a, b) => (b[0] + b[1] - 2 * b[2]) - (a[0] + a[1] - 2 * a[2]))[0], [214, 172, 72], .55);
      this.red = mix(pal.vibrant, [196, 38, 36], .6);
      this.blues = [...pal.p].sort((a, b) => (b[2] - b[0]) - (a[2] - a[0]));
    },
    flakes(n, spread) {
      for (let i = 0; i < n; i++) later(rand(spread), () => {
        const [x, y] = spot(0, 1, 0, 1), s = u * rand(.5, 2.2);
        g.globalAlpha = rand(.6, .95); g.fillStyle = B.css(shade(this.gold, rand(-25, 30)));
        g.beginPath(); for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + rand(.5); g.lineTo(x + Math.cos(a) * s * rand(.5, 1.2), y + Math.sin(a) * s * rand(.5, 1.2)); } g.fill(); g.globalAlpha = 1;
      });
    },
    wave(spread) {
      for (let i = 0; i < 110; i++) {
        const y = H * rand(.74, 1.02), x = rand(-u * 5, W);
        studio.stroke({ x, y, a: rand(-.25, .1), turn: rand(-.02, .02), size: u * rand(1.2, 2.6), color: mix(pick(this.blues.slice(0, 3)), this.inkC, rand(0, .4)), len: 14, step: u * 1.2, dry: .7, alpha: .85, delay: rand(spread * .5), duration: rand(1.6, 2.6) });
      }
      [[.62, .64, 1.25], [.8, .7, .95], [.93, .78, .7], [.5, .8, .7]].forEach(([fx, fy, sc], ci) => {
        const cx = X(fx), cy = H * fy, R = u * 9 * sc, dir = side === "left" ? 1 : -1, d0 = spread * .3 + ci * .6;
        for (let k = 0; k < 6; k++) studio.stroke({ x: cx - dir * (R - k * u * .9), y: cy + R * .9, a: -Math.PI / 2 + dir * .2, turn: dir * (.13 + k * .012), size: u * (1.6 - k * .12) * sc,
          color: k % 3 === 2 ? pal.light : mix(this.blues[k % 2], this.inkC, k * .08), len: 36, step: u * .9 * sc, decay: .975, dry: .5, alpha: .92, delay: d0 + k * .2, duration: 2.4 });
        for (let k = 0; k < 9; k++) { const a = -Math.PI / 2 - dir * (Math.PI * .4 - k * .22); studio.stroke({ x: cx + Math.cos(a) * R * .95, y: cy + R * .1 + Math.sin(a) * R * .95, a: a - dir * .6, turn: dir * .25, size: u * .55 * sc, color: pal.paper, len: 5, step: u * .55 * sc, dry: .3, delay: d0 + 1.8 + k * .08, duration: .5 }); }
      });
    },
    enso(spread) {
      const cx = X(.7), cy = H * .4, R = H * .25, n = 140;
      for (let i = 0; i < 1100; i++) { const a = rand(TAU), rr = Math.sqrt(Math.random()) * R * .8, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; studio.dab(x, y, u * rand(.5, .9), cov.at((x - cx) / (1.6 * R) + .5, (y - cy) / (1.6 * R) + .5), { alpha: .95, delay: spread * .2 + rand(spread * .5) }); }
      const a0 = rand(TAU);
      studio.stroke({ x: cx + Math.cos(a0) * R, y: cy + Math.sin(a0) * R, a: a0 + Math.PI / 2, turn: TAU * .93 / n, size: u * 3.4, color: this.inkC, len: n, step: TAU * R * .93 / n, dry: .95, alpha: .95, jitter: 8, delay: spread * .75, duration: 3.2 });
    },
    branch(x, y, a, len, size, depth, delay) {
      const steps = 12, step = len / steps, pts = []; let cx = x, cy = y, ca = a; const tw = rand(-.06, .06);
      for (let i = 0; i <= steps; i++) { pts.push([cx, cy, ca]); cx += Math.cos(ca) * step; cy += Math.sin(ca) * step; ca += tw + rand(-.08, .08); }
      studio.stroke({ x, y, a, field: (px, py, s) => pts[Math.min(s.t, steps)][2], size, color: this.inkC, len: steps, step, dry: .75, alpha: .95, jitter: 10, delay, duration: 1.6 });
      const blossom = mix(pick(pal.p), [255, 196, 214], .55);
      if (depth > 0) for (let i = 4; i < steps; i += 3) { const [px, py, pa] = pts[i]; this.branch(px, py, pa + (Math.random() < .5 ? -1 : 1) * rand(.4, .9), len * rand(.35, .55), size * .55, depth - 1, delay + i * .12 + .2); }
      for (let i = 3; i <= steps; i += 2) {
        const [px, py] = pts[i]; if (Math.random() < .5) continue;
        for (let k = 0; k < 5; k++) studio.stroke({ x: px, y: py, a: k / 5 * TAU, size: u * .9, color: shade(blossom, rand(-15, 15)), len: 3, step: u * .35, dry: .2, delay: delay + 1.6 + i * .1 + k * .05, duration: .4 });
        studio.dab(px, py, u * .45, this.gold, { delay: delay + 2.2 + i * .1 });
      }
    },
    splash(x, y, s, col) {
      for (let i = 0; i < 10; i++) studio.dab(x + rand(-1, 1) * s * .4, y + rand(-1, 1) * s * .4, s * rand(.5, .9), col, { alpha: .95, delay: i * .04 });
      later(.45, () => {
        g.fillStyle = B.css(col);
        for (let i = 0; i < 70; i++) { const a = rand(TAU), d = s * (.6 + Math.pow(Math.random(), 2) * 3.2), r = Math.max(1, s * .09 * (1 - d / (s * 4)) * rand(.5, 1.5)); if (inPanel(x + Math.cos(a) * d, y + Math.sin(a) * d)) continue; g.globalAlpha = rand(.7, 1); g.beginPath(); g.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 1.4, r, a, 0, TAU); g.fill(); }
        g.globalAlpha = 1;
      });
      for (let i = 0; i < 3; i++) studio.stroke({ x: x + rand(-s, s) * .4, y: y + s * .3, a: Math.PI / 2 + rand(-.05, .05), size: s * .12, color: col, len: (rand(8, 20)) | 0, step: s * .12, dry: .2, alpha: .9, delay: .6, duration: rand(1.5, 2.5), ease: "out" });
    },
    seal() {
      const s = u * 4.2, x = X(.94) - (side === "left" ? s : 0), y = H * .82;
      g.globalAlpha = .9; g.fillStyle = B.css(this.red); g.fillRect(x, y, s, s * 1.25);
      g.strokeStyle = B.css(pal.paper); g.lineWidth = u * .35; g.lineCap = "square";
      g.beginPath(); g.moveTo(x + s * .25, y + s * .2); g.lineTo(x + s * .25, y + s * 1.05); g.moveTo(x + s * .25, y + s * .6); g.lineTo(x + s * .75, y + s * .45); g.moveTo(x + s * .6, y + s * .8); g.lineTo(x + s * .78, y + s * 1.05); g.stroke();
      g.globalAlpha = 1; g.lineCap = "round";
    },
    compose(spread) {
      if (spread) {
        // wash the old picture back toward paper before the new one goes on
        for (let i = 0; i < 140; i++) studio.stroke({ x: rand(-u * 6, W), y: rand(H), a: rand(-.1, .1), size: u * rand(5, 9), color: pal.paper, len: 16, step: u * 1.4, dry: .3, alpha: .55, delay: rand(spread * .35), duration: rand(1.8, 2.8) });
      } else {
        g.fillStyle = B.css(pal.paper); g.fillRect(0, 0, W, H);
        for (let i = 0; i < W * H / 900; i++) { g.globalAlpha = rand(.03, .09); g.fillStyle = B.css(shade(pal.paper, -60)); g.fillRect(rand(W), rand(H), rand(1, 3), rand(1, 3)); }
        g.globalAlpha = 1;
      }
      this.wave(spread); this.enso(spread);
      this.branch(X(1.02), H * .02, side === "left" ? Math.PI * .8 : Math.PI * .2, W * .3, u * 1.6, 2, spread * .45);
      this.flakes(40, spread); later(spread * .95, () => this.seal());
    },
    ambient(dt) {
      if (Math.random() < dt * .6) { const x = rand(W), y = H * rand(.8, 1); if (!inPanel(x, y)) studio.stroke({ x, y, a: rand(-.2, .1), size: u * rand(.8, 1.6), color: mix(pick(pal.p), this.inkC, .5), len: 10, step: u, dry: .8, alpha: .5, duration: rand(2, 3) }); }
    },
    bloom() { const [x, y] = spot(.45, .95, .1, .75, u * 8); this.splash(x, y, u * rand(1.8, 3.2), Math.random() < .7 ? this.inkC : this.red); this.flakes(6, 2); },
  };

  // ---- Paisley Tapestry (1970s psychedelia): a mandala grows out of the cover ----
  STYLES.tapestry = {
    bg: () => pal.night,
    groundColor: () => pal.night,
    setup() { this.rot = (rand(6)) | 0; this.ring = 0; this.c = { x: X(.68), y: H * .5, r0: H * .12 }; this.clock = 0; this.ribbonClock = 0; },
    disc(spread) {
      const { x: cx, y: cy, r0 } = this.c;
      for (let i = 0; i < 800; i++) { const a = rand(TAU), rr = Math.sqrt(Math.random()) * r0, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; studio.dab(x, y, u * rand(.5, .85), cov.at((x - cx) / (2 * r0) + .5, (y - cy) / (2 * r0) + .5), { alpha: .95, delay: rand(spread) }); }
    },
    radius(i) { return this.c.r0 * Math.pow(1.3, i) + u * i * .8; },
    paintRing(i, delay, over) {
      const { x: cx, y: cy } = this.c, r = this.radius(i), band = this.radius(i + 1) - r;
      const col = pal.p[(i + this.rot) % 6], alt = pal.p[(i + this.rot + 3) % 6], type = (i + this.rot) % 4;
      const n = Math.round((TAU * r) / (u * (type === 1 ? 1.6 : 2.6)));
      for (let k = 0; k < n; k++) {
        const a = k / n * TAU + this.rot * .3, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, d = delay + (k / n) * over;
        if (inPanel(x, y)) continue;
        if (type === 0) studio.stroke({ x, y, a, turn: .05, size: u * 1.5, color: shade(col, 20), len: 6, step: band * .16, dry: .4, delay: d, duration: .9 });
        else if (type === 1) studio.dab(cx + Math.cos(a) * (r + band * .5), cy + Math.sin(a) * (r + band * .5), u * 1.1, k % 2 ? pal.light : col, { delay: d });
        else if (type === 2) for (const sd of [-1, 1]) studio.stroke({ x, y, a: a + sd * .55, size: u * .9, color: k % 2 ? col : alt, len: 4, step: band * .22, dry: .3, delay: d, duration: .6 });
        else studio.stroke({ x: cx + Math.cos(a) * (r + band * .5), y: cy + Math.sin(a) * (r + band * .5), a: a + Math.PI / 2, turn: (TAU / n) * .9, size: u * 1.2, color: k % 3 ? col : pal.light, len: 3, step: (TAU * (r + band * .5) / n) * .4, dry: .2, delay: d, duration: .5 });
      }
    },
    ribbon(delay) {
      const seed = rand(100);
      studio.stroke({ x: rand(W), y: rand(H), size: u * rand(1.4, 2.6), color: mix(pick(pal.p), pal.light, rand(.1, .5)), len: 70, step: u * .9, alpha: .7, dry: .4, delay, duration: rand(5, 8), ease: "inOut",
        field: (x, y) => p.noise(x * .0022, y * .0022, seed) * TAU * 2 });
    },
    paisley(x, y, s, a, delay) {
      const c1 = pick(pal.p), c3 = pick(pal.p);
      studio.stroke({ x, y, a, turn: .2, size: s * .28, color: c1, len: 40, step: s * .16, decay: .955, dry: .2, alpha: .95, delay, duration: 2.4 });
      studio.stroke({ x: x + Math.cos(a + Math.PI / 2) * s * .25, y: y + Math.sin(a + Math.PI / 2) * s * .25, a, turn: .23, size: s * .1, color: pal.light, len: 34, step: s * .12, decay: .95, dry: .2, delay: delay + .8, duration: 2 });
      for (let k = 0; k < 16; k++) { const b = a - Math.PI / 2 + k * .3; studio.dab(x + Math.cos(a) * s * .55 + Math.cos(b) * s * .85, y + Math.sin(a) * s * .55 + Math.sin(b) * s * .85, s * .12, k % 2 ? c3 : pal.light, { delay: delay + 2 + k * .07 }); }
    },
    compose(spread) {
      for (let i = 0; i < 26; i++) this.ribbon(rand(spread * .4));
      this.disc(spread * .4);
      for (let i = 0; i < 6; i++) this.paintRing(i, spread * .3 + i * spread * .1, spread * .1);
      this.ring = 6;
      for (let i = 0; i < 5; i++) { const [x, y] = spot(.4, 1, 0, 1, u * 5); this.paisley(x, y, u * rand(4, 7), rand(TAU), spread * .5 + rand(spread * .5)); }
    },
    ambient(dt) {
      this.clock += dt; this.ribbonClock += dt;
      if (this.clock > 6) {
        this.clock = 0;
        if (this.radius(this.ring) > Math.hypot(W, H) * .6) { this.ring = 0; this.rot = (this.rot + 1) % 6; this.disc(3); }
        else this.paintRing(this.ring++, 0, 4);
      }
      if (this.ribbonClock > 10) { this.ribbonClock = 0; this.ribbon(0); }
    },
    bloom() { const [x, y] = spot(.4, 1, 0, 1, u * 6); this.paisley(x, y, u * rand(4, 7.5), rand(TAU), 0); },
  };

  // ================= painting =================
  function paint(gradual) {
    const s = STYLES[style] || STYLES.night;
    W = p.width; H = p.height; u = Math.min(W / 100, H / 62.5);
    readPanel();
    studio.clear(); spawn = 0;
    s.setup();
    if (!gradual) {
      g.globalAlpha = 1; g.fillStyle = B.css(s.bg()); g.fillRect(0, 0, W, H);
      s.compose(0);
      studio.finish();
      ground(0, s.groundColor(), style === "ink" ? .55 : .5);
      studio.finish();
    } else {
      s.compose(22);
      ground(22, s.groundColor(), style === "ink" ? .55 : .5);
    }
    painted = true;
  }

  function prepare(ctx) {
    style = ctx.params.style || "night";
    side = ctx.params.side || "left";
    document.documentElement.dataset.style = style;
    document.documentElement.dataset.side = side;
    const key = [ctx.track.id, ctx.track.cover, style, side, innerWidth, innerHeight].join("|");
    if (key === paintKey) return null;
    const newSize = !paintKey.endsWith([innerWidth, innerHeight].join("|"));
    paintKey = key;
    return ready.then(async () => {
      // the live layer paints at 1x to stay light; a still is one frame, so it gets the screen's full resolution
      const density = Wallpaper.live ? 1 : Math.min(2, devicePixelRatio || 1);
      if (p.pixelDensity() !== density) p.pixelDensity(density);
      if (p.width !== innerWidth || p.height !== innerHeight) p.resizeCanvas(innerWidth, innerHeight);
      g = p.drawingContext;
      cov = await B.cover(ctx.track.cover);
      pal = palette(ctx);
      studio.tempo = 1 / Math.max(.1, +ctx.params.speed || .6);
      pending = { gradual: Wallpaper.live && painted && !newSize };
      // stills paint in the layout hook (after the text is laid out, before the snapshot); the live layer has
      // already laid out by the time the cover is in
      if (Wallpaper.live) setTimeout(flush, 0);
    });
  }

  function flush() {
    if (!pending) return;
    const { gradual } = pending;
    pending = null;
    paint(gradual);
    sync();
  }

  function sync() {
    if (!p) return;
    const on = Wallpaper.live && !Wallpaper.paused;
    p.frameRate(Math.min(Wallpaper.fps || 30, 30));
    on ? p.loop() : p.noLoop();
  }

  function draw() {
    if (!painted || !Wallpaper.live || Wallpaper.paused) return;
    const dt = Math.min(p.deltaTime / 1000, .1), ctx = Wallpaper.ctx;
    if (ctx && ctx.track.isPlaying) {
      (STYLES[style] || STYLES.night).ambient(dt);
      // keep the panel under the text clean: a fresh pass of ground every so often
      if ((sinceGround += dt) > 5) {
        sinceGround = 0;
        const s = STYLES[style] || STYLES.night;
        for (let i = 0; i < 2; i++) studio.stroke({ x: rand(panel.x0 - u * 4, panel.x1 - u * 6), y: rand(panel.y0, panel.y1), a: rand(-.1, .1), size: u * rand(4, 7), color: s.groundColor(), len: 12, step: u * 1.1, dry: .4, alpha: .18, duration: 3 });
      }
    }
    studio.update(dt);
  }

  Wallpaper.on("render", (ctx) => {
    const job = prepare(ctx);
    if (job && !Wallpaper.live) Wallpaper.hold(job);  // the still waits for its painting
    if (p) { studio.tempo = 1 / Math.max(.1, +ctx.params.speed || .6); sync(); }
  });
  Wallpaper.on("layout", () => { if (!Wallpaper.live) flush(); });
  Wallpaper.on("line", (ctx) => {
    if (!painted || !ctx.params.bloom || !ctx.track.isPlaying || !(ctx.lyrics.current || "").trim()) return;
    (STYLES[style] || STYLES.night).bloom();
  });
  Wallpaper.on("pause", sync);
  Wallpaper.on("resume", sync);
})();
