/*
 * Painterly brush strokes for canvas templates (works with the bundled p5: /runtime/vendor/p5.min.js).
 *
 *   const studio = Brush.studio(p);                     // p = a p5 instance (or anything with drawingContext)
 *   studio.stroke({ x, y, a, size, color, len, ... });  // queue a stroke; it paints itself over time
 *   studio.update(dt);                                  // advance every stroke by dt seconds (call from draw)
 *   studio.finish();                                    // paint everything queued right now (for stills)
 *   const cover = await Brush.cover(ctx.track.cover);   // cover.at(fx, fy) → [r, g, b] from the album art
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
    constructor(o, tempo) {
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

  function studio(p) {
    const g = p.drawingContext || p;
    let strokes = [];
    const s = {
      /** Multiplies every duration and delay: 2 = half speed. */
      tempo: 1,
      stroke(o) { const st = new Stroke(o, s.tempo); strokes.push(st); return st; },
      /** A short, round touch of paint. */
      dab(x, y, size, color, o = {}) {
        return s.stroke({ x, y, a: rand(TAU), size, color, len: 3, step: size * 0.35, dry: 0.2, turn: rand(-0.3, 0.3), duration: 0.35, ...o });
      },
      update(dt) {
        if (!strokes.length) return;
        g.lineCap = "round";
        dt = clamp(dt, 0, 0.1);
        strokes = strokes.filter((st) => st.advance(g, dt));
        g.globalAlpha = 1;
      },
      finish() {
        g.lineCap = "round";
        strokes.sort((a, b) => a.wait - b.wait).forEach((st) => st.finish(g));
        strokes = [];
        g.globalAlpha = 1;
      },
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
          resolve({
            ok: true, image: img,
            at(fx, fy) {
              const x = clamp((fx * size) | 0, 0, size - 1), y = clamp((fy * size) | 0, 0, size - 1), i = (y * size + x) * 4;
              return [px[i], px[i + 1], px[i + 2]];
            },
          });
        } catch (e) { resolve(fallback); }
      };
      img.onerror = () => resolve(fallback);
      img.src = url;
    });
  }

  window.Brush = { studio, cover, ease, rgb, mix, shade, css, lum, sat, rand, TAU };
})();
