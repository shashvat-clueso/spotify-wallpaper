import AppKit

struct Track: Equatable {
    var id: String
    var title: String
    var artist: String
    var album: String
    var artworkURL: String
    var duration: Double  // seconds
    var position: Double  // seconds
    var isPlaying: Bool
}

struct LyricLine {
    var t: Double
    var text: String
}

struct Lyrics {
    var lines: [LyricLine]
    var synced: Bool

    static let none = Lyrics(lines: [], synced: false)

    /// Index of the line being sung at `position`, or -1 before the first line.
    /// Shown slightly early because a wallpaper swap isn't instant.
    func index(at position: Double, lead: Double = 0.3) -> Int {
        var idx = -1
        for (i, line) in lines.enumerated() {
            if line.t <= position + lead { idx = i } else { break }
        }
        return idx
    }
}

struct Paths {
    let support: URL
    let caches: URL

    init() {
        let fm = FileManager.default
        support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Spotify Wallpaper")
        caches = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Spotify Wallpaper")
        for dir in [userTemplates, caches, frames] {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
    }

    var userTemplates: URL { support.appendingPathComponent("Templates") }
    var frames: URL { caches.appendingPathComponent("Frames") }
    var resources: URL { Bundle.main.resourceURL! }
    var builtinTemplates: URL { resources.appendingPathComponent("templates") }
    var web: URL { resources.appendingPathComponent("web") }
}

func displayID(_ screen: NSScreen) -> CGDirectDisplayID {
    (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
}

func jpegData(_ image: NSImage, quality: Double = 0.92) -> Data? {
    guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
    return NSBitmapImageRep(cgImage: cg).representation(using: .jpeg, properties: [.compressionFactor: quality])
}

func jsonString(_ object: Any) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return "null" }
    return String(data: data, encoding: .utf8) ?? "null"
}
