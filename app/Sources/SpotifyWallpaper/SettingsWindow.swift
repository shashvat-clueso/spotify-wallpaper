import AppKit
import WebKit

/// The Customize window: template gallery, live preview and per-template settings, as a web UI.
@MainActor
final class SettingsWindowController: NSWindowController, WKScriptMessageHandler, NSWindowDelegate {
    private let engine: Engine
    private let store: TemplateStore
    private let paths: Paths
    private var webView: WKWebView!
    private var strip: DragStrip!
    private static let barHeight: CGFloat = 44
    var onOpenBuilder: ((String?) -> Void)?
    var installer: TemplateInstaller?

    init(engine: Engine, store: TemplateStore, paths: Paths) {
        self.engine = engine
        self.store = store
        self.paths = paths
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 780),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = "Spotify Wallpaper"
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 960, height: 600)
        window.isReleasedWhenClosed = false
        window.center()
        super.init(window: window)
        window.delegate = self
        window.titleVisibility = .hidden

        let config = engine.makeWebConfiguration()
        config.userContentController.add(self, name: "app")
        let container = NSView(frame: window.contentView!.bounds)
        webView = WKWebView(frame: container.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)
        // The page fills the (transparent) title bar too and would swallow drags, so put a drag strip over it.
        strip = DragStrip(frame: NSRect(x: 0, y: container.bounds.height - Self.barHeight,
                                        width: container.bounds.width, height: Self.barHeight))
        strip.autoresizingMask = [.width, .minYMargin]
        container.addSubview(strip)
        window.contentView = container
        webView.load(URLRequest(url: URL(string: "sw://app/ui/settings.html")!))
    }

    required init?(coder: NSCoder) { fatalError() }

    func windowDidResize(_ notification: Notification) { window?.centerTrafficLights(inBarOfHeight: Self.barHeight) }
    func windowDidExitFullScreen(_ notification: Notification) { window?.centerTrafficLights(inBarOfHeight: Self.barHeight) }

    func show() {
        NSApp.activate(ignoringOtherApps: true)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        window?.centerTrafficLights(inBarOfHeight: Self.barHeight)
    }

    func snapshot() async -> NSImage? {
        try? await webView.takeSnapshot(configuration: nil)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let id = body["id"] as? String ?? ""
        switch type {
        case "titlebarHoles":
            let rects = body["rects"] as? [[String: Double]] ?? []
            strip.holes = rects.map { NSRect(x: $0["x"] ?? 0, y: $0["y"] ?? 0, width: $0["w"] ?? 0, height: $0["h"] ?? 0) }
        case "ready":
            sendInit()
        case "activate":
            store.activeID = id
            engine.invalidate()
            sendInit()
        case "setParam":
            if let key = body["key"] as? String, let value = body["value"] {
                store.setValue(id, key: key, value: value)
                if id == store.activeID { engine.paramsChanged() }
            }
        case "reset":
            store.reset(id)
            if id == store.activeID { engine.invalidate() }
            sendInit()
        case "duplicate":
            if let newID = store.duplicate(id) {
                sendInit(select: newID)
                if let t = store.template(newID) { NSWorkspace.shared.activateFileViewerSelecting([t.dir.appendingPathComponent("index.html")]) }
            }
        case "openFolder":
            if let t = store.template(id), !t.builtin {
                NSWorkspace.shared.activateFileViewerSelecting([t.dir.appendingPathComponent("index.html")])
            } else {
                NSWorkspace.shared.open(paths.userTemplates)
            }
        case "newTemplate":
            onOpenBuilder?(nil)
        case "openBuilder":
            onOpenBuilder?(id)
        case "exportTemplate":
            installer?.export(id, from: window)
        case "importTemplate":
            installer?.importWithPanel(from: window)
        case "reload":
            store.reload()
            engine.invalidate()
            sendInit()
        default:
            break
        }
    }

    func sendInit(select: String? = nil) {
        var values: [String: Any] = [:]
        for t in store.templates { values[t.id] = store.values(t.id) }
        var msg: [String: Any] = [
            "type": "init",
            "templates": store.templates.map(\.summary),
            "active": store.activeID,
            "values": values,
            "state": engine.statePayload(),
        ]
        if let select { msg["select"] = select }
        send(msg)
    }

    func pushState() {
        guard window?.isVisible == true else { return }
        send(["type": "state", "state": engine.statePayload()])
    }

    func pushClock(_ json: String) {
        guard window?.isVisible == true else { return }
        webView.evaluateJavaScript("window.App && App.receive({type: 'clock', clock: \(json)})")
    }

    func templateFilesChanged() {
        guard window?.isVisible == true else { return }
        sendInit()
        send(["type": "reloadPreview"])
    }

    private func send(_ message: [String: Any]) {
        webView.evaluateJavaScript("window.App && App.receive(\(jsonString(message)))")
    }
}

