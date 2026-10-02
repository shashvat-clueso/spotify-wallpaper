#!/usr/bin/env python3
"""Spotify Wallpaper: sets your macOS wallpaper to the current song's art + live synced lyrics.

Usage:  python3 spotify_wallpaper.py [--style card|poster|minimal|glow]
"""

import argparse
import os
import colorsys
import io
import json
import random
import re
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import objc
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

POLL_SECONDS = 0.4
LYRIC_LEAD = 0.25  # show a line slightly early, wallpaper swaps aren't instant
OUT_DIR = Path.home() / "Library" / "Caches" / "spotify-wallpaper"
CACHE_DIR = OUT_DIR / "lyrics"
STATE_FILE = OUT_DIR / "original_wallpapers.json"
STYLES = ("card", "poster", "minimal", "glow")

FONTS = {
    "sans": "/System/Library/Fonts/SFNS.ttf",
    "serif": "/System/Library/Fonts/NewYork.ttf",
    "serif-italic": "/System/Library/Fonts/NewYorkItalic.ttf",
    "mono": "/System/Library/Fonts/SFNSMono.ttf",
}
FALLBACK_FONT = "/System/Library/Fonts/HelveticaNeue.ttc"

SPOTIFY_SCRIPT = '''
if application "Spotify" is running then
  tell application "Spotify"
    if player state is stopped then return "STOPPED"
    set t to current track
    set d to ASCII character 31
    return (id of t) & d & (name of t) & d & (artist of t) & d & (album of t) & d & (artwork url of t) & d & (duration of t) & d & (player position as text) & d & (player state as text)
  end tell
end if
return "NOT_RUNNING"
'''

def osascript(script, *args, js=False):
    cmd = ["osascript"] + (["-l", "JavaScript"] if js else []) + ["-e", script] + list(args)
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()


# ---------- Spotify ----------

def now_playing():
    out = osascript(SPOTIFY_SCRIPT)
    if not out or out in ("STOPPED", "NOT_RUNNING"):
        return None
    parts = out.split("\x1f")
    if len(parts) != 8:
        return None
    tid, name, artist, album, art, dur, pos, state = parts
    return {
        "id": tid, "name": name, "artist": artist, "album": album, "art": art,
        "duration": int(dur) / 1000, "position": float(pos.replace(",", ".")),
        "playing": state == "playing",
    }


# ---------- Lyrics (LRCLIB) ----------

def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "spotify-wallpaper/1.0"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return r.read()


def parse_lrc(text):
    lines = []
    for raw in text.splitlines():
        stamps = re.findall(r"\[(\d+):(\d+(?:\.\d+)?)\]", raw)
        lyric = re.sub(r"\[[^\]]*\]", "", raw).strip()
        for m, s in stamps:
            lines.append((int(m) * 60 + float(s), lyric))
    return sorted(lines)


