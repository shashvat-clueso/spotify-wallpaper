/*
 * Painterly brush strokes for canvas templates (works with the bundled p5: /runtime/vendor/p5.min.js).
 *
 *   const studio = Brush.studio(p);                     // p = a p5 instance (or anything with drawingContext)
 *   studio.stroke({ x, y, a, size, color, len, ... });  // queue a stroke; it paints itself over time
 *   studio.update(dt);                                  // advance every stroke by dt seconds (call from draw)
 *   studio.finish();                                    // paint everything queued right now (for stills)
 *   studio.knife / sweep / impasto / hatch / dry({ x, y, a, len, width, color })  // other kinds of mark, see below
 *   const cover = await Brush.cover(ctx.track.cover);   // cover.at(fx, fy) → [r, g, b] from the album art
 *   studio.onDone = (st) => …;                          // optional: called as each stroke finishes in update()
 *   Brush.LIGHT                                         // the light direction (radians, upper left) ridges use
 *
 * A stroke is a row of bristles dragged along a path. Each bristle has its own tint, width and amount of paint,
 * so strokes streak, run dry near the end and swell with "pressure" in the middle. Strokes move with an ease-in-out
 * curve over their `duration`, so the hand starts slowly, sweeps, and settles, the same at any frame rate.
 */
