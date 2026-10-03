import AppKit

/// Invisible strip over a web window's title-bar area: drag to move the window, double-click to zoom (or
/// minimize, per System Settings). Clicks inside `holes` (the web page's own buttons) pass through to the page.
final class DragStrip: NSView {
    static let height: CGFloat = 36
    var holes: [NSRect] = []

    override var isFlipped: Bool { true }  // holes come from the web page, measured from the top
    override var mouseDownCanMoveWindow: Bool { true }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let p = convert(point, from: superview)
        if holes.contains(where: { $0.contains(p) }) { return nil }
        return super.hitTest(point)
    }

    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 {
            let action = UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize"
            if action == "Minimize" { window?.performMiniaturize(nil) } else if action != "None" { window?.performZoom(nil) }
        } else {
            window?.performDrag(with: event)
        }
    }
}

extension NSWindow {
    /// Vertically centers the close/minimize/zoom buttons in a taller custom title bar.
    func centerTrafficLights(inBarOfHeight bar: CGFloat, leftInset: CGFloat = 14) {
        guard !styleMask.contains(.fullScreen),
              let close = standardWindowButton(.closeButton), let titlebar = close.superview,
              let container = titlebar.superview else { return }
        var c = container.frame
        c.size.height = bar
        c.origin.y = frame.height - bar
        container.frame = c
        titlebar.frame = NSRect(x: 0, y: 0, width: c.width, height: bar)
        for (i, kind) in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].enumerated() {
            guard let b = standardWindowButton(kind) else { continue }
            b.setFrameOrigin(NSPoint(x: leftInset + CGFloat(i) * 20, y: (bar - b.frame.height) / 2))
        }
    }
}

/// Opens a file in the user's code editor, if they have one. Returns the editor's name.
enum CodeEditor {
    private static let known = [
        "com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92" /* Cursor */, "dev.zed.Zed", "com.sublimetext.4",
        "com.panic.Nova", "com.exafunction.windsurf", "com.apple.dt.Xcode", "com.apple.TextEdit",
    ]

    @discardableResult
    static func open(_ file: URL) -> String? {
        for id in known {
            guard let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) else { continue }
            let config = NSWorkspace.OpenConfiguration()
            NSWorkspace.shared.open([file], withApplicationAt: app, configuration: config)
            return FileManager.default.displayName(atPath: app.path).replacingOccurrences(of: ".app", with: "")
        }
        NSWorkspace.shared.activateFileViewerSelecting([file])
        return nil
    }
}