def fetch_lyrics(track):
    """Returns a list of (seconds, line) and whether it's truly synced."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / (re.sub(r"[^\w]", "_", track["id"]) + ".json")
    if cache.exists():
        data = json.loads(cache.read_text())
    else:
        q = {"track_name": track["name"], "artist_name": track["artist"],
             "album_name": track["album"], "duration": round(track["duration"])}
        try:
            data = json.loads(http_get("https://lrclib.net/api/get?" + urllib.parse.urlencode(q)))
        except Exception:
            # fall back to a fuzzy search with a cleaned-up title ("Song - Remastered 2011" -> "Song")
            clean = re.split(r" - | \(feat", track["name"])[0]
            try:
                results = json.loads(http_get("https://lrclib.net/api/search?" + urllib.parse.urlencode(
                    {"track_name": clean, "artist_name": track["artist"]})))
                results.sort(key=lambda r: (not r.get("syncedLyrics"),
                                            abs((r.get("duration") or 0) - track["duration"])))
                data = results[0] if results else {}
            except Exception:
                return [], False  # network issue: don't cache, try again next time
        cache.write_text(json.dumps(data or {}))
    if data.get("syncedLyrics"):
        return parse_lrc(data["syncedLyrics"]), True
    if data.get("plainLyrics"):
        # no timestamps: spread lines evenly across the song as a rough guess
        lines = [l.strip() for l in data["plainLyrics"].splitlines() if l.strip()]
        start, end = track["duration"] * 0.08, track["duration"] * 0.95
        step = (end - start) / max(1, len(lines))
        return [(start + i * step, l) for i, l in enumerate(lines)], False
    return [], False


def current_line_index(lines, pos):
    idx = -1
    for i, (t, _) in enumerate(lines):
        if t <= pos + LYRIC_LEAD:
            idx = i
        else:
            break
    return idx


# ---------- Drawing helpers ----------

_font_cache = {}


def font(kind, size, weight="Regular"):
    key = (kind, size, weight)
    if key not in _font_cache:
        try:
            f = ImageFont.truetype(FONTS[kind], size)
            try:
                f.set_variation_by_name(weight)
            except Exception:
                pass
        except Exception:
            f = ImageFont.truetype(FALLBACK_FONT, size)
        _font_cache[key] = f
    return _font_cache[key]


def fetch_art(url):
    return Image.open(io.BytesIO(http_get(url))).convert("RGB")


def palette(art, n=5):
    """Dominant colors of the cover, most common first, skipping near-duplicates."""
    q = art.resize((96, 96)).quantize(colors=12, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()
    counts = sorted(q.getcolors(), reverse=True)
    out = []
    for _, i in counts:
        c = tuple(pal[i * 3:i * 3 + 3])
        if all(sum(abs(a - b) for a, b in zip(c, o)) > 60 for o in out):
            out.append(c)
        if len(out) == n:
            break
    while len(out) < n:
        out.append(out[-1] if out else (40, 40, 40))
    return out


def vivid(colors):
    """Sort colors by saturation*brightness so the gradient isn't muddy."""
    def score(c):
        mx, mn = max(c), min(c)
        return (mx - mn) * 0.7 + mx * 0.3
    return sorted(colors, key=score, reverse=True)


def cover_crop(img, w, h, zoom=1.0):
    scale = max(w / img.width, h / img.height) * zoom
    r = img.resize((int(img.width * scale) + 1, int(img.height * scale) + 1), Image.LANCZOS)
    l, t = (r.width - w) // 2, (r.height - h) // 2
    return r.crop((l, t, l + w, t + h))


