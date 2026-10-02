# Python prototype

The first proof of concept. It reads Spotify over AppleScript, fetches lyrics from LRCLIB, draws a frame with Pillow
and sets it as the wallpaper whenever the lyric line changes. The Swift app in `../app` replaced it, and it's kept
only for reference.

```sh
pip install pillow pyobjc-framework-Cocoa
python3 spotify_wallpaper.py --style card   # card | poster | minimal | glow
```

Ctrl+C restores your original wallpaper.
