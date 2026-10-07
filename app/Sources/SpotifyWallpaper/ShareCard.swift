import AppKit
import UniformTypeIdentifiers

/// "Share Lyric Card": the main screen's template drawn at a phone-friendly size with the line being sung right now,
/// saved to ~/Pictures/Spotify Wallpaper and copied to the clipboard.
@MainActor
final class ShareCard {
    enum Format: String, CaseIterable {
        case story, square
        var size: CGSize { self == .story ? CGSize(width: 1080, height: 1920) : CGSize(width: 1080, height: 1080) }
        var title: String { self == .story ? "Story 9:16 (1080 × 1920)" : "Square (1080 × 1080)" }
    }

    private let engine: Engine
    private let store: TemplateStore
    private var busy = false

    init(engine: Engine, store: TemplateStore) {
        self.engine = engine
        self.store = store
    }

    var format: Format {
        get { Format(rawValue: UserDefaults.standard.string(forKey: "shareCardFormat") ?? "") ?? .story }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "shareCardFormat") }
    }

    nonisolated static var folder: URL {
        FileManager.default.urls(for: .picturesDirectory, in: .userDomainMask)[0].appendingPathComponent("Spotify Wallpaper")
    }

    func share() {
        guard !busy else { return }
        // the main screen's template (each screen can have its own)
        let mainTemplate = NSScreen.screens.first.flatMap { store.template(engine.templateID(for: $0)) } ?? store.active
        guard let t = engine.track, let template = mainTemplate else {
            HUD.show(title: "Nothing playing", detail: "Play a song in Spotify to share a lyric card.")
            return
        }
        var payload = engine.statePayload(for: nil)
        guard var track = payload["track"] as? [String: Any], track["id"] as? String == t.id else {
            HUD.show(title: "Still loading this song", detail: "Try again in a moment.")
            return
        }
        busy = true
        let format = format, size = format.size
        // move the clock to "now" so the line being sung is the one on the card
        let now = Date().timeIntervalSince1970 * 1000
        var position = track["position"] as? Double ?? 0
        if track["isPlaying"] as? Bool == true, let stamp = track["stamp"] as? Double { position += max(0, now - stamp) / 1000 }
        position = min(position, track["duration"] as? Double ?? position)
        track["position"] = position
        track["stamp"] = now
        payload["track"] = track
        if var lyrics = payload["lyrics"] as? [String: Any], let lines = lyrics["lines"] as? [[String: Any]] {
            lyrics["index"] = Self.index(lines.map { $0["t"] as? Double ?? 0 }, at: position)
            payload["lyrics"] = lyrics
        }
        payload["screen"] = ["width": size.width, "height": size.height, "scale": 1]
        payload["params"] = store.values(template.id)
        payload["focus"] = false

        Task {
            defer { busy = false }
            let renderer = ScreenRenderer(size: size, configuration: engine.makeWebConfiguration())
            let image = await renderer.render(url: template.url, payload: payload)
            renderer.close()
            guard let cg = image.flatMap({ Self.exactPixels($0, size: size) }),
                  let png = HistoryStore.encode(cg, type: .png) else {
                HUD.show(title: "Couldn't draw the lyric card", detail: nil)
                return
            }
            let name = Self.fileName(artist: t.artist, title: t.title, position: position)
            do {
                let url = try Self.save(png, name: name)
                let pb = NSPasteboard.general
                pb.clearContents()
                let item = NSPasteboardItem()
                item.setData(png, forType: .png)
                item.setString(url.absoluteString, forType: .fileURL)
                pb.writeObjects([item])
                HUD.show(title: "Lyric card copied", detail: "Saved to Pictures › Spotify Wallpaper", image: NSImage(cgImage: cg, size: .zero)) {
                    NSWorkspace.shared.activateFileViewerSelecting([url])
                }
            } catch {
                HUD.show(title: "Couldn't save the lyric card", detail: error.localizedDescription)
            }
        }
    }

    /// The line being sung at `position` (same 0.3 s lead as the still).
    nonisolated static func index(_ times: [Double], at position: Double, lead: Double = 0.3) -> Int {
        var idx = -1
        for (i, t) in times.enumerated() { if t <= position + lead { idx = i } else { break } }
        return idx
    }

    /// "Artist – Title (1∶23).png". A real ":" would show as "/" in Finder, so the time uses the ratio sign.
    nonisolated static func fileName(artist: String, title: String, position: Double) -> String {
        let s = max(0, Int(position))
        let clean = { (x: String) in x.replacingOccurrences(of: "[/:\\x00-\\x1f]", with: "-", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces) }
        let base = "\(clean(artist)) – \(clean(title))"
        return String(base.prefix(180)) + String(format: " (%d\u{2236}%02d)", s / 60, s % 60)
    }

    nonisolated static func save(_ png: Data, name: String, in folder: URL = folder) throws -> URL {
        let fm = FileManager.default
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        var url = folder.appendingPathComponent(name + ".png"), n = 2
        while fm.fileExists(atPath: url.path) {
            url = folder.appendingPathComponent("\(name) \(n).png")
            n += 1
        }
        try png.write(to: url, options: .atomic)
        return url
    }

    /// The snapshot comes back at the display's backing scale; redraw it at exactly `size` pixels.
    nonisolated static func exactPixels(_ image: NSImage, size: CGSize) -> CGImage? {
        guard let src = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
              let ctx = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(src, in: CGRect(origin: .zero, size: size))
        return ctx.makeImage()
    }
}