def grain(img, amount=10):
    noise = Image.effect_noise((img.width // 2, img.height // 2), 64).resize(img.size).convert("RGB")
    return Image.blend(img, ImageEnhance.Brightness(noise).enhance(1.0), amount / 255)


def vignette(w, h, strength=200):
    m = Image.new("L", (256, 256), 0)
    ImageDraw.Draw(m).ellipse((-40, -60, 296, 316), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(50)).resize((w, h))
    dark = Image.new("RGBA", (w, h), (0, 0, 0, strength))
    dark.putalpha(Image.eval(m, lambda v: int(strength * (1 - v / 255))))
    return dark


def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for word in words:
        trial = (cur + " " + word).strip()
        if draw.textlength(trial, font=fnt) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines or [""]


def fit(draw, text, fnt, max_w):
    if draw.textlength(text, font=fnt) <= max_w:
        return text
    while text and draw.textlength(text + "…", font=fnt) > max_w:
        text = text[:-1]
    return text.rstrip() + "…"


def paste_cover(img, art, x, y, size, radius=0.03, shadow=True):
    r = int(size * radius)
    if shadow:
        pad = int(size * 0.25)
        sh = Image.new("RGBA", (size + pad * 2, size + pad * 2), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle((pad, pad + size // 25, pad + size, pad + size + size // 25),
                                             radius=r, fill=(0, 0, 0, 150))
        sh = sh.filter(ImageFilter.GaussianBlur(size // 18))
        img.paste(sh, (x - pad, y - pad), sh)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size, size), radius=r, fill=255)
    img.paste(art.resize((size, size), Image.LANCZOS), (x, y), mask)


def mmss(s):
    s = max(0, int(s))
    return f"{s // 60}:{s % 60:02d}"


def lyric_or_note(text):
    return text if text.strip() else "• • •"


# ---------- Style: glow (Apple Music-style full-screen lyrics) ----------

def bg_glow(art, w, h):
    cols = vivid(palette(art, 5))
    sw, sh = 320, int(320 * h / w)
    base = tuple(int(c * 0.35) for c in cols[-1])
    canvas = Image.new("RGB", (sw, sh), base)
    d = ImageDraw.Draw(canvas)
    rnd = random.Random(hash(art.tobytes()[:2000]))
    spots = [(0.15, 0.25), (0.85, 0.2), (0.7, 0.85), (0.2, 0.9), (0.5, 0.5)]
    for c, (fx, fy) in zip(cols, spots):
        rad = sw * rnd.uniform(0.35, 0.55)
        cx, cy = fx * sw + rnd.uniform(-20, 20), fy * sh + rnd.uniform(-20, 20)
        d.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=c)
    canvas = canvas.filter(ImageFilter.GaussianBlur(sw * 0.12)).resize((w, h), Image.BICUBIC)
    canvas = ImageEnhance.Brightness(ImageEnhance.Color(canvas).enhance(1.25)).enhance(0.55)
    return grain(canvas, 9)


def render_glow(t, art, bg, lines, synced, idx, w, h):
    img = bg.copy()
    d = ImageDraw.Draw(img, "RGBA")
    unit = min(w, h)
    margin = int(w * 0.07)

    cover = int(unit * 0.46)
    cx, cy = margin, (h - cover) // 2 - int(unit * 0.04)
    paste_cover(img, art, cx, cy, cover)
    ty = cy + cover + int(unit * 0.04)
    d.text((cx, ty), fit(d, t["name"], font("sans", int(unit * 0.032), "Bold"), cover),
           font=font("sans", int(unit * 0.032), "Bold"), fill=(255, 255, 255, 255))
    d.text((cx, ty + int(unit * 0.045)), fit(d, t["artist"], font("sans", int(unit * 0.024), "Medium"), cover),
           font=font("sans", int(unit * 0.024), "Medium"), fill=(255, 255, 255, 160))
    # progress bar
    by = ty + int(unit * 0.095)
    frac = min(1, t["position"] / max(1, t["duration"]))
    d.rounded_rectangle((cx, by, cx + cover, by + 6), radius=3, fill=(255, 255, 255, 60))
    d.rounded_rectangle((cx, by, cx + max(6, int(cover * frac)), by + 6), radius=3, fill=(255, 255, 255, 220))

    lx = cx + cover + int(w * 0.065)
    lw = min(w - lx - margin, int(unit * 1.1))
    if not lines:
        d.text((lx, h // 2), "No lyrics found", font=font("sans", int(unit * 0.04), "Semibold"),
               fill=(255, 255, 255, 110), anchor="lm")
        return img

    big = font("sans", int(unit * 0.058), "Heavy")
    dim = font("sans", int(unit * 0.058), "Heavy")
    lh, gap = int(big.size * 1.12), int(unit * 0.03)
    cur = wrap(d, lyric_or_note(lines[idx][1]) if idx >= 0 else "• • •", big, lw)
    block = lh * len(cur)
    y = h // 2 - block // 2
    for ln in cur:
        d.text((lx, y), ln, font=big, fill=(255, 255, 255, 255))
        y += lh
    y += gap
    for k, i in enumerate(range(idx + 1, len(lines))):
        alpha = int(115 * (0.72 ** k))
        for ln in wrap(d, lyric_or_note(lines[i][1]), dim, lw):
            if y + lh > h - margin * 0.6:
                break
            d.text((lx, y), ln, font=dim, fill=(255, 255, 255, alpha))
            y += lh
        y += gap
    y = h // 2 - block // 2 - gap
    for k, i in enumerate(range(idx - 1, -1, -1)):
        wl = wrap(d, lyric_or_note(lines[i][1]), dim, lw)
        y -= lh * len(wl)
        if y < margin * 0.6:
            break
        for j, ln in enumerate(wl):
            d.text((lx, y + j * lh), ln, font=dim, fill=(255, 255, 255, int(55 * (0.6 ** k))))
        y -= gap
    if not synced:
        d.text((w - margin, h - margin // 2), "lyrics timing approximate",
               font=font("sans", int(unit * 0.014), "Medium"), fill=(255, 255, 255, 70), anchor="rs")
    return img


# ---------- Style: card (Pinterest "Spotify lyric card" pins) ----------

def card_color(art):
    """A saturated mid-dark color from the cover that white text reads well on, like Spotify's lyric cards."""
    best = vivid(palette(art, 6))[0]
    h_, l, s = colorsys.rgb_to_hls(*(c / 255 for c in best))
    l = min(max(l, 0.30), 0.42)
    s = min(1.0, max(s, 0.35))
    return tuple(int(c * 255) for c in colorsys.hls_to_rgb(h_, l, s))


def bg_card(art, w, h):
    base = card_color(art)
    bg = cover_crop(art, w // 10, h // 10, zoom=1.2).filter(ImageFilter.GaussianBlur(4)).resize((w, h), Image.BICUBIC)
    bg = Image.blend(ImageEnhance.Brightness(bg).enhance(0.55), Image.new("RGB", (w, h), base), 0.35)
    bg = ImageEnhance.Brightness(bg).enhance(0.6)
    return grain(bg, 10)


def render_card(t, art, bg, lines, synced, idx, w, h):
    img = bg.copy()
    unit = min(w, h)
    color = card_color(art)
    cw = int(unit * 0.66)
    p = int(unit * 0.045)
    inner = cw - p * 2
    lf = font("sans", int(unit * 0.040), "Bold")
    lh = int(lf.size * 1.22)
    scratch = ImageDraw.Draw(img)

    # lyric rows: one line of context above, then current + upcoming, Spotify-style colors
    rows = []
    if lines:
        start = max(0, idx - 1) if idx >= 0 else 0
        for i in range(start, len(lines)):
            state = "past" if i < idx else "now" if i == idx else "next"
            for ln in wrap(scratch, lyric_or_note(lines[i][1]), lf, inner):
                rows.append((ln, state))
            if len(rows) >= 7:
                break
        rows = rows[:7]
    else:
        rows = [("No lyrics found", "next")]

    thumb = int(unit * 0.062)
    header_h = thumb + int(unit * 0.04)
    footer_h = int(unit * 0.07)
    ch = p + header_h + len(rows) * lh + footer_h + p // 2
    x0, y0 = (w - cw) // 2, (h - ch) // 2

    # card + soft shadow
    sh = Image.new("RGBA", (cw + p * 4, ch + p * 4), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((p * 2, p * 2 + p // 3, p * 2 + cw, p * 2 + ch + p // 3),
                                         radius=int(unit * 0.03), fill=(0, 0, 0, 120))
    sh = sh.filter(ImageFilter.GaussianBlur(p * 0.8))
    img.paste(sh, (x0 - p * 2, y0 - p * 2), sh)
    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle((x0, y0, x0 + cw, y0 + ch), radius=int(unit * 0.03), fill=color + (255,))

    # header: thumbnail + title / artist
    paste_cover(img, art, x0 + p, y0 + p, thumb, radius=0.08, shadow=False)
    tf, af = font("sans", int(unit * 0.022), "Bold"), font("sans", int(unit * 0.019), "Medium")
    tx = x0 + p + thumb + int(unit * 0.02)
    d.text((tx, y0 + p + thumb * 0.12), fit(d, t["name"], tf, cw - (tx - x0) - p), font=tf, fill=(255, 255, 255, 255))
    d.text((tx, y0 + p + thumb * 0.56), fit(d, t["artist"], af, cw - (tx - x0) - p), font=af, fill=(255, 255, 255, 185))

    y = y0 + p + header_h
    fills = {"past": (255, 255, 255, 140), "now": (255, 255, 255, 255), "next": (0, 0, 0, 135)}
    for ln, state in rows:
        d.text((x0 + p, y), ln, font=lf, fill=fills[state])
        y += lh

    # footer: progress
    fy = y0 + ch - p // 2 - footer_h // 2
    frac = min(1, t["position"] / max(1, t["duration"]))
    bar_w = cw - p * 2
    th = max(4, unit // 300)
    d.rounded_rectangle((x0 + p, fy, x0 + p + bar_w, fy + th), radius=th, fill=(255, 255, 255, 70))
    d.rounded_rectangle((x0 + p, fy, x0 + p + max(th, int(bar_w * frac)), fy + th), radius=th, fill=(255, 255, 255, 230))
    mf = font("sans", int(unit * 0.015), "Medium")
    d.text((x0 + p, fy + int(unit * 0.018)), mmss(t["position"]), font=mf, fill=(255, 255, 255, 170))
    d.text((x0 + cw - p, fy + int(unit * 0.018)), mmss(t["duration"]), font=mf, fill=(255, 255, 255, 170), anchor="ra")
    return img


# ---------- Style: poster (Pinterest "minimalist album poster" pins) ----------

def bg_poster(art, w, h):
    tint = palette(art, 1)[0]
    paper = tuple(int(226 * 0.95 + c * 0.05) for c in (232, 228, 219))
    paper = tuple(int(p * 0.96 + c * 0.04) for p, c in zip(paper, tint))
    return grain(Image.new("RGB", (w, h), paper), 12)


def render_poster(t, art, bg, lines, synced, idx, w, h):
    img = bg.copy()
    d = ImageDraw.Draw(img, "RGBA")
    unit = min(w, h)
    ink, grey = (28, 28, 28, 255), (28, 28, 28, 120)
    margin = int(unit * 0.11)

    cover = min(h - margin * 2, int(w * 0.40))
    gutter = int(unit * 0.07)
    total_w = cover + gutter + int(unit * 0.95)
    cx = max(margin, (w - total_w) // 2)
    cy = (h - cover) // 2
    img.paste(art.resize((cover, cover), Image.LANCZOS), (cx, cy))
    d.rectangle((cx, cy, cx + cover, cy + cover), outline=(0, 0, 0, 25), width=2)

    x = cx + cover + gutter
    right = min(w - margin, x + int(unit * 0.95))
    tw = right - x
    y = cy - int(unit * 0.01)

    # big condensed title with the track length tucked next to it, like the year on the pins
    small = font("sans", int(unit * 0.03), "Compressed Semibold")
    size = int(unit * 0.15)
    while True:
        tf = font("sans", size, "Compressed Bold")
        tl = wrap(d, t["name"].upper(), tf, tw - d.textlength(" 0:00", font=small))
        if len(tl) <= 2 or size < unit * 0.06:
            break
        size = int(size * 0.9)
    tl = tl[:2]
    for k, ln in enumerate(tl):
        ln = fit(d, ln, tf, tw)
        d.text((x, y), ln, font=tf, fill=ink)
        if k == len(tl) - 1:
            end = x + d.textlength(ln, font=tf) + unit * 0.012
            d.text((end, y + tf.getbbox(ln)[3]), mmss(t["duration"]), font=small, fill=ink, anchor="ls")
        y += int(size * 0.9)
    y += int(unit * 0.035)
    bf = font("sans", int(unit * 0.021), "Condensed Medium")
    d.text((x, y), fit(d, f"by {t['artist']}  •  {t['album']}", bf, tw), font=bf, fill=ink)
    y += int(unit * 0.05)

    # lyrics laid out like the tracklist block: condensed caps, current line in ink
    lf = font("sans", int(unit * 0.021), "Condensed Medium")
    lb = font("sans", int(unit * 0.021), "Condensed Black")
    llh = int(lf.size * 1.32)
    swatch_h = int(unit * 0.05)
    footer_top = cy + cover - swatch_h - int(unit * 0.085)
    if lines:
        rows = max(1, (footer_top - y) // llh)
        start = max(0, min(idx - 2, len(lines) - rows))
        for i in range(start, min(len(lines), start + rows)):
            txt = lyric_or_note(lines[i][1]).upper()
            d.text((x, y), fit(d, txt, lb if i == idx else lf, tw), font=lb if i == idx else lf,
                   fill=ink if i == idx else grey)
            y += llh
    else:
        d.text((x, y), "NO LYRICS FOUND", font=lf, fill=grey)

    # flat color swatches with hex codes
    sy = footer_top + int(unit * 0.01)
    cols = palette(art, 5)
    gap = int(unit * 0.008)
    sw = (tw - gap * 4) // 5
    hf = font("mono", int(unit * 0.011), "Regular")
    for i, c in enumerate(cols):
        sx = x + i * (sw + gap)
        d.rectangle((sx, sy, sx + sw, sy + swatch_h), fill=c + (255,))
        d.text((sx, sy + swatch_h + int(unit * 0.008)), "#%02X%02X%02X" % c, font=hf, fill=grey)

    # footer corners, like LABEL / RELEASED ON
    ff = font("sans", int(unit * 0.016), "Condensed Bold")
    fy = cy + cover - ff.size
    d.text((x, fy), f"NOW PLAYING  {mmss(t['position'])}", font=ff, fill=ink)
    d.text((right, fy), f"TRACK LENGTH  {mmss(t['duration'])}", font=ff, fill=ink, anchor="ra")
    return img


# ---------- Style: minimal (Pinterest small-type lyric wallpapers) ----------

def bg_minimal(art, w, h):
    c = vivid(palette(art, 4))[0]
    h_, l, s = colorsys.rgb_to_hls(*(v / 255 for v in c))
    deep = tuple(int(v * 255) for v in colorsys.hls_to_rgb(h_, min(l, 0.32), min(1, s * 1.1)))
    sw, sh = 240, int(240 * h / w)
    g = Image.new("RGB", (sw, sh), (8, 8, 10))
    ImageDraw.Draw(g).ellipse((sw * -0.1, sh * 0.15, sw * 0.75, sh * 1.3), fill=deep)
    g = g.filter(ImageFilter.GaussianBlur(sw * 0.16)).resize((w, h), Image.BICUBIC)
    return grain(g, 16)


def waveform(d, cx, cy, width, height, seed, color):
    rnd = random.Random(seed)
    n = 56
    step = width / n
    bw = max(2, int(step * 0.45))
    for i in range(n):
        env = 0.25 + 0.75 * (1 - abs(i - n / 2) / (n / 2)) ** 0.6
        bh = max(bw, height * env * rnd.uniform(0.25, 1.0))
        x = cx - width / 2 + i * step
        d.rounded_rectangle((x, cy - bh / 2, x + bw, cy + bh / 2), radius=bw // 2, fill=color)


def render_minimal(t, art, bg, lines, synced, idx, w, h):
    img = bg.copy()
    d = ImageDraw.Draw(img, "RGBA")
    unit = min(w, h)
    lw = int(unit * 0.9)
    cx = w // 2

    cs = int(unit * 0.11)
    paste_cover(img, art, cx - cs // 2, int(h * 0.5 - unit * 0.27), cs, radius=0.04, shadow=True)

    if lines:
        cur = lyric_or_note(lines[idx][1]) if idx >= 0 else "• • •"
    else:
        cur = t["name"]
    qf = font("serif", int(unit * 0.036), "Regular")
    y = int(h * 0.5 - unit * 0.07)
    for ln in wrap(d, cur, qf, lw)[:3]:
        d.text((cx, y), ln, font=qf, fill=(255, 255, 255, 240), anchor="ma")
        y += int(qf.size * 1.3)
    if lines and idx + 1 < len(lines):
        mf = font("mono", int(unit * 0.017), "Regular")
        d.text((cx, y + int(unit * 0.02)), fit(d, lyric_or_note(lines[idx + 1][1]), mf, lw),
               font=mf, fill=(255, 255, 255, 105), anchor="ma")
        y += int(unit * 0.05)

    waveform(d, cx, y + int(unit * 0.09), int(unit * 0.26), int(unit * 0.07), (t["id"], idx), (255, 255, 255, 220))

    sf = font("mono", int(unit * 0.014), "Regular")
    label = f"{t['name']}  —  {t['artist']}".lower()
    d.text((cx, h - int(unit * 0.08)), fit(d, label, sf, lw), font=sf, fill=(255, 255, 255, 120), anchor="ms")
    return img


RENDERERS = {
    "card": (bg_card, render_card),
    "poster": (bg_poster, render_poster),
    "minimal": (bg_minimal, render_minimal),
    "glow": (bg_glow, render_glow),
}


# ---------- Wallpaper ----------
# macOS only lets an app set the wallpaper of the Space you're currently on. So we set it on every
# lyric change, and again the instant you switch Spaces, which means whatever Space you're looking at is
# always up to date. Each screen uses two files we alternate between: the API needs a file URL, and
# re-setting the same path doesn't refresh because macOS caches by path.

import AppKit
from Foundation import NSDate, NSObject, NSRunLoop

WS = AppKit.NSWorkspace.sharedWorkspace()


def get_screens():
    out = []
    for sc in AppKit.NSScreen.screens():
        f, scale = sc.frame(), sc.backingScaleFactor()
        cur = WS.desktopImageURLForScreen_(sc)
        out.append({"w": f.size.width * scale, "h": f.size.height * scale,
                    "current": cur.path() if cur else None})
    return out


def set_wallpapers(paths):
    for sc, p in zip(AppKit.NSScreen.screens(), paths):
        if p:
            WS.setDesktopImageURL_forScreen_options_error_(AppKit.NSURL.fileURLWithPath_(p), sc, {}, None)


class Frames:
    """The latest rendered frame per screen, written to alternating A/B files."""

    def __init__(self):
        self.images, self.slot, self.paths = [], 0, []

    def show(self, images=None):
        if images is not None:
            self.images = images
        if not self.images:
            return
        self.slot ^= 1
        self.paths = []
        for i, img in enumerate(self.images):
            p = OUT_DIR / f"wall_{i}_{'ab'[self.slot]}.jpg"
            img.save(p, quality=92)
            self.paths.append(str(p))
        set_wallpapers(self.paths)


class SpaceWatcher(NSObject):
    def initWithCallback_(self, cb):
        self = objc.super(SpaceWatcher, self).init()
        self.cb = cb
        WS.notificationCenter().addObserver_selector_name_object_(
            self, "spaceChanged:", AppKit.NSWorkspaceActiveSpaceDidChangeNotification, None)
        return self

    def spaceChanged_(self, _note):
        self.cb()


def pump(seconds):
    """Sleep while letting macOS deliver Space-change notifications."""
    NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(seconds))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--style", choices=STYLES, default="card")
    args = ap.parse_args()
    make_bg, render = RENDERERS[args.style]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("wall_*_[0-9]*.jpg"):  # frames left over from the old one-file-per-frame version
        old.unlink(missing_ok=True)
    screens = get_screens()
    if not screens:
        sys.exit("Couldn't read screen info.")

    # remember the user's real wallpaper so we can put it back on exit (never one of our own frames)
    if not STATE_FILE.exists():
        STATE_FILE.write_text(json.dumps([
            s["current"] if s["current"] and str(OUT_DIR) not in s["current"] else None for s in screens]))
    originals = json.loads(STATE_FILE.read_text())

    frames = Frames()
    watcher = SpaceWatcher.alloc().initWithCallback_(lambda: frames.show())  # noqa: F841 (keep alive)

    def restore(*_):
        print("\nRestoring original wallpaper.")
        # Spaces we can't reach still point at our A/B files, so put the original image in them too
        for i, orig in enumerate(originals):
            if orig and os.path.exists(orig):
                try:
                    im = Image.open(orig).convert("RGB")
                    for s in "ab":
                        im.save(OUT_DIR / f"wall_{i}_{s}.jpg", quality=92)
                except Exception:
                    pass
        set_wallpapers([p or "" for p in originals])
        STATE_FILE.unlink(missing_ok=True)
        sys.exit(0)

    signal.signal(signal.SIGINT, restore)
    signal.signal(signal.SIGTERM, restore)

    track_id, art, bgs, lines, synced = None, None, {}, [], False
    last_key, last_screen_check = None, time.time()
    print(f"Listening to Spotify ({args.style} style)… Ctrl+C to stop and restore your wallpaper.")

    while True:
        try:
            t = now_playing()
            if time.time() - last_screen_check > 10:  # handle monitors being plugged/unplugged
                new = get_screens()
                if new and [(s["w"], s["h"]) for s in new] != [(s["w"], s["h"]) for s in screens]:
                    screens, bgs, last_key = new, {}, None
                last_screen_check = time.time()

            if not t:
                pump(1)
                continue

            if t["id"] != track_id:
                print(f"♪ {t['name']} — {t['artist']}")
                art = fetch_art(t["art"])
                bgs = {}
                lines, synced = fetch_lyrics(t)
                track_id = t["id"]
                print("   lyrics:", "synced" if synced else "approximate" if lines else "none")

            idx = current_line_index(lines, t["position"])
            # poster/glow show a progress bar, so refresh at least every 10s even in instrumentals
            key = (track_id, idx, int(t["position"] // 10))
            if key != last_key:
                last_key = key
                images = []
                for s in screens:
                    w, h = int(s["w"]), int(s["h"])
                    if (w, h) not in bgs:
                        bgs[(w, h)] = make_bg(art, w, h)
                    images.append(render(t, art, bgs[(w, h)], lines, synced, idx, w, h))
                frames.show(images)
            pump(POLL_SECONDS)
        except Exception as e:
            print("error:", e)
            pump(2)


if __name__ == "__main__":
    main()
