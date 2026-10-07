# Changelog

All notable changes to Spotify Wallpaper. Versions follow [semantic versioning](https://semver.org).

## 1.4.1 — 2026-10-07

### Added
- **More kinds of stroke in Painted Cover:** curved sweeps, raised impasto dabs, dry brush and hatching join the knife
  slabs. A new **Strokes** setting mixes them (slabs and sweeps block in, dry brush models, impasto and hatching pick
  out detail) or uses one kind throughout. The brush library gains `studio.sweep`, `studio.impasto`, `studio.hatch`
  and `studio.dry`.

### Changed
- Painted Cover and Brushwork only start a new painting when the **cover** changes, so the next song from the same
  album keeps painting the same canvas instead of starting over.
- Painted Cover Wide: film grain sits on the song card only (on by default), never over the painting; the lyrics fill
  whatever height the title leaves, so the "Lines after" setting is gone. Painted Cover's grain sits behind the
  painting, on the background.

### Fixed
- Skipping or seeking a song sometimes put your own wallpaper back for a moment. A single empty reading from Spotify
  no longer counts as "stopped"; your wallpaper comes back once nothing has played for about 5 seconds.

## 1.4.0 — 2026-10-04

### Added
- **Brushwork** template: a living oil painting made from the cover with p5.js bristle brushes, in four styles
  (Swirling Night, Impasto Jungle, Ink, Wave & Gold, Paisley Tapestry). The title, artist and synced lyrics sit on a
  calm field of paint that the busy strokes stop at, so the text reads on any cover; every new lyric line adds a
  star, a flower, an ink splash or a paisley. A new song is painted over the
  old one slowly, and the still wallpaper is the finished painting. Settings for painting speed, text side and fonts.
- **Painted Cover** and **Painted Cover Wide** templates: the cover itself repainted as a coarse knife painting in
  sharp, flat strokes that follow the image's edges, with the song set in Helvetica Neue beside it (or on a solid
  panel over a full-screen painting). Detail grows as the song plays (or stays fixed), a new song is painted over the
  last one coarse to fine, and each lyric line repaints a band.
- For code templates: p5.js 1.9.4 (`/runtime/vendor/p5.min.js`), a brush library (`/runtime/brush.js`) with eased,
  time-based bristle and knife strokes, masks and clipping, and cover sampling (colour, detail, edge direction), and
  `/runtime/cover-painter.js`, the engine behind the Painted Cover templates.
- Runtime hooks: `track`, `pause` and `resume` events, `Wallpaper.live`, `Wallpaper.paused`, `Wallpaper.fps`, and
  `Wallpaper.hold(promise)` to make a still wait for async work such as painting.

## 1.3.2 — 2026-10-03

### Added
- **What's New** window (menu → What's New…) showing this changelog. It opens once after the app updates itself.
- `CHANGELOG.md` in the repository.

## 1.3.1 — 2026-10-03

### Added
- **Follow time** in the Template Builder: make any layer rotate, move, grow or fade with the song's progress, each lyric line, or the real clock (seconds, minutes, hours, day), around a pivot you choose. Runs on the GPU.
- **Analog Clock** starter, with hands that follow the real time.
- **Variables in text**: write `Now playing {{track.title}} · {{time.clock}}`, or use the **＋** next to a Text layer's text to insert song, lyric and time variables.
- **More display sizes** to preview designs at: your own screens plus MacBook Air/Pro, iMac, Studio Display, Pro Display XDR, 1080p, 1440p, 1600p, 4K, ultrawide, super-ultrawide and portrait.
- For code templates: `data-follow` maps any CSS animation onto the song, the current line or the clock; `data-template` mixes variables into text. Templates made with **Edit Code** start with a reference of every variable, attribute and hook.

## 1.3.0 — 2026-10-03

### Added
- **Template Builder**, a Figma-style editor for making templates without code: draw text, lyrics, the album cover, images, shapes (rectangle, ellipse, line, triangle, star, polygon, arrow), a vinyl record, a progress bar, a waveform and color swatches on a live canvas.
- Builder layers panel (reorder, rename, hide, lock), right-click menu, copy/paste, undo/redo, snapping and autosave.
- Builder design panel: alignment, rotation, opacity, corner radius, blend modes, typography, fills (solid, gradient, album cover, image), colors that follow each song's cover, stroke, drop shadow, blur, frosted glass and looping motion.
- **Edit Code**: turns a Builder design into an HTML/CSS template and opens it in your code editor.
- Four new animated templates: **Vinyl**, **Typewriter**, **Lock Screen** and **Visualizer**.
- Time variables for code templates (`time.song`, `time.line`, `time.clock`, `time.date`, `--song-time`, `--line-time`), plus `tick` and `line` events.

### Changed
- Redesigned the Customize window and the Builder with a shared design system. Their title bars now hold the window controls.
- **Much lighter**: CPU use while animating dropped from ~30–60% to ~1–5% at a steady 60 fps.
  - Spotify is read on a background thread, driven by its playback notifications.
  - Lyric lines change on timers set for their exact timestamps.
  - The progress bar, karaoke sweep and waveform run on the GPU compositor.
  - The cover is blurred once per song.
  - Film grain is a precomputed image.
  - Everything pauses when windows cover the desktop.

## 1.2.0 — 2026-10-03

### Added
- **Automatic updates** from GitHub releases. The download is checked against GitHub's SHA-256 checksum and the app's signature before installing. Menu items: **Check for Updates…** and **Automatically Install Updates**.

### Fixed
- The Customize window can be moved by dragging its title bar again.

## 1.1.1 — 2026-10-02

### Fixed
- Better lyrics for non-English songs: a remix, live, acoustic or language version only matches the same kind of version, and a source has to match a good share of lines to count.
- Credit lines in Japanese, traditional Chinese, Korean and English are filtered out.
- Right-to-left lyrics (Arabic, Hebrew) flow and align correctly.

## 1.1.0 — 2026-10-02

### Added
- Lyrics from four sources: **LRCLIB, NetEase Cloud Music, QQ Music and Kugou**, searched in parallel.
- **Consensus timing**: lines are matched across sources and each one uses the median timestamp.
- **Lyrics** menu: see which sources were used, pick one source, nudge timing earlier or later per song, or search again.

## 1.0.0 — 2026-10-02

### Added
- First release: a menu bar app that turns your desktop into what Spotify is playing, with the album cover and live, synced lyrics on every Space and every monitor.
- Animated layer above the wallpaper, plus the real wallpaper kept in sync with a still of each song.
- Templates: Lyric Card, Album Poster, Minimal and Glow.
- Customize window with a live preview and per-template settings, plus Duplicate & edit code.
- Refresh rate setting, Launch at Login and Pause.