(function () {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));

  const ease = {
    linear: (t) => t,
    inOut: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t * t,
    // a brush hand: hesitates at the start, sweeps through the middle, slows into the lift
    hand: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  };

  function rgb(c) {
    if (Array.isArray(c)) return c;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "").trim());
    if (!m) return [128, 128, 128];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const mix = (a, b, t) => { a = rgb(a); b = rgb(b); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
  const shade = (c, d) => rgb(c).map((v) => clamp(v + d, 0, 255));
  const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const lum = (c) => { c = rgb(c); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const sat = (c) => { c = rgb(c); const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; };

  class Stroke {
    constructor(o, tempo, owner) {
      this.owner = owner; this.free = !!o.free; this.ownMask = o.mask || null;
      this.x = o.x; this.y = o.y; this.a = o.a ?? rand(TAU); this.size = Math.max(0.5, o.size || 8);
      this.life = Math.max(1, Math.round(o.len || 12));
      this.step = o.step ?? this.size * 0.4; this.field = o.field; this.turn = o.turn || 0; this.decay = o.decay || 1;
      this.alpha = o.alpha ?? 0.85; this.dry = o.dry ?? 0.5; this.t = 0; this.prev = null;
      this.duration = Math.max(0.05, (o.duration ?? clamp(this.life * 0.07, 0.5, 2.6)) * tempo);
      this.wait = Math.max(0, (o.delay || 0) * tempo); this.clock = 0;
      this.ease = typeof o.ease === "function" ? o.ease : ease[o.ease || "hand"];
      const col = rgb(o.color), n = clamp(Math.round(this.size / 2.6), 3, 16), j = o.jitter ?? 22;
      this.br = [];
      for (let i = 0; i < n; i++) {
        const c = shade(col.map((v) => v + rand(-j * 0.4, j * 0.4)), rand(-j, j));
        this.br.push({
          o: (i / (n - 1) - 0.5) * this.size + rand(-1, 1) * this.size * 0.07,
          w: Math.max(0.7, (this.size / n) * rand(0.9, 2.3)), cs: css(c), a: rand(0.45, 1), d: Math.random(),
        });
      }
    }
    /** One segment of paint. */
    paint(g) {
      if (this.field) this.a = this.field(this.x, this.y, this); else this.a += this.turn;
      const nx = this.x + Math.cos(this.a) * this.step, ny = this.y + Math.sin(this.a) * this.step;
      // the brush lifts where the template keeps space clear (studio.mask), unless the stroke is `free`
      const mask = this.ownMask || (!this.free && this.owner && this.owner.mask);
      if (mask && mask(nx, ny)) { this.t = this.life; return; }
      const k = (this.t + 1) / this.life;
      const press = 0.25 + 0.75 * Math.pow(Math.sin(Math.PI * Math.min(k * 0.92 + 0.08, 1)), 0.45);
      const px = -Math.sin(this.a), py = Math.cos(this.a);
      const pr = this.prev || { x: this.x, y: this.y, px, py, press: press * 0.4 };
      for (const b of this.br) {
        if (b.d < this.dry * k * k) continue;  // bristles run out of paint toward the end
        g.globalAlpha = this.alpha * b.a * (0.45 + 0.55 * (1 - k));
        g.strokeStyle = b.cs;
        g.lineWidth = b.w * (0.45 + 0.55 * press);
        g.beginPath();
        g.moveTo(pr.x + pr.px * b.o * pr.press, pr.y + pr.py * b.o * pr.press);
        g.lineTo(nx + px * b.o * press, ny + py * b.o * press);
        g.stroke();
      }
      this.prev = { x: nx, y: ny, px, py, press };
      this.x = nx; this.y = ny; this.t++; this.step *= this.decay;
    }
    /** Advance by dt seconds; returns false once the stroke is finished. */
    advance(g, dt) {
      if (this.wait > 0) { this.wait -= dt; if (this.wait > 0) return true; dt = -this.wait; }
      this.clock += dt;
      const target = Math.round(this.ease(clamp(this.clock / this.duration, 0, 1)) * this.life);
      while (this.t < target) this.paint(g);
      return this.t < this.life;
    }
    finish(g) { while (this.t < this.life) this.paint(g); }
  }

  /** A palette-knife / flat-brush stroke: one solid colour, crisp edges, a slanted start, a tapered end, and a thin
   *  light ridge on one edge and a dark one on the other, so it reads as a sharp slab of paint. */
  class Knife {
    constructor(o, tempo, owner) {
      this.owner = owner; this.free = !!o.free;
      this.x = o.x; this.y = o.y; this.a = o.a ?? 0; this.len = o.len || 20; this.w = o.width || 8;
      this.col = rgb(o.color); this.alpha = o.alpha ?? 1; this.ridge = o.ridge ?? 1; this.taper = o.taper ?? 0.7;
      this.skew = (o.skew ?? rand(-0.35, 0.35)) * this.w;
      this.duration = Math.max(0.05, (o.duration ?? 0.6) * tempo); this.wait = Math.max(0, (o.delay || 0) * tempo); this.clock = 0;
      this.ease = typeof o.ease === "function" ? o.ease : ease[o.ease || "hand"]; this.k = 0; this.wait0 = this.wait;
    }
    poly(k) {
      const dx = Math.cos(this.a), dy = Math.sin(this.a), nx = -dy, ny = dx, h0 = this.w / 2, h1 = (this.w * (1 - (1 - this.taper) * k)) / 2;
      const sx = this.x - dx * this.len / 2, sy = this.y - dy * this.len / 2, L = this.len * k, ex = sx + dx * L, ey = sy + dy * L, sk = this.skew;
      return [[sx + nx * h0 + dx * sk, sy + ny * h0 + dy * sk], [ex + nx * h1, ey + ny * h1], [ex + dx * h1 * 0.5, ey + dy * h1 * 0.5],
              [ex - nx * h1, ey - ny * h1], [sx - nx * h0 - dx * sk, sy - ny * h0 - dy * sk]];
    }
    draw(g, k, final) {
      const pts = this.poly(Math.max(0.02, k));
      g.globalAlpha = this.alpha; g.fillStyle = css(this.col);
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
      if (!final || !this.ridge) return;
      const lw = Math.max(0.8, this.w * 0.07);
      g.lineWidth = lw; g.lineCap = "butt";
      g.globalAlpha = 0.55 * this.ridge; g.strokeStyle = css(shade(this.col, 34));
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]); g.stroke();
      g.globalAlpha = 0.45 * this.ridge; g.strokeStyle = css(shade(this.col, -38));
      g.beginPath(); g.moveTo(pts[4][0], pts[4][1]); g.lineTo(pts[3][0], pts[3][1]); g.stroke();
      // two drag marks through the body
      g.globalAlpha = 0.35 * this.ridge; g.lineWidth = Math.max(0.6, this.w * 0.04);
      for (const f of [0.3, 0.68]) {
        const ax = pts[0][0] + (pts[4][0] - pts[0][0]) * f, ay = pts[0][1] + (pts[4][1] - pts[0][1]) * f;
        const bx = pts[1][0] + (pts[3][0] - pts[1][0]) * f, by = pts[1][1] + (pts[3][1] - pts[1][1]) * f;
        g.strokeStyle = css(shade(this.col, f < 0.5 ? 14 : -14));
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      }
      g.lineCap = "round";
    }
    advance(g, dt) {
      if (this.wait > 0) { this.wait -= dt; if (this.wait > 0) return true; dt = -this.wait; }
      this.clock += dt;
      this.k = this.ease(clamp(this.clock / this.duration, 0, 1));
      const done = this.clock >= this.duration;
      this.draw(g, this.k, done);
      return !done;
    }
    finish(g) { this.draw(g, 1, true); }
  }

  // light falls from the upper left on every raised stroke, so ridges and impasto agree with each other
  const LIGHT = -2.3;

  /** Shared timing for the shape strokes below: wait for `delay`, then run `draw(g, k, done)` with an eased k. */
  class Timed {
    constructor(o, tempo, owner) {
      this.owner = owner; this.free = !!o.free;
      this.x = o.x; this.y = o.y; this.a = o.a ?? 0; this.len = o.len || 20; this.w = o.width || 8;
      this.col = rgb(o.color); this.alpha = o.alpha ?? 1; this.ridge = o.ridge ?? 1;
      this.duration = Math.max(0.05, (o.duration ?? 0.6) * tempo); this.wait = Math.max(0, (o.delay || 0) * tempo); this.clock = 0;
      this.ease = typeof o.ease === "function" ? o.ease : ease[o.ease || "hand"];
    }
    advance(g, dt) {
      if (this.wait > 0) { this.wait -= dt; if (this.wait > 0) return true; dt = -this.wait; }
      this.clock += dt;
      const done = this.clock >= this.duration;
      this.draw(g, this.ease(clamp(this.clock / this.duration, 0, 1)), done);
      return !done;
    }
    finish(g) { this.draw(g, 1, true); }
  }

  /** A curved flat-brush sweep: a band of paint along an arc (`bend` = how far the middle bows out, as a fraction
   *  of the length), full width at the start and tapering toward the lift, with ridges along both edges. */
  class Sweep extends Timed {
    constructor(o, tempo, owner) {
      super(o, tempo, owner);
      this.bend = o.bend ?? rand(-0.25, 0.25); this.taper = o.taper ?? 0.35;
      this.n = clamp(Math.round(this.len / Math.max(2, this.w * 0.4)), 6, 28);
    }
    edges(k) {
      const dx = Math.cos(this.a), dy = Math.sin(this.a), L = this.len, B = this.bend * L * 2, left = [], right = [];
      const m = Math.max(2, Math.ceil(this.n * k));
      for (let i = 0; i <= m; i++) {
        const s = (k * i) / m, off = B * s * (1 - s);
        const cx = this.x + dx * (s - 0.5) * L - dy * off, cy = this.y + dy * (s - 0.5) * L + dx * off;
        const tx = dx * L - dy * B * (1 - 2 * s), ty = dy * L + dx * B * (1 - 2 * s), tl = Math.hypot(tx, ty) || 1;
        const nx = -ty / tl, ny = tx / tl;
        const h = (this.w / 2) * (1 - (1 - this.taper) * s) * Math.min(1, 0.55 + s * 6);  // a slightly rounded landing
        left.push([cx + nx * h, cy + ny * h]); right.push([cx - nx * h, cy - ny * h]);
      }
      return { left, right };
    }
    draw(g, k, final) {
      const { left, right } = this.edges(Math.max(0.02, k));
      g.globalAlpha = this.alpha; g.fillStyle = css(this.col);
      g.beginPath();
      left.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
      g.closePath(); g.fill();
      if (!final || !this.ridge) return;
      const line = (pts, c, alpha, lw) => {
        g.globalAlpha = alpha * this.ridge; g.strokeStyle = css(c); g.lineWidth = lw;
        g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      };
      const lw = Math.max(0.8, this.w * 0.06);
      line(left, shade(this.col, 30), 0.5, lw);
      line(right, shade(this.col, -34), 0.42, lw);
      // the bristle tracks a flat brush leaves inside a sweep
      for (const f of [0.25, 0.5, 0.75]) {
        const pts = left.map(([x, y], i) => [x + (right[i][0] - x) * f, y + (right[i][1] - y) * f]);
        line(pts, shade(this.col, f < 0.5 ? 12 : -12), 0.28, Math.max(0.6, this.w * 0.035));
      }
    }
  }

  /** A thick blob of paint pressed on with the knife tip: a wobbly oval that swells into place, lit on one rim and
   *  shadowed on the other, with a glint, so it reads as standing off the canvas. */
  class Impasto extends Timed {
    constructor(o, tempo, owner) {
      super(o, tempo, owner);
      this.ease = typeof o.ease === "function" ? o.ease : ease[o.ease || "out"];
      this.wob = Array.from({ length: 14 }, () => rand(0.84, 1.1));
    }
    rim(k) {
      const rx = (this.len / 2) * k, ry = (this.w / 2) * k, ca = Math.cos(this.a), sa = Math.sin(this.a), n = this.wob.length, pts = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * TAU, r = this.wob[i];
        const ex = Math.cos(t) * rx * r, ey = Math.sin(t) * ry * r;
        pts.push([this.x + ex * ca - ey * sa, this.y + ex * sa + ey * ca]);
      }
      return pts;
    }
    draw(g, k, final) {
      const pts = this.rim(Math.max(0.05, k)), n = pts.length;
      g.globalAlpha = this.alpha; g.fillStyle = css(this.col);
      g.beginPath();
      // smooth the wobbly polygon through its edge midpoints
      const mid = (i) => { const a = pts[i % n], b = pts[(i + 1) % n]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
      let m = mid(n - 1); g.moveTo(m[0], m[1]);
      for (let i = 0; i < n; i++) { m = mid(i); g.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
      g.closePath(); g.fill();
      if (!final || !this.ridge) return;
      const lw = Math.max(0.8, Math.min(this.w, this.len) * 0.09);
      g.lineWidth = lw;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n], out = Math.atan2(-(b[0] - a[0]), b[1] - a[1]);  // outward normal
        const lit = Math.cos(out - LIGHT);
        if (Math.abs(lit) < 0.25) continue;
        g.globalAlpha = 0.55 * Math.abs(lit) * this.ridge;
        g.strokeStyle = css(shade(this.col, lit > 0 ? 42 : -40));
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
      const r = Math.min(this.w, this.len) * 0.16, gx = this.x + Math.cos(LIGHT) * r * 1.6, gy = this.y + Math.sin(LIGHT) * r * 1.6;
      g.globalAlpha = 0.5 * this.ridge; g.fillStyle = css(shade(this.col, 70));
      g.beginPath(); g.ellipse(gx, gy, r, r * 0.45, this.a, 0, TAU); g.fill();
    }
  }

  /** A few short, thin parallel marks at angle `a` across a `width`-wide patch: the quick hatching a painter uses
   *  to pull an edge or a texture into focus. Drawn incrementally, so translucent marks don't build up. */
  class Hatch extends Timed {
    constructor(o, tempo, owner) {
      super(o, tempo, owner);
      this.ease = typeof o.ease === "function" ? o.ease : ease[o.ease || "out"];
      this.alpha = o.alpha ?? 0.85; this.k = 0;
      const n = o.lines ?? Math.round(rand(3, 6)), dx = Math.cos(this.a), dy = Math.sin(this.a);
      this.marks = Array.from({ length: n }, (_, i) => {
        const across = (n > 1 ? i / (n - 1) - 0.5 : 0) * this.w, l = this.len * rand(0.55, 1), along = rand(-0.15, 0.15) * this.len;
        const sx = this.x - dy * across + dx * (along - l / 2), sy = this.y + dx * across + dy * (along - l / 2);
        return { sx, sy, l, lag: (i / n) * 0.35, cs: css(shade(this.col, rand(-16, 16))), lw: Math.max(0.7, this.w * rand(0.07, 0.13)) };
      });
    }
    draw(g, k) {
      const dx = Math.cos(this.a), dy = Math.sin(this.a), k0 = this.k;
      this.k = k;
      g.globalAlpha = this.alpha; g.lineCap = "round";
      for (const m of this.marks) {
        const f = (t) => clamp((t - m.lag) / (1 - m.lag), 0, 1), a = f(k0), b = f(k);
        if (b <= a) continue;
        g.strokeStyle = m.cs; g.lineWidth = m.lw;
        g.beginPath(); g.moveTo(m.sx + dx * m.l * a, m.sy + dy * m.l * a); g.lineTo(m.sx + dx * m.l * b, m.sy + dy * m.l * b); g.stroke();
      }
    }
  }

  function studio(p) {
    const g = p.drawingContext || p;
    let strokes = [];
    const begin = () => {
      g.save(); g.lineCap = "round";
      if (s.clip) { g.beginPath(); g.rect(s.clip.x, s.clip.y, s.clip.w, s.clip.h); g.clip(); }
    };
    const end = () => { g.restore(); g.globalAlpha = 1; };
    const add = (st) => {
      const m = !st.free && s.mask;
      if (m && m(st.x, st.y)) return st;  // starts inside the kept space: never painted
      strokes.push(st); return st;
    };
    const s = {
      /** Multiplies every duration and delay: 2 = half speed. */
      tempo: 1,
      /** Optional (x, y) → true where strokes must not go, e.g. space kept for text. `free: true` strokes ignore it;
       *  a stroke's own `mask` option replaces it for that stroke. */
      mask: null,
      stroke(o) {
        const st = new Stroke(o, s.tempo, s);
        const m = st.ownMask || (!st.free && s.mask);
        if (m && m(st.x, st.y)) return st;  // starts inside the kept space: never painted
        strokes.push(st); return st;
      },
      /** A sharp, flat knife stroke centred on (x, y): { x, y, a, len, width, color, ridge, taper, delay, duration }. */
      knife(o) { return add(new Knife(o, s.tempo, s)); },
      /** A curved flat-brush sweep centred on (x, y): the knife options plus `bend` (−0.5…0.5, how far it bows). */
      sweep(o) { return add(new Sweep(o, s.tempo, s)); },
      /** A raised blob of paint centred on (x, y), `len` × `width`, lit from the upper left. */
      impasto(o) { return add(new Impasto(o, s.tempo, s)); },
      /** A patch of short parallel marks centred on (x, y): `len` long, spread over `width`, `lines` of them. */
      hatch(o) { return add(new Hatch(o, s.tempo, s)); },
      /** A dry bristle drag centred on (x, y) with the knife's options: streaky, runs out of paint, shows what's under. */
      dry(o) {
        const size = o.width || 8, step = size * 0.4, len = o.len || 20, a = o.a || 0;
        return s.stroke({ dry: 0.75, jitter: 16, alpha: 0.8, ...o, size, step, len: Math.max(2, len / step),
          x: o.x - Math.cos(a) * len / 2, y: o.y - Math.sin(a) * len / 2 });
      },
      /** Optional clip rectangle { x, y, w, h } every stroke is drawn inside. */
      clip: null,
      /** A short, round touch of paint. */
      dab(x, y, size, color, o = {}) {
        return s.stroke({ x, y, a: rand(TAU), size, color, len: 3, step: size * 0.35, dry: 0.2, turn: rand(-0.3, 0.3), duration: 0.35, ...o });
      },
      update(dt) {
        if (!strokes.length) return;
        begin();
        dt = clamp(dt, 0, 0.1);
        strokes = strokes.filter((st) => st.advance(g, dt) || (s.onDone && s.onDone(st), false));
        end();
      },
      finish() {
        begin();
        strokes.sort((a, b) => a.wait - b.wait).forEach((st) => st.finish(g));
        strokes = [];
        end();
      },
      /** Optional callback (stroke) → void, run when a stroke finishes painting during update() (not finish()). The
       *  stroke object is what knife()/sweep()/… returned, so callers can tag it with their own data. */
      onDone: null,
      clear() { strokes = []; },
      get busy() { return strokes.length; },
    };
    return s;
  }

  /** Loads the cover so templates can paint with its pixels. The app serves it from the page's own origin. */
  function cover(url, size = 64) {
    return new Promise((resolve) => {
      const fallback = { at: () => [128, 128, 128], ok: false };
      if (!url) return resolve(fallback);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const cv = document.createElement("canvas"); cv.width = cv.height = size;
          const c = cv.getContext("2d"); c.drawImage(img, 0, 0, size, size);
          const px = c.getImageData(0, 0, size, size).data;
          const at = (fx, fy) => {
            const x = clamp((fx * size) | 0, 0, size - 1), y = clamp((fy * size) | 0, 0, size - 1), i = (y * size + x) * 4;
            return [px[i], px[i + 1], px[i + 2]];
          };
          const L = (fx, fy) => lum(at(fx, fy));
          resolve({
            ok: true, image: img, size, at,
            /** Average colour of the box [fx0,fx1]×[fy0,fy1], and how much it varies (0–~120). */
            box(fx0, fy0, fx1, fy1, n = 4) {
              let r = 0, gg = 0, b = 0, m = 0; const cs = [];
              for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
                const c = at(fx0 + (fx1 - fx0) * (i + 0.5) / n, fy0 + (fy1 - fy0) * (j + 0.5) / n); cs.push(c);
                r += c[0]; gg += c[1]; b += c[2]; m++;
              }
              const avg = [r / m, gg / m, b / m];
              const dev = Math.sqrt(cs.reduce((a, c) => a + (c[0] - avg[0]) ** 2 + (c[1] - avg[1]) ** 2 + (c[2] - avg[2]) ** 2, 0) / m / 3);
              return { color: avg, dev };
            },
            /** Luminance gradient (Sobel) at a point: { gx, gy, mag }. Edges run perpendicular to it. */
            grad(fx, fy) {
              const d = 1 / size;
              const gx = (L(fx + d, fy - d) + 2 * L(fx + d, fy) + L(fx + d, fy + d)) - (L(fx - d, fy - d) + 2 * L(fx - d, fy) + L(fx - d, fy + d));
              const gy = (L(fx - d, fy + d) + 2 * L(fx, fy + d) + L(fx + d, fy + d)) - (L(fx - d, fy - d) + 2 * L(fx, fy - d) + L(fx + d, fy - d));
              return { gx, gy, mag: Math.hypot(gx, gy) };
            },
          });
        } catch (e) { resolve(fallback); }
      };
      img.onerror = () => resolve(fallback);
      img.src = url;
    });
  }

  window.Brush = { studio, cover, ease, rgb, mix, shade, css, lum, sat, rand, TAU, LIGHT };
})();
