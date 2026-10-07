/*
 * Dot-matrix text on a canvas, from a built-in 5×7 bitmap font (the classic LCD/LED character set), so it needs no
 * font file and works offline. Letters are drawn upper-case; accents are dropped (É → E). A string with characters
 * the bitmap font doesn't have (Japanese, Arabic …) is sampled from the system font on a finer 14-dot grid instead.
 *
 *   DotMatrix.draw(canvas, text, { pitch, color, off, align, valign, rows, gap, lines })
 *     pitch  distance between dots in CSS px      color  lit dots      off  unlit dots (null = none)
 *     align  "left" | "center" | "right"          lines  an array of strings instead of text (one per row of type)
 *     gap    dots between rows of type (default 3)   clear  false to draw over what's there
 *   DotMatrix.measure(text) → width in dots        DotMatrix.wrap(text, maxDots, maxLines) → lines (ellipsis if cut)
 */
(function () {
  const F = {
    "A": "0E1111111F1111", "B": "1E11111E11111E", "C": "0E11101010110E", "D": "1C12111111121C", "E": "1F10101E10101F",
    "F": "1F10101E101010", "G": "0E1110171111 0F", "H": "1111111F111111", "I": "0E04040404040E", "J": "07020202021 20C",
    "K": "11121418141211", "L": "1010101010101F", "M": "111B1515111111", "N": "11111915131111", "O": "0E11111111110E",
    "P": "1E11111E101010", "Q": "0E111111151 20D", "R": "1E11111E141211", "S": "0F10100E01011E", "T": "1F040404040404",
    "U": "1111111111110E", "V": "11111111110A04", "W": "1111111515150A", "X": "11110A040A1111", "Y": "1111110A040404",
    "Z": "1F01020408101F",
    "0": "0E111315191 10E", "1": "040C040404040E", "2": "0E110102040 81F", "3": "1F020402011 10E", "4": "02060A121F0202",
    "5": "1F101E0101110E", "6": "0608101E11110E", "7": "1F010204080808", "8": "0E11110E11110E", "9": "0E11110F01020C",
    ".": "0000000000 0C0C", ",": "00000000 0C0408", "'": "0C040800000000", "’": "0C040800000000", "‘": "0C040800000000",
    ":": "000C0C000C0C00", ";": "000C0C000C0408", "-": "000000 1F000000", "–": "0000001F000000", "—": "0000001F000000",
    "!": "04040404000004", "?": "0E110102040004", "&": "0C1214081512 0D", "/": "00010204081000", "(": "02040808080402",
    ")": "08040202020408", "#": "0A0A1F0A1F0A0A", "\"": "0A0A0A00000000", "“": "0A0A0A00000000", "”": "0A0A0A00000000",
    "+": "0004041F040400", "·": "00000004000000", "•": "00000E0E0E0000", "%": "18190204081303", "*": "00040 A1F0A0400",
    "=": "00001F001F0000", "<": "02040810080402", ">": "08040201020408", "_": "0000000000001F", "$": "040F140E051E04",
    "@": "0E11010D15150E", "[": "0E08080808080E", "]": "0E02020202020E", "°": "0C12120C000000", "♪": "040605040C1C0C",
    "▸": "00080C0E0C0800", "→": "0004021F020400", "~": "00000815020000", "|": "04040404040404",
  };
  const GLYPH = {};
  for (const k in F) {
    const hex = F[k].replace(/\s/g, "").padEnd(14, "0");
    const rows = [];
    for (let r = 0; r < 7; r++) rows.push(parseInt(hex.substr(r * 2, 2), 16) & 31);
    // trim empty columns left/right (proportional spacing), keep at least one
    let lo = 0, hi = 4;
    const col = (c) => rows.some((v) => v & (16 >> c));
    while (lo < hi && !col(lo)) lo++;
    while (hi > lo && !col(hi)) hi--;
    GLYPH[k] = { rows, lo, w: hi - lo + 1 };
  }
  const SPACE = 3;

  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/ß/g, "SS").replace(/Æ/g, "AE").replace(/Œ/g, "OE").replace(/Ø/g, "O").replace(/Ł/g, "L").replace(/\s+/g, " ");
  const supported = (s) => [...s].every((c) => c === " " || GLYPH[c]);

  function measure(text) {
    const s = norm(text);
    if (!supported(s)) return fineWidth(s) / 2;
    let w = 0;
    [...s].forEach((c, k) => { w += (c === " " ? SPACE : GLYPH[c].w) + (k ? 1 : 0); });
    return w;
  }

  function wrap(text, maxDots, maxLines = 99) {
    const words = norm(text).trim().split(" ").filter(Boolean), out = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? cur + " " + w : w;
      if (measure(next) <= maxDots || !cur) cur = next;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    out.forEach((l, k) => { while (measure(out[k]) > maxDots && out[k].length > 1) out[k] = out[k].slice(0, -2) + "…"; });
    if (out.length > maxLines) {
      const keep = out.slice(0, maxLines);
      let last = keep[maxLines - 1] + "…";
      while (measure(last) > maxDots && last.length > 2) last = last.slice(0, -2) + "…";
      keep[maxLines - 1] = last.replace(/…+$/, "…");
      return keep;
    }
    return out;
  }
  GLYPH["…"] = { rows: [0, 0, 0, 0, 0, 0, 21], lo: 0, w: 5 };

  // ---------- fallback: sample the system font on a 14-row grid ----------
  let probe = null;
  function fineWidth(s) {
    probe = probe || document.createElement("canvas").getContext("2d");
    probe.font = "600 13px -apple-system, 'Hiragino Sans', sans-serif";
    return Math.ceil(probe.measureText(s).width);
  }
  function fineCells(s) {
    const w = fineWidth(s) + 2, c = document.createElement("canvas");
    c.width = w; c.height = 14;
    const g = c.getContext("2d");
    g.font = "600 13px -apple-system, 'Hiragino Sans', sans-serif";
    g.textBaseline = "alphabetic"; g.fillStyle = "#000";
    g.fillText(s, 1, 11.5);
    const d = g.getImageData(0, 0, w, 14).data, cells = [];
    for (let y = 0; y < 14; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 110) cells.push([x, y]);
    return { w, cells };
  }

  /** Lit cells of one row of type, in dots (x, y) with y 0..6 (or 0..13 at half pitch when `fine`). */
  function cellsOf(text) {
    const s = norm(text);
    if (!supported(s)) { const f = fineCells(s); return { w: f.w / 2, cells: f.cells, fine: true }; }
    const cells = [];
    let x = 0;
    [...s].forEach((c, k) => {
      if (k) x += 1;
      if (c === " ") { x += SPACE; return; }
      const g = GLYPH[c];
      for (let r = 0; r < 7; r++) for (let col = 0; col < g.w; col++) if (g.rows[r] & (16 >> (col + g.lo))) cells.push([x + col, r]);
      x += g.w;
    });
    return { w: x, cells, fine: false };
  }

  function draw(canvas, text, o = {}) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (o.clear !== false) g.clearRect(0, 0, W, H);
    const p = o.pitch || 4, r = p * (o.dot || 0.4), gap = o.gap ?? 3;
    const lines = o.lines || [text];
    const cols = Math.floor(W / p), rowsTotal = Math.floor(H / p);
    const ox = (W - cols * p) / 2 + p / 2, oy = (H - rowsTotal * p) / 2 + p / 2;
    if (o.off) {
      g.fillStyle = o.off;
      g.beginPath();
      for (let y = 0; y < rowsTotal; y++) for (let x = 0; x < cols; x++) { g.moveTo(ox + x * p + r, oy + y * p); g.arc(ox + x * p, oy + y * p, r, 0, 6.2832); }
      g.fill();
    }
    const blockRows = lines.length * 7 + (lines.length - 1) * gap;
    const top = o.valign === "top" ? 0 : o.valign === "bottom" ? rowsTotal - blockRows : Math.floor((rowsTotal - blockRows) / 2);
    g.fillStyle = o.color || "#fff";
    g.beginPath();
    lines.forEach((line, n) => {
      const c = cellsOf(line);
      const w = Math.ceil(c.w);
      const left = o.align === "center" ? Math.floor((cols - w) / 2) : o.align === "right" ? cols - w : 0;
      const y0 = top + n * (7 + gap);
      if (c.fine) {
        const q = p / 2, rr = r / 2 * 1.15;
        for (const [x, y] of c.cells) { const cx = ox - p / 4 + left * p + x * q, cy = oy - p / 4 + y0 * p + y * q; g.moveTo(cx + rr, cy); g.arc(cx, cy, rr, 0, 6.2832); }
      } else {
        for (const [x, y] of c.cells) {
          if (left + x < 0 || left + x >= cols) continue;
          const cx = ox + (left + x) * p, cy = oy + (y0 + y) * p;
          g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, 6.2832);
        }
      }
    });
    g.fill();
  }

  window.DotMatrix = { draw, measure, wrap, norm };
})();
