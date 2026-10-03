# Spotify Wallpaper template guide

Don't want to write code? Use **Template Builder…** in the menu: it makes templates visually, and its **Edit Code**
button turns any design into an HTML template you can keep editing here.

A template is a folder with two files:

```
my-template/
  manifest.json   name, description and the settings shown in the Customize window
  index.html      the wallpaper: plain HTML + CSS (+ optional JS)
```

Put it in this folder (`~/Library/Application Support/Spotify Wallpaper/Templates`). The easiest start is
**Customize → pick a template → Duplicate & edit code**. While a custom template is being edited, the preview and
the wallpaper reload every time you save.

Each template runs in two ways:

- **Live layer**: while a song plays, the page runs as an animated layer just above your wallpaper (below the
  desktop icons) on every Space and screen. It keeps its own playback clock, so lines change exactly on their
  timestamps, and CSS transitions/animations play. `<html>` has the class `sw-live` in this mode.
- **Still**: on each track change the page is also captured as the real wallpaper (lock screen, Mission Control,
  when the app isn't running). Transitions are off for stills, so scope animations under `.sw-live`.

Use `vmin`/`vw`/`vh` units so it adapts to both laptop and ultrawide screens.

## Boilerplate

```html
<!doctype html>
<html><head>
<meta charset="utf-8">
<link rel="stylesheet" href="/runtime/runtime.css">
<script src="/runtime/runtime.js"></script>
<style> body { background: var(--dark); color: #fff; } </style>
</head><body>
  <img data-src="track.cover">
  <h1 data-bind="track.title"></h1>
  <lyrics-block before="1" after="3"></lyrics-block>
</body></html>
```

## Data you can bind

| Path | Meaning |
|---|---|
| `track.title` `track.artist` `track.album` | text |
| `track.cover` | cover image URL |
| `track.duration` `track.position` | seconds |
| `track.progress` | 0–1 |
| `track.elapsed` `track.remaining` `track.length` | `1:23` style text |
| `track.isPlaying` | true / false |
| `lyrics.current` | the line being sung (empty during instrumental gaps) |
| `lyrics.prev1` `lyrics.next1` `lyrics.next2` `lyrics.next3` | neighbouring lines |
| `lyrics.prev[n]` `lyrics.next[n]` | up to 8 either way, e.g. `lyrics.next.4` |
| `lyrics.lines` `lyrics.index` | everything, for custom JS |
| `lyrics.lineProgress` | 0–1 through the current line |
| `lyrics.hasLyrics` `lyrics.synced` `lyrics.isInstrumental` | flags |
| `colors.vibrant` `colors.dominant` `colors.card` `colors.deep` `colors.dark` `colors.light` `colors.muted` `colors.paper` `colors.onDominant` | colors from the cover |
| `colors.palette` | the 6 main cover colors |
| `time.song` / `time.line` | seconds into the song / into the current line |
| `time.clock` / `time.clock24` | `10:42 PM` / `22:42` |
| `time.date` / `time.day` | `Saturday, October 3` / `Saturday` |
| `time.hour` `time.minute` `time.second` | the current time as numbers |
| `params.<key>` | your template's settings |
| `screen.width` `screen.height` `screen.scale` | the screen being drawn |

### Attributes

- `data-bind="track.title"` sets the text. Add pipes: `|upper`, `|lower`, `|note` (empty → `• • •`), `|time`, `|pct`.
- `data-template="Now playing {{track.title}} · {{time.clock}}"` mixes variables into text (pipes work inside `{{ }}`).
- `data-src="track.cover"` sets `src` on an image.
- `data-show="lyrics.hasLyrics"` hides the element when false. Prefix `!` to invert.
- `data-attr-<name>="expr"` sets any attribute, e.g. `data-attr-after="params.linesAfter"`.

### CSS variables

`--progress`, `--line-progress`, `--cover-url` (use as `background: var(--cover-url) center/cover`),
`--vibrant` `--dominant` `--card` `--deep` `--dark` `--light` `--muted` `--paper` `--onDominant`,
`--p0` … `--p5` (palette), and `--param-<key>` for every setting.

Time-based variables, updated every frame **only if your CSS uses them** (each costs a style pass per frame):
`--song-time`, `--line-time` (seconds), `--time` (seconds since the page loaded), `--hour`, `--minute`, `--second`.

`data-cover-blur="<px>"` (with optional `data-cover-saturate="1.2"`) on an element gives it the cover, blurred once by
the app, as a background. Use it instead of `filter: blur()` on the cover: it costs nothing per frame.

Classes on `<html>`: `is-playing`, `has-lyrics`, `synced`, `instrumental`, `ultrawide`, and `param-<key>` for every
true bool setting.

## Components

- `<lyrics-block before="2" after="3" layout="flow|top|center" empty="• • •">`
  renders every line as `.line` with `.past` / `.current` / `.next`, plus `--offset` (−2, −1, 0, 1 …) and `--dist`
  (distance from the current line) for fades like `opacity: calc(1 - var(--dist) * .2)`. Instrumental gaps and the
  intro before the first lyric show the `empty` text with a `.gap` class.
  `flow` grows with its lines; `top` and `center` scroll inside a fixed height (give it a height).
- `<fit-text max-lines="2" min="4vmin" max="15vmin">` shrinks or grows its text to fit its box.
- `<swatch-row count="5" labels>` shows cover colors (`.chip`, `.hex`).
- `<wave-form bars="56">` draws a waveform that changes with every line (`.bar`, uses `currentColor`).
- `<progress-bar>` is a bar filled to `--progress` (`.fill`, uses `currentColor`).
- `<div class="sw-grain">` adds a film-grain overlay.

## Animation

- Lyric lines get transitions automatically on the live layer: `layout="center"`/`"top"` blocks scroll smoothly,
  and in `flow` blocks the new current line rises in.
- `data-animate` on any element replays a fade/blur-in (`.sw-enter`) every time the line changes.
- Add class `karaoke` to a `<lyrics-block>` to sweep a fill across the current line in time with the song
  (`--karaoke-on` / `--karaoke-off` set the colors). Stills show the whole line lit. Or use `--line-progress` (0–1) in your own CSS.
- `--progress` and `--line-progress` update every frame on the live layer.
- Anything under `.sw-live` can use regular CSS `@keyframes`; e.g. `.sw-live .bg { animation: drift 20s infinite alternate }`.

## Settings (manifest.json)

```json
{
  "name": "My Template",
  "description": "Shown in the Customize window.",
  "params": [
    { "key": "accent", "type": "color", "label": "Accent", "default": "auto:vibrant" },
    { "key": "size", "type": "number", "label": "Lyric size", "min": 2, "max": 8, "step": 0.1, "unit": "vmin", "default": 4 },
    { "key": "lines", "type": "int", "label": "Lines after", "min": 0, "max": 8, "default": 3 },
    { "key": "grain", "type": "bool", "label": "Film grain", "default": true },
    { "key": "font", "type": "font", "label": "Font", "default": "New York" },
    { "key": "align", "type": "select", "label": "Align", "default": "left",
      "options": [{ "value": "left", "label": "Left" }, { "value": "center", "label": "Center" }] },
    { "key": "tagline", "type": "text", "label": "Tagline", "default": "now playing" }
  ]
}
```

Colors can default to `auto:<name>` (any color name above), so they follow each song's cover. Numbers with a `unit`
become CSS values directly: `font-size: var(--param-size)`.

Fonts: SF Pro, SF Pro Variable (supports `font-stretch: 30%–150%` for compressed and expanded widths),
SF Pro Rounded, SF Mono, New York, Helvetica Neue, Avenir Next, Futura, Gill Sans, Optima, Didot, Bodoni 72,
Baskerville, Georgia, American Typewriter, Courier New, Snell Roundhand, Marker Felt. A `text` param can also hold
any installed font's name.

## Custom JavaScript

```js
Wallpaper.on("render", (ctx) => { /* runs after bindings, before layout. ctx has everything above */ });
Wallpaper.on("layout", (ctx) => { /* runs after fonts/images load and components lay out */ });
Wallpaper.on("line", (ctx) => { /* live layer: a new lyric line just started */ });
Wallpaper.on("tick", (ctx) => { /* live layer: once a second (clocks, counters) */ });
Wallpaper.on("frame", (ctx) => { /* live layer: every frame; only add this if you really need it */ });
```

### Animating with time

**`data-follow`** maps an element's CSS animation onto time. 0% of the animation is the start and 100% the end of:
`song` (the song; pauses with the music), `line` (the current lyric line; restarts each line), or the real clock:
`seconds` (every minute), `minutes` (every hour), `hours` (every 12 hours), `day`. It runs on the GPU, so it's free.

```html
<div class="second-hand" data-follow="seconds"></div>
<div class="progress-dot" data-follow="song"></div>
<style>
  .second-hand { animation: turn 1s linear both paused; transform-origin: 50% 100%; }
  .progress-dot { animation: across 1s linear both paused; }
  @keyframes turn { to { transform: rotate(360deg); } }
  @keyframes across { from { transform: translateX(0); } to { transform: translateX(80vw); } }
</style>
```

- Loops: plain CSS `@keyframes` under `.sw-live`. Pause them with the music using
  `.sw-live:not(.is-playing) .thing { animation-play-state: paused; }`.
- Follow the song's timeline: give an element a paused animation as long as the song and drive it from the clock:
  `.thing { animation: grow 1s linear paused; animation-delay: calc(var(--song-time) * -1s / var(--length, 200)); }`
  (set `--length` from `ctx.track.duration` in a `render` hook).
- Per line: `data-animate` replays an entrance on every new line; `Wallpaper.on("line")` for anything custom.
- Clock or countdowns: bind `time.clock` / `time.date`, or update in `Wallpaper.on("tick")`.

### Keeping it fast

The live layer is built to cost almost nothing: lines change on a timer set for their exact timestamp, and the
progress bar, karaoke sweep, waveform and CSS animations run on the GPU compositor. To keep it that way:

- Animate `transform` and `opacity`. Avoid animating `width`, `height`, `top`/`left`, `filter`, `background` or
  `box-shadow`; those repaint every frame.
- Don't blur things live (`filter: blur()` on large elements, `backdrop-filter` over moving content); use
  `data-cover-blur` for the cover.
- Avoid `mix-blend-mode` on full-screen layers above moving content.
- Use `tick` (once a second) instead of `frame` whenever you can.
```
