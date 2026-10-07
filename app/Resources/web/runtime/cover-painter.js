/*
 * Paints the album cover itself as a coarse knife painting (used by the Painted Cover templates).
 *
 * The cover is repainted in three passes of sharp, flat strokes: large slabs, medium strokes, then small ones only
 * where the cover has detail. Strokes run along the edges in the image, so shapes read as painted, not pixelated.
 *
 *   <html data-layout="square">  the cover as a square beside the text (needs a .col element for the text)
 *   <html data-layout="wide">    the cover cropped to fill the screen, text on a solid .panel
 *
 * Params it reads: side, speed, detail ("grow" | "fixed"), level (1–3), ridge, refine, strokes, paintWords, timelapse,
 * wetness, memory, beatSync.
 * - strokes: "mixed" (knife slabs, curved sweeps, dry brush, impasto and hatching, each where it suits the cover),
 *   "genre" (the mix and the hand follow the song's genre, see GENRES / STYLES), or one kind throughout: "knife",
 *   "sweep", "dry", "impasto".
 * - grow: a new song starts as large slabs and gets finer as it plays; the still shows mid detail.
 * - Live layer: a new song is painted over the old one, coarse to fine. Each lyric line refines a band.
 * - paintWords (live): each line's most striking word is lettered into the painting in strokes, then painted over
 *   during the next few lines.
 * - timelapse (live): before a new cover goes on, the old painting is replayed from its underpainting in ~4 s.
 * - wetness (live): fresh strokes carry a soft highlight (a separate overlay canvas) that dries to matte in 20–40 s.
 * - memory (live): a new cover leaves an irregular border of the old paintings showing around the edges.
 * - beatSync (live, needs Wallpaper "beat" events): onsets release a burst of fine strokes; loudness paces growth.
 */
