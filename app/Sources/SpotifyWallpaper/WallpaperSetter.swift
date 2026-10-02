import AppKit

/// Sets the real desktop wallpaper.
///
/// macOS only lets an app set the wallpaper of the Space you're currently on, so the engine sets it on every
/// change and `reapply()` runs the instant you switch Spaces: whichever Space you're looking at is current.
/// The API needs a file URL, and re-setting a path a Space already shows doesn't refresh it, so each screen
/// alternates between two files.
@MainActor
final class WallpaperSetter {
    private let dir: URL
    private var latest: [CGDirectDisplayID: Data] = [:]
    private var slot: [CGDirectDisplayID: Int] = [:]
    private(set) var showing = false
    private let defaults = UserDefaults.standard

    init(paths: Paths) { dir = paths.frames }

    func show(_ jpeg: Data, on screen: NSScreen) {
        if !showing { rememberOriginals() }
        showing = true
        latest[displayID(screen)] = jpeg
        write(screen)
    }

    func reapply() {
        guard showing else { return }
        for screen in NSScreen.screens { write(screen) }
    }

    private func write(_ screen: NSScreen) {
        let id = displayID(screen)
        guard let data = latest[id] else { return }
        let current = NSWorkspace.shared.desktopImageURL(for: screen)?.standardizedFileURL
        var next = (slot[id] ?? 0) ^ 1
        if frameURL(id, next).standardizedFileURL == current { next ^= 1 }  // this Space already shows that file
        slot[id] = next
        let url = frameURL(id, next)
        do {
            try data.write(to: url, options: .atomic)
            try NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [:])
        } catch {
            NSLog("SpotifyWallpaper: couldn't set wallpaper: \(error)")
        }
    }

    private func frameURL(_ id: CGDirectDisplayID, _ slot: Int) -> URL {
        dir.appendingPathComponent("wall_\(id)_\(slot == 0 ? "a" : "b").jpg")
    }

    // MARK: original wallpaper

    private var originals: [String: String] {
        get { defaults.dictionary(forKey: "originalWallpapers") as? [String: String] ?? [:] }
        set { defaults.set(newValue, forKey: "originalWallpapers") }
    }

    private func rememberOriginals() {
        var o = originals
        for screen in NSScreen.screens {
            if let url = NSWorkspace.shared.desktopImageURL(for: screen), Self.isUserWallpaper(url) {
                o[String(displayID(screen))] = url.path
            }
        }
        originals = o
    }

    /// A real wallpaper the user chose: exists, and isn't a frame from this app or the old Python prototype.
    private static func isUserWallpaper(_ url: URL) -> Bool {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].path
        let ours = [caches + "/Spotify Wallpaper", caches + "/spotify-wallpaper"]
        return FileManager.default.fileExists(atPath: url.path) && !ours.contains { url.path.hasPrefix($0) }
    }

    /// Puts the user's own wallpaper back. Spaces we can't reach right now still point at our two frame
    /// files, so the original image is written into those too.
    func restore() {
        guard showing else { return }
        showing = false
        latest.removeAll()
        let o = originals
        for screen in NSScreen.screens {
            let id = displayID(screen)
            guard let path = o[String(id)] ?? o.values.first, FileManager.default.fileExists(atPath: path) else { continue }
            let url = URL(fileURLWithPath: path)
            if let image = NSImage(contentsOf: url), let jpeg = jpegData(image) {
                for s in 0...1 { try? jpeg.write(to: frameURL(id, s), options: .atomic) }
            }
            try? NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [:])
        }
    }
}