/// A small, non-modal confirmation under the menu bar that fades away. Click it to run `action`.
@MainActor
enum HUD {
    private static var panel: NSPanel?
    private static var hideTask: Task<Void, Never>?

    static func show(title: String, detail: String?, image: NSImage? = nil, action: (() -> Void)? = nil) {
        panel?.orderOut(nil)
        let width: CGFloat = 320, height: CGFloat = image == nil ? 58 : 76
        let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: width, height: height), styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered, defer: false)
        p.isFloatingPanel = true
        p.level = .statusBar
        p.backgroundColor = .clear
        p.isOpaque = false
        p.hasShadow = true
        p.collectionBehavior = [.canJoinAllSpaces, .transient, .ignoresCycle]
        p.isReleasedWhenClosed = false

        let fx = ClickView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        fx.material = .hudWindow
        fx.state = .active
        fx.blendingMode = .behindWindow
        fx.wantsLayer = true
        fx.layer?.cornerRadius = 12
        fx.layer?.masksToBounds = true
        fx.action = { action?(); hide() }
        var textX: CGFloat = 16
        if let image {
            let iv = NSImageView(frame: NSRect(x: 12, y: 10, width: (height - 20) * min(1, image.size.width / max(1, image.size.height)), height: height - 20))
            iv.image = image
            iv.imageScaling = .scaleProportionallyUpOrDown
            iv.wantsLayer = true
            iv.layer?.cornerRadius = 4
            iv.layer?.masksToBounds = true
            fx.addSubview(iv)
            textX = iv.frame.maxX + 12
        }
        let t = NSTextField(labelWithString: title)
        t.font = .systemFont(ofSize: 13, weight: .semibold)
        let d = NSTextField(labelWithString: detail ?? "")
        d.font = .systemFont(ofSize: 11)
        d.textColor = .secondaryLabelColor
        d.lineBreakMode = .byTruncatingTail
        let mid = height / 2
        t.frame = NSRect(x: textX, y: detail == nil ? mid - 9 : mid + 1, width: width - textX - 12, height: 18)
        d.frame = NSRect(x: textX, y: mid - 17, width: width - textX - 12, height: 16)
        fx.addSubview(t)
        if detail != nil { fx.addSubview(d) }
        p.contentView = fx

        let screen = NSScreen.screens.first?.visibleFrame ?? .zero
        p.setFrameOrigin(NSPoint(x: screen.maxX - width - 14, y: screen.maxY - height - 10))
        p.alphaValue = 0
        p.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { $0.duration = 0.18; p.animator().alphaValue = 1 }
        panel = p
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(for: .seconds(3.2))
            if !Task.isCancelled { hide() }
        }
    }

    static func hide() {
        guard let p = panel else { return }
        panel = nil
        NSAnimationContext.runAnimationGroup({ $0.duration = 0.3; p.animator().alphaValue = 0 }, completionHandler: { p.orderOut(nil) })
    }

    private final class ClickView: NSVisualEffectView {
        var action: (() -> Void)?
        override func mouseDown(with event: NSEvent) { action?() }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    }
}