(function () {
  const B = Brush, rand = B.rand;
  const COUNTS = { square: [12, 26, 54], wide: [22, 46, 96] };  // strokes across the painting, per pass
  // each kind's length/width relative to a knife stroke in the same cell
  const SHAPE = { knife: [1, 1], sweep: [1.15, 0.95], dry: [1.1, 1], impasto: [0.55, 0.9], hatch: [0.6, 1] };

  // ---------- painting styles ----------
  // genre (iTunes primaryGenreName) → style; first match wins, anything else paints "mixed"
  const GENRES = [
    [/lo-?fi|chill/i, "mixed"],
    [/electro|dance|house|techno|trance|edm|dubstep|drum|garage|idm|club|breakbeat/i, "electronic"],
    [/hip-?hop|rap|r&b|rnb|trap|grime|drill/i, "hiphop"],
    [/jazz|blues|soul|funk|gospel|swing|bossa/i, "jazz"],
    [/classical|soundtrack|score|ambient|new age|orchestr|opera|piano|instrumental|meditat|easy listening/i, "calm"],
    [/metal|punk|rock|grunge|hardcore|emo/i, "rock"],
    [/pop|singer|songwriter|indie|alternative|folk|country|latin|reggae|world|acoustic/i, "pop"],
  ];
  // The mark mix per pass, as weights:          w[0] block-in   w[1] middle   w[2] fine on edges   w[3] fine on detail
  // and the hand: flow = |base angle| range (random sign), wobble = how far the flow wanders, jitter = per-stroke
  // angle noise, len / width / bend = multipliers on the stroke shape, warm = rgb added to every colour.
  //
  //  style       look                                     block-in            middle                       fine (edges / detail)
  //  mixed       the original mix                         knife 7 sweep 3     knife 4 sweep 3 dry 3        knife 6 hatch 4 / impasto 4.5 dry 3 sweep 2.5
  //  rock        impasto + knife heavy, steep flow        knife 6 imp 2 sw 2  knife 5 impasto 3 dry 2      knife 7 hatch 3 / impasto 6 knife 3 dry 1
  //  electronic  crisp knife slabs, flat horizontal flow  knife 9 sweep 1     knife 8 sweep 1 hatch 1      knife 7 hatch 3 / knife 6 hatch 3 imp 1
  //  hiphop      bold sweeps + knife                      sweep 5 knife 5     sweep 5 knife 4 dry 1        knife 6 sw 2 hatch 2 / sweep 4 imp 4 knife 2
  //  jazz        dry brush + sweeps, warm                 sweep 5 dry 2 kn 3  dry 5 sweep 4 knife 1        dry 4 hatch 3 knife 3 / dry 5 sweep 3 imp 2
  //  calm        long, soft sweeps + dry brush            sweep 7 dry 2 kn 1  sweep 6 dry 4                sweep 5 dry 3 hatch 2 / dry 5 sweep 5
  //  pop         mixed, a little rounder                  knife 5 sweep 5     kn 3 sw 4 dry 2 imp 1        knife 5 hatch 3 sw 2 / imp 5 sweep 3 dry 2
  const STYLES = {
    mixed: { w: [{ knife: 7, sweep: 3 }, { knife: 4, sweep: 3, dry: 3 }, { knife: 6, hatch: 4 }, { impasto: 4.5, dry: 3, sweep: 2.5 }] },
    rock: { w: [{ knife: 6, impasto: 2, sweep: 2 }, { knife: 5, impasto: 3, dry: 2 }, { knife: 7, hatch: 3 }, { impasto: 6, knife: 3, dry: 1 }],
      flow: [0.55, 0.95], wobble: 0.9, jitter: 0.14, len: 0.9, width: 1.05 },
    electronic: { w: [{ knife: 9, sweep: 1 }, { knife: 8, sweep: 1, hatch: 1 }, { knife: 7, hatch: 3 }, { knife: 6, hatch: 3, impasto: 1 }],
      flow: [0, 0], wobble: 0.12, jitter: 0.01, len: 1.15, width: 0.9, bend: 0.3 },
    hiphop: { w: [{ sweep: 5, knife: 5 }, { sweep: 5, knife: 4, dry: 1 }, { knife: 6, sweep: 2, hatch: 2 }, { sweep: 4, impasto: 4, knife: 2 }],
      flow: [0, 0.25], len: 1.05, width: 1.15, bend: 1.3 },
    jazz: { w: [{ sweep: 5, dry: 2, knife: 3 }, { dry: 5, sweep: 4, knife: 1 }, { dry: 4, hatch: 3, knife: 3 }, { dry: 5, sweep: 3, impasto: 2 }],
      flow: [0, 0.45], bend: 1.2, warm: [10, 3, -10] },
    calm: { w: [{ sweep: 7, dry: 2, knife: 1 }, { sweep: 6, dry: 4 }, { sweep: 5, dry: 3, hatch: 2 }, { dry: 5, sweep: 5 }],
      flow: [0, 0.2], wobble: 0.5, len: 1.35, width: 0.85, bend: 1.4 },
    pop: { w: [{ knife: 5, sweep: 5 }, { knife: 3, sweep: 4, dry: 2, impasto: 1 }, { knife: 5, hatch: 3, sweep: 2 }, { impasto: 5, sweep: 3, dry: 2 }] },
  };
  for (const k in STYLES) STYLES[k] = { name: k, flow: [0, 0.35], wobble: 0.7, jitter: 0.08, len: 1, width: 1, bend: 1, warm: null, ...STYLES[k] };
  const genreStyle = (genre) => { for (const [re, s] of GENRES) if (re.test(genre || "")) return s; return "mixed"; };

  // words that never get painted (≥4 letters, so shorter ones are already out)
  const STOP = new Set(("that this with from have were been they them their there then than when what where which while your yours " +
    "into just like dont don't cant can't wont won't will would could should about over under again some more most much many only also " +
    "very even ever every each other another because before after through these those yeah gonna wanna gotta know make made come came " +
    "want need said says tell take does doing cause 'cause being here always never still around really thing things nothing something " +
    "everything anything ain't aint you're we're they're that's i've you've we've i'll you'll we'll they'll you'd would've could've " +
    "mine ours myself yourself whoa woah baby didn't doesn't isn't wasn't won't shouldn't couldn't wouldn't what's there's let's got").split(" "));
  const VOCABLE = /^(o+h+|a+h+|y+e+a+h+|w+o+a+h+|w+h+o+a+|(la)+|(na)+|h+m+|m+h+m+|u+h+|o+o+h*|e+h+)$/i;

  const WORD_GAP = 6000, WORD_FADE = [0.25, 0.3, 0.35, 0.5, 1];  // ms between painted words; share covered per line
  const RECORD_CAP = 6000, LAPSE = 3.6, LAPSE_HOLD = 0.6;        // timelapse: strokes kept, replay seconds, hold
  const WET_MAX = 500;

  let p, g, studio, paintEl, W = 0, H = 0;
  let cov = null, region = null, layout = "square", side = "left", params = {}, style = STYLES.mixed;
  let passes = [[], [], []], shown = [0, 0, 0], quietUntil = 0, painted = false, paintKey = "", paintRest = "", pending = null, flowAngle = 0;
  let record = [], mem = null, words = [], lastWordAt = -1e9;
  let beatAt = -1e9, beatLevel = 0, burstAt = 0, growAcc = 0;

  const ready = new Promise((resolve) => {
    new p5((sk) => {
      p = sk;
      sk.setup = () => {
        sk.pixelDensity(1);
        paintEl = sk.createCanvas(innerWidth, innerHeight).elt;
        paintEl.classList.add("paint");
        sk.noLoop();
        g = sk.drawingContext;
        studio = B.studio(sk);
        studio.onDone = (st) => { if (st.tag) wet.add(st.tag); };
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
  /** Average colour and variation of the cover under a screen box. */
  const coverBox = (x0, y0, x1, y1, n) => {
    const [ax, ay] = toCover((x0 - region.x) / region.w, (y0 - region.y) / region.h), [bx, by] = toCover((x1 - region.x) / region.w, (y1 - region.y) / region.h);
    return cov.box(ax, ay, bx, by, n);
  };

  // ---------- memory: the border a new cover leaves alone ----------
  /** > 0 inside the part this painting covers, < 0 in the kept border; ±1 is the soft edge. */
  function memField(m, x, y) {
    const s = Math.min(region.w, region.h), fx = (x - region.x) / region.w, fy = (y - region.y) / region.h;
    const d = Math.min(x - region.x, region.x + region.w - x, y - region.y, region.y + region.h - y) / s;
    const ang = Math.atan2(fy - 0.5, fx - 0.5);
    const t = m.inset + (p.noise(Math.cos(ang) * 1.4 + m.seed, Math.sin(ang) * 1.4 + m.seed, 3.3) - 0.5) * 0.14
      + (p.noise(fx * 6 + m.seed, fy * 6, 7.1) - 0.5) * 0.05;
    return (d - t) / 0.025;
  }
  const memSkip = (m, x, y) => !!m && memField(m, x, y) < rand(-1, 1);
  /** A small alpha mask of the part painting `m` covered (opaque inside, soft edge), stretched over the region. */
  function memCanvas(m) {
    const n = 96, c = document.createElement("canvas"), h = Math.max(1, Math.round(n * region.h / region.w));
    c.width = n; c.height = h;
    const k = c.getContext("2d"), im = k.createImageData(n, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < n; i++) {
      const f = Math.max(0, Math.min(1, memField(m, region.x + (i + 0.5) / n * region.w, region.y + (j + 0.5) / h * region.h) * 0.5 + 0.5));
      im.data[(j * n + i) * 4 + 3] = f * f * (3 - 2 * f) * 255;
    }
    k.putImageData(im, 0, 0);
    return c;
  }

  // ---------- the three passes ----------
  /** Which kind of mark a stroke is, drawn from the style's weights for this pass. */
  function pickKind(level, edge) {
    const kind = params.strokes || "mixed";
    if (kind !== "mixed" && kind !== "genre") return SHAPE[kind] ? kind : "knife";
    const w = style.w[level < 2 ? level : edge ? 2 : 3];
    let total = 0;
    for (const k in w) total += w[k];
    let r = Math.random() * total;
    for (const k in w) if ((r -= w[k]) < 0) return k;
    return "knife";
  }
  /** Puts a stroke on the canvas and remembers it (timelapse, wet sheen). */
  function put(s, o) {
    const spec = o ? { ...s, ...o } : s, st = studio[spec.kind](spec);
    if (Wallpaper.live) {
      record.push(spec);
      if (record.length > RECORD_CAP) trimRecord();
      if (params.wetness !== false) st.tag = spec;
    }
    return st;
  }
  /** Over the cap: drop the oldest of the finest strokes (lettering counts as finest). */
  function trimRecord() {
    let top = 0;
    for (const s of record) if ((s.level || 0) > top) top = s.level || 0;
    let n = 500;
    record = record.filter((s) => (s.level || 0) !== top || n-- <= 0);
  }

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /** One stroke for the cell of size `cell` centred on (cx, cy), or null where this pass has nothing to add. */
  function cellStroke(level, cx, cy, cell, force) {
    const fx = (cx - region.x) / region.w, fy = (cy - region.y) / region.h, half = 0.5 * cell / region.w;
    const [ax, ay] = toCover(fx - half, fy - half * region.w / region.h), [bx, by] = toCover(fx + half, fy + half * region.w / region.h);
    const { color, dev } = cov.box(ax, ay, bx, by, level === 0 ? 4 : 3);
    if (!force && level === 1 && dev < 5 && Math.random() < 0.55) return null;
    if (!force && level === 2 && dev < 13) return null;
    const [gx0, gy0] = toCover(fx, fy), gr = cov.grad(gx0, gy0);
    // one calm direction for the whole painting, bending along real edges in the cover
    const flow = flowAngle + (p.noise(fx * 1.6, fy * 1.6, 9) - 0.5) * style.wobble;
    let a = flow;
    if (gr.mag > 22) {
      let e = Math.atan2(gr.gy, gr.gx) + Math.PI / 2;
      if (Math.cos(e - flow) < 0) e += Math.PI;  // keep strokes pointing the same general way
      const w = Math.min(1, (gr.mag - 22) / 40);
      a = Math.atan2(Math.sin(flow) * (1 - w) + Math.sin(e) * w, Math.cos(flow) * (1 - w) + Math.cos(e) * w);
    }
    const sizeK = [1, 0.95, 0.85][level], kind = pickKind(level, gr.mag > 30), [lk, wk] = SHAPE[kind];
    // sweeps bow the way the flow field is turning here, so neighbouring curves agree
    const bend = (p.noise(fx * 3, fy * 3, 4) - 0.5) * 0.8 * style.bend;
    let col = B.shade(color, rand(-5, 5));
    if (style.warm) col = col.map((v, i) => Math.max(0, Math.min(255, v + style.warm[i])));
    return { kind, x: cx, y: cy, a: a + rand(-style.jitter, style.jitter), len: cell * rand(1.6, 2.4) * sizeK * lk * style.len,
      width: cell * rand(0.85, 1.1) * sizeK * wk * style.width, bend, color: col, ridge: params.ridge === false ? 0 : 1, level };
  }

  /** Strokes for one pass: one per grid cell (finer passes only where the cover has detail, unless `force`).
   *  `box` = { y0, y1, x0?, x1? } limits it to part of the painting. */
  function buildPass(level, box, force) {
    // the coarse pass is laid twice (offset) so it covers everything; finer passes once
    const across = COUNTS[layout][level], cell = region.w / across, rows = Math.ceil(region.h / cell), out = [];
    const reps = level === 0 ? 2 : 1;
    for (let r = 0; r < reps; r++) for (let j = 0; j < rows; j++) for (let i = 0; i < across; i++) {
      const cx = region.x + (i + 0.5 + r * 0.5 + rand(-0.3, 0.3)) * cell, cy = region.y + (j + 0.5 + r * 0.5 + rand(-0.3, 0.3)) * cell;
      if (box && (cy < box.y0 || cy > box.y1 || (box.x0 != null && (cx < box.x0 || cx > box.x1)))) continue;
      if (mem && memSkip(mem, cx, cy)) continue;
      const s = cellStroke(level, cx, cy, cell, force);
      if (s) out.push(s);
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
  function paint(gradual, progress, old) {
    W = p.width; H = p.height;
    region = computeRegion();
    studio.clip = { x: region.x, y: region.y, w: region.w, h: region.h };
    studio.clear();
    const f = style.flow, mag = rand(f[0], f[1]);
    flowAngle = Math.random() < 0.5 ? -mag : mag;
    // memory: a new cover over an old painting leaves a ragged border of it; a fresh canvas is painted whole
    mem = gradual && Wallpaper.live && params.memory ? { seed: rand(1000), inset: rand(0.1, 0.18) } : null;
    record = []; words = [];
    passes = [0, 1, 2].map((k) => buildPass(k));
    const t = targets(progress);
    if (!gradual) {
      wet.reset();
      g.clearRect(0, 0, W, H);
      underpaint();
      for (let k = 0; k < 3; k++) {
        shown[k] = Math.round(passes[k].length * t[k]);
        for (let i = 0; i < shown[k]; i++) put(passes[k][i]);
        studio.finish();
      }
    } else {
      // the old painting replays first (timelapse), then the new cover goes on over it: the large slabs first,
      // spread over a few seconds
      const lead = old ? replay(old) : 0;
      const n = passes[0].length, spread = 7;
      passes[0].forEach((s, i) => put(s, { delay: lead / studio.tempo + (i / n) * spread + rand(0.4), duration: rand(0.7, 1.2) }));
      shown = [n, 0, 0];
      quietUntil = performance.now() + (spread + 1) * 1000 * studio.tempo + lead * 1000;
    }
    painted = true;
  }

  /** A flat, blocky first layer of a cover (like a painter's blocking-in), so no background shows between strokes.
   *  With a memory mask it only goes where that painting went. */
  function underpaint(c = cov, m = null) {
    if (!c || !c.image) return;
    const n = COUNTS[layout][0], s = document.createElement("canvas");
    s.width = n; s.height = Math.max(1, Math.round(n * region.h / region.w));
    const im = c.image, iw = im.naturalWidth, ih = im.naturalHeight, cr = region.crop;
    s.getContext("2d").drawImage(im, cr.x0 * iw, cr.y0 * ih, (cr.x1 - cr.x0) * iw, (cr.y1 - cr.y0) * ih, 0, 0, s.width, s.height);
    let src = s;
    if (m) {
      src = document.createElement("canvas");
      src.width = Math.ceil(region.w); src.height = Math.ceil(region.h);
      const k = src.getContext("2d");
      k.imageSmoothingEnabled = false; k.drawImage(s, 0, 0, src.width, src.height);
      k.imageSmoothingEnabled = true; k.globalCompositeOperation = "destination-in"; k.drawImage(memCanvas(m), 0, 0, src.width, src.height);
    }
    g.save(); g.imageSmoothingEnabled = false;
    g.drawImage(src, region.x, region.y, region.w, region.h);
    g.restore();
  }

  /** Timelapse: the old painting again from its underpainting, every stroke in order, in ~4 s. Returns the seconds
   *  (real time) until the next painting should start. */
  function replay(old) {
    const rec = old.rec, n = rec.length, tempo = studio.tempo;
    wet.reset();
    underpaint(old.cov, old.mem);
    rec.forEach((s, i) => studio[s.kind]({ ...s, delay: ((i / n) * LAPSE + rand(0.05)) / tempo, duration: rand(0.12, 0.25) / tempo }));
    return LAPSE + 0.3 + LAPSE_HOLD;
  }

  /** Live: add finer strokes as the song plays, a few at a time so they appear one by one. With beat data, the
   *  loudness sets the pace (quiet ≈ 1.5, loud ≈ 6 strokes a frame). */
  function grow() {
    if (performance.now() < quietUntil || !Wallpaper.ctx) return;
    const t = targets(Wallpaper.ctx.track.progress || 0);
    let budget = 3;
    if (beatLive()) { growAcc += 3 * (0.5 + 1.5 * beatLevel); budget = Math.floor(growAcc); growAcc -= budget; }
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
    for (const s of buildPass(level, { y0, y1: y0 + bh })) {
      put(s, { delay: ((s.x - region.x) / region.w) * 1.6, duration: rand(0.5, 0.9) });
    }
  }

  // ---------- beats ----------
  const beatLive = () => params.beatSync !== false && performance.now() - beatAt < 2000;
  /** An onset: a burst of the queued fine strokes (and now and then a knife slab) lands on the beat. */
  function onBeat(b) {
    if (!b) return;
    beatAt = performance.now();
    const lv = b.level ?? (Wallpaper.beat && Wallpaper.beat.level);
    if (lv != null && isFinite(lv)) beatLevel = Math.max(0, Math.min(1, +lv));
    const ctx = Wallpaper.ctx, now = beatAt;
    if (!(b.strength > 0.5) || params.beatSync === false || !painted || !Wallpaper.live || Wallpaper.paused) return;
    if (!ctx || !ctx.track.isPlaying || now < quietUntil || now - burstAt < 150) return;
    burstAt = now;
    let left = Math.round(2 + 6 * Math.min(1, b.strength));
    const t = targets(ctx.track.progress || 0), d = () => ({ duration: rand(0.16, 0.3) });
    // what grow() would paint next, then (while detail is still growing) a little ahead of it
    for (let k = 1; k < 3; k++) {
      const want = Math.round(passes[k].length * t[k]);
      while (left > 0 && shown[k] < want) { put(passes[k][shown[k]++], d()); left--; }
    }
    for (let k = 1; k < 3 && params.detail !== "fixed"; k++) {
      while (left > 0 && t[k] > 0 && shown[k] < passes[k].length) { put(passes[k][shown[k]++], d()); left--; }
    }
    if (b.strength > 0.75 && Math.random() < 0.3) {
      const cell = region.w / COUNTS[layout][1];
      for (let i = 0; i < 6; i++) {
        const x = region.x + rand(region.w), y = region.y + rand(region.h);
        if (mem && memSkip(mem, x, y)) continue;
        const s = cellStroke(1, x, y, cell, true);
        put({ ...s, kind: "knife", len: s.len * 1.25 }, { duration: rand(0.15, 0.22) });
        break;
      }
    }
  }

  // ---------- words painted into the canvas ----------
  /** The line's most striking word: the longest one of 4+ letters that isn't a filler word. */
  function pickWord(line) {
    let best = "";
    for (let w of line.match(/[\p{L}\p{N}'’]+/gu) || []) {
      w = w.replace(/^['’]+|['’]+$/g, "");
      const letters = (w.match(/\p{L}/gu) || []).length;
      if (letters < 4 || w.length > 14 || STOP.has(w.toLowerCase().replace(/’/g, "'")) || VOCABLE.test(w)) continue;
      if (letters > (best.match(/\p{L}/gu) || []).length) best = w;
    }
    return best.toLocaleUpperCase();
  }
  /** Where a word may go: inside the painting (square) or the part of the screen beside the text panel (wide). */
  function wordArea() {
    let a;
    if (layout === "wide") {
      const pw = Math.min(W * 0.38, Math.min(W, H) * 0.88), px = side === "left" ? W * 0.05 : W - W * 0.05 - pw, m = W * 0.04;
      a = side === "left" ? { x0: px + pw + m, x1: W - m } : { x0: m, x1: px - m };
      a.y0 = H * 0.1; a.y1 = H * 0.9;
    } else {
      const m = region.w * 0.08;
      a = { x0: region.x + m, x1: region.x + region.w - m, y0: region.y + m, y1: region.y + region.h - m };
    }
    if (mem) {
      const m = (mem.inset + 0.1) * Math.min(region.w, region.h);
      a = { x0: Math.max(a.x0, region.x + m), x1: Math.min(a.x1, region.x + region.w - m), y0: Math.max(a.y0, region.y + m), y1: Math.min(a.y1, region.y + region.h - m) };
    }
    return a.x1 - a.x0 > 40 && a.y1 - a.y0 > 40 ? a : null;
  }
  /** A colour from the cover that stands out against `bg`: light on dark, dark on light. */
  function wordColor(bg) {
    const L = B.lum(bg);
    let best = null, score = -1;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const c = cov.at((i + 0.5) / 8, (j + 0.5) / 8), s = Math.abs(B.lum(c) - L) + 40 * B.sat(c);
      if (s > score) { score = s; best = c; }
    }
    if (Math.abs(B.lum(best) - L) < 110) best = B.mix(best, L < 128 ? [246, 240, 228] : [18, 16, 14], 0.65);
    return best;
  }

  /** Letters the word into the painting: the word is rendered to a small mask, then covered with knife and dry-brush
   *  strokes laid along the glyphs (each stroke follows the longest run of ink through its seed point). */
  function paintWord(text) {
    const word = pickWord(text), area = word && wordArea();
    if (!area) return;
    const fam = (Wallpaper.fonts && Wallpaper.fonts[params.font]) || params.font || "Helvetica Neue, Helvetica, sans-serif";
    const font = (px) => `900 ${px}px ${fam}`;
    const mk = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    mk.font = font(100);
    const m0 = mk.measureText(word), asc = m0.actualBoundingBoxAscent || 72, desc = m0.actualBoundingBoxDescent || 0;
    const ww = (m0.actualBoundingBoxLeft || 0) + (m0.actualBoundingBoxRight || m0.width), hh = asc + desc;
    const aw = area.x1 - area.x0, ah = area.y1 - area.y0;
    let sc = Math.min(aw * rand(0.5, 0.72), region.w * 0.62) / ww;   // screen px per 100px-font unit
    sc = Math.min(sc, Math.min(region.h * 0.2, ah * 0.45) / hh);
    const bw = ww * sc, bh = hh * sc;
    if (bh < 14 || bw > aw) return;
    // the calmest of a few random spots
    let at = null, calm = 1e9;
    for (let i = 0; i < 18; i++) {
      const x = area.x0 + rand(aw - bw), y = area.y0 + rand(ah - bh);
      // away from words still showing
      const hit = words.some((w) => x < w.x1 + bh * 0.3 && x + bw > w.x0 - bh * 0.3 && y < w.y1 + bh * 0.3 && y + bh > w.y0 - bh * 0.3);
      const dev = coverBox(x, y, x + bw, y + bh, 4).dev + rand(8) + (hit ? 1000 : 0);
      if (dev < calm) { calm = dev; at = [x, y]; }
    }
    // the mask: cap height ~48px
    const r = 48 / hh, mw = Math.ceil(ww * r) + 4, mh = Math.ceil(hh * r) + 4;
    mk.canvas.width = mw; mk.canvas.height = mh;
    mk.font = font(100 * r); mk.fillStyle = "#000"; mk.textBaseline = "alphabetic";
    mk.fillText(word, 2 + (m0.actualBoundingBoxLeft || 0) * r, 2 + asc * r);
    const px = mk.getImageData(0, 0, mw, mh).data, ink = new Uint8Array(mw * mh);
    for (let i = 0; i < mw * mh; i++) ink[i] = px[i * 4 + 3] > 120 ? 1 : 0;
    const on = (x, y) => { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < mw && y < mh && ink[y * mw + x] === 1; };
    // stem thickness ≈ the median horizontal run of ink
    const runs = [];
    for (let y = 2; y < mh; y += 3) { let n = 0; for (let x = 0; x <= mw; x++) { if (x < mw && ink[y * mw + x]) n++; else if (n) { runs.push(n); n = 0; } } }
    if (!runs.length) return;
    runs.sort((a, b) => a - b);
    const u = Math.max(3, runs[runs.length >> 1]);
    const reach = (x, y, dx, dy) => { let n = 0; while (n < 400 && on(x + dx * (n + 1), y + dy * (n + 1))) n++; return n; };
    const done = new Uint8Array(mw * mh), strokes = [];
    const step = Math.max(1, Math.round(u / 2)), ANG = 24;
    for (let y = 1; y < mh; y += step) for (let x = 1; x < mw; x += step) {
      if (!ink[y * mw + x] || done[y * mw + x]) continue;
      // the direction with the longest run of ink through this point
      let best = 0, ba = 0;
      for (let k = 0; k < ANG; k++) {
        const a = (k / ANG) * Math.PI, dx = Math.cos(a), dy = Math.sin(a), n = reach(x, y, dx, dy) + reach(x, y, -dx, -dy);
        if (n > best) { best = n; ba = a; }
      }
      let dx = Math.cos(ba), dy = Math.sin(ba), cx = x, cy = y;
      // centre across the stem
      const l = reach(x, y, dy, -dx), rr = reach(x, y, -dy, dx);
      if (l + rr < u * 2.2) { cx += dy * (l - rr) / 2; cy += -dx * (l - rr) / 2; }
      const f = reach(cx, cy, dx, dy), bk = reach(cx, cy, -dx, -dy);
      const ax = cx - dx * bk, ay = cy - dy * bk, ex = cx + dx * f, ey = cy + dy * f, len = Math.max(u, f + bk + 1);
      // mark the ink this stroke covers
      const hw = u * 0.6, x0 = Math.max(0, Math.floor(Math.min(ax, ex) - hw)), x1 = Math.min(mw - 1, Math.ceil(Math.max(ax, ex) + hw));
      const y0 = Math.max(0, Math.floor(Math.min(ay, ey) - hw)), y1 = Math.min(mh - 1, Math.ceil(Math.max(ay, ey) + hw));
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
        const t = Math.max(0, Math.min(len, (i - ax) * dx + (j - ay) * dy)), qx = ax + dx * t - i, qy = ay + dy * t - j;
        if (qx * qx + qy * qy <= hw * hw) done[j * mw + i] = 1;
      }
      strokes.push({ x: (ax + ex) / 2, y: (ay + ey) / 2, a: ba, len });
    }
    // to screen: lettered left to right, in a colour that stands out from the cover under it
    const k = bw / (mw - 4), ox = at[0] - 2 * k, oy = at[1] - 2 * k, color = wordColor(coverBox(at[0], at[1], at[0] + bw, at[1] + bh, 4).color);
    const span = 1.4 + bw / region.w;
    for (const s of strokes) {
      const x = ox + s.x * k, y = oy + s.y * k, kind = s.len > u * 2.4 && Math.random() < 0.25 ? "dry" : "knife";
      // knife strokes go either way; a dry drag pulls left to right / downward, like a hand lettering
      const a = (kind === "knife" ? s.a + (Math.random() < 0.5 ? Math.PI : 0) : s.a) + rand(-0.04, 0.04);
      const o = { kind, x, y, a, len: s.len * k + u * k * (kind === "dry" ? 0.7 : 0.4), width: u * k * (kind === "dry" ? 1.2 : 1.08),
        color: B.shade(color, rand(-8, 8)), ridge: params.ridge === false ? 0 : 1, taper: 0.9, skew: rand(-0.12, 0.12), level: 3 };
      if (kind === "dry") Object.assign(o, { alpha: 1, dry: 0.25, jitter: 10 });
      put(o, { delay: ((x - at[0]) / bw) * span + rand(0.15), duration: rand(0.3, 0.55) });
    }
    words.push({ x0: at[0], y0: at[1], x1: at[0] + bw, y1: at[1] + bh, age: 0 });
    lastWordAt = performance.now();
  }

  /** Each line paints a little more of the cover back over the painted words, so a word is gone after ~4 lines. */
  function coverWords() {
    words = words.filter((w) => {
      const share = WORD_FADE[Math.min(w.age, WORD_FADE.length - 1)], pad = (w.y1 - w.y0) * 0.2;
      const all = buildPass(1, { x0: w.x0 - pad, x1: w.x1 + pad, y0: w.y0 - pad, y1: w.y1 + pad }, true);
      for (const s of all.slice(0, Math.ceil(all.length * share))) put(s, { delay: rand(1.4), duration: rand(0.5, 0.9) });
      return ++w.age < WORD_FADE.length;
    });
  }

  // ---------- wet paint ----------
  // Fresh strokes get a soft highlight on their lit side (light from the upper left, like the ridges) on a
  // transparent canvas above the painting, fading to matte; only the still-wet ones are redrawn, and nothing at all
  // once everything is dry. A stroke painted over a wet one wipes its sheen.
  const wet = {
    list: [], cv: null, g: null, drawn: false, last: 0,
    ensure() {
      if (this.cv) return;
      const cv = (this.cv = document.createElement("canvas")), z = getComputedStyle(paintEl).zIndex;
      cv.className = "paint-wet";
      Object.assign(cv.style, { position: "fixed", left: "0", top: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: z === "auto" ? "" : z });
      paintEl.after(cv);
      this.g = cv.getContext("2d");
    },
    add(s) {
      if (!Wallpaper.live || params.wetness === false || !region) return;
      this.ensure();
      const dx = Math.cos(s.a || 0), dy = Math.sin(s.a || 0), now = performance.now();
      const len = s.len || 20, w = s.width || 8;
      // a stroke wipes the sheen of wet strokes it lands on
      this.list = this.list.filter((o) => {
        const rx = o.x - s.x, ry = o.y - s.y;
        return Math.abs(rx * dx + ry * dy) > len / 2 || Math.abs(-rx * dy + ry * dx) > w / 2;
      });
      // the lit side: the edge whose normal faces the light
      let nx = -dy, ny = dx;
      if (nx * Math.cos(B.LIGHT) + ny * Math.sin(B.LIGHT) < 0) { nx = -nx; ny = -ny; }
      const strong = { knife: 0.26, sweep: 0.24, impasto: 0.3, dry: 0.13, hatch: 0.1 }[s.kind] || 0.2;
      this.list.push({ x: s.x, y: s.y, dx, dy, nx, ny, len, w, kind: s.kind, a0: strong, t0: now, life: rand(20, 40) * 1000,
        c: B.css(B.mix(s.color || [255, 255, 255], [255, 255, 255], 0.82)) });
      if (this.list.length > WET_MAX) this.list.splice(0, this.list.length - WET_MAX);
      this.last = 0;
    },
    reset() { this.list = []; if (this.g && this.drawn) { this.g.clearRect(0, 0, this.cv.width, this.cv.height); this.drawn = false; } },
    render(now) {
      if (!this.list.length && !this.drawn) return;
      if (now - this.last < 90) return;  // drying is slow: ~11 redraws a second is plenty
      this.last = now;
      const cv = this.cv, k = this.g;
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      k.clearRect(0, 0, W, H);
      this.list = this.list.filter((o) => now - o.t0 < o.life);
      if (!this.list.length) { this.drawn = false; return; }
      k.save();
      k.beginPath(); k.rect(region.x, region.y, region.w, region.h); k.clip();
      k.lineCap = "round";
      for (const o of this.list) {
        const f = 1 - (now - o.t0) / o.life, a = o.a0 * f * f;
        k.strokeStyle = k.fillStyle = o.c;
        if (o.kind === "impasto") {
          const r = Math.min(o.len, o.w) * 0.3;
          k.globalAlpha = a * 0.6;
          k.beginPath(); k.ellipse(o.x + o.nx * r * 0.4 - o.dx * r * 0.2, o.y + o.ny * r * 0.4 - o.dy * r * 0.2, r * 1.3, r * 0.7, Math.atan2(o.dy, o.dx), 0, B.TAU); k.fill();
          continue;
        }
        const L = o.len * 0.42;
        const band = (off, lw, al) => {
          k.globalAlpha = al; k.lineWidth = lw;
          k.beginPath(); k.moveTo(o.x - o.dx * L + o.nx * off, o.y - o.dy * L + o.ny * off);
          k.lineTo(o.x + o.dx * L * 0.8 + o.nx * off, o.y + o.dy * L * 0.8 + o.ny * off); k.stroke();
        };
        band(o.w * 0.2, Math.max(1, o.w * 0.22), a * 0.55);
        band(o.w * 0.3, Math.max(0.6, o.w * 0.06), a);
      }
      k.restore();
      this.drawn = true;
    },
  };

  // ---------- lifecycle ----------
  function prepare(ctx) {
    params = ctx.params || {};
    layout = document.documentElement.dataset.layout || "square";
    side = params.side || "left";
    document.documentElement.dataset.side = side;
    style = STYLES[params.strokes === "genre" ? genreStyle(ctx.track.genre) : "mixed"];
    // keyed on the cover image, not the song: the next track off the same album keeps painting the same canvas
    const rest = [layout, side, params.detail, params.level, params.ridge, params.strokes, innerWidth, innerHeight].join("|");
    const key = (ctx.track.coverKey || ctx.track.cover) + "|" + rest;
    if (key === paintKey) return null;
    const sameSize = paintKey.endsWith("|" + innerWidth + "|" + innerHeight);
    // only a new cover (same settings and size) gets the timelapse of the old painting
    const old = paintKey && rest === paintRest && record.length >= 40 ? { rec: record, cov, mem } : null;
    paintKey = key; paintRest = rest;
    return ready.then(async () => {
      const density = Wallpaper.live ? 1 : Math.min(2, devicePixelRatio || 1);
      if (p.pixelDensity() !== density) p.pixelDensity(density);
      if (p.width !== innerWidth || p.height !== innerHeight) p.resizeCanvas(innerWidth, innerHeight);
      g = p.drawingContext;
      cov = await B.cover(ctx.track.cover, 128);
      studio.tempo = 1 / Math.max(0.1, +params.speed || 0.7);
      // a still shows the painting at mid detail; the live layer starts from wherever the song is
      const progress = Wallpaper.live ? ctx.track.progress || 0 : Math.max(0.55, ctx.track.progress || 0);
      pending = { gradual: Wallpaper.live && painted && sameSize, progress, old };
      if (Wallpaper.live) setTimeout(flush, 0);
    });
  }

  function flush() {
    if (!pending) return;
    const { gradual, progress, old } = pending;
    pending = null;
    const lapse = gradual && old && params.timelapse !== false && !Wallpaper.paused && !document.hidden;
    paint(gradual, progress, lapse ? old : null);
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
    if (params.wetness === false) wet.reset(); else wet.render(performance.now());
  }

  Wallpaper.on("render", (ctx) => {
    const job = prepare(ctx);
    if (job && !Wallpaper.live) Wallpaper.hold(job);
    if (studio) { studio.tempo = 1 / Math.max(0.1, +ctx.params.speed || 0.7); sync(); }
  });
  Wallpaper.on("layout", () => { if (!Wallpaper.live) flush(); });
  Wallpaper.on("line", (ctx) => {
    if (!painted || !ctx.track.isPlaying || performance.now() < quietUntil) return;
    if (words.length) coverWords();
    const text = (ctx.lyrics.current || "").trim();
    if (!text) return;
    if (ctx.params.refine) refineBand();
    if (ctx.params.paintWords !== false && performance.now() - lastWordAt >= WORD_GAP) paintWord(text);
  });
  Wallpaper.on("beat", onBeat);
  Wallpaper.on("pause", sync);
  Wallpaper.on("resume", sync);
})();
