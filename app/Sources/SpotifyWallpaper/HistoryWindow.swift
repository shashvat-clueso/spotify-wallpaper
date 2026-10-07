import AppKit
import UniformTypeIdentifiers
import WebKit

/// The History Wall: every saved wallpaper as a gallery grouped by month, with a viewer and exports.
@MainActor
final class HistoryWindowController: NSWindowController, WKScriptMessageHandler, NSWindowDelegate {
    private static let barHeight: CGFloat = 44
    private let history: HistoryStore
    private let store: TemplateStore
    private var webView: WKWebView!
    private var strip: DragStrip!
    private var exporting = false

    init(engine: Engine, history: HistoryStore, store: TemplateStore) {
        self.history = history
        self.store = store
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = "History Wall"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 860, height: 480)
        window.isReleasedWhenClosed = false
        window.center()
        super.init(window: window)
        window.delegate = self

        let config = engine.makeWebConfiguration()
        config.userContentController.add(self, name: "app")
        let container = NSView(frame: window.contentView!.bounds)
        webView = WKWebView(frame: container.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)
        strip = DragStrip(frame: NSRect(x: 0, y: container.bounds.height - Self.barHeight, width: container.bounds.width, height: Self.barHeight))
        strip.autoresizingMask = [.width, .minYMargin]
        container.addSubview(strip)
        window.contentView = container
        webView.load(URLRequest(url: URL(string: "sw://app/ui/history.html")!))
    }

    required init?(coder: NSCoder) { fatalError() }

    func show() {
        NSApp.activate(ignoringOtherApps: true)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        window?.centerTrafficLights(inBarOfHeight: Self.barHeight)
    }

    func windowDidResize(_ notification: Notification) { window?.centerTrafficLights(inBarOfHeight: Self.barHeight) }
    func windowDidExitFullScreen(_ notification: Notification) { window?.centerTrafficLights(inBarOfHeight: Self.barHeight) }

    /// The history changed (new song, cleared): refresh the gallery if it's open.
    func historyChanged() {
        guard window?.isVisible == true else { return }
        sendInit()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let ids = body["ids"] as? [String] ?? []
        switch type {
        case "titlebarHoles":
            let rects = body["rects"] as? [[String: Double]] ?? []
            strip.holes = rects.map { NSRect(x: $0["x"] ?? 0, y: $0["y"] ?? 0, width: $0["w"] ?? 0, height: $0["h"] ?? 0) }
        case "ready":
            sendInit()
        case "reveal":
            if let id = body["id"] as? String, let e = history.entry(id) {
                NSWorkspace.shared.activateFileViewerSelecting([history.imageURL(e)])
            }
        case "exportSheet":
            export(ids, heading: body["heading"] as? String ?? "Listening history", gif: false)
        case "exportGif":
            export(ids, heading: body["heading"] as? String ?? "Listening history", gif: true)
        default:
            break
        }
    }

    private func sendInit() {
        history.load()
        let names = Dictionary(store.templates.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        let entries: [[String: Any]] = history.entries.map { e in
            var j = e.json
            j["image"] = "/history/\(e.month)/\(e.id).jpg"
            j["thumb"] = "/history/\(e.month)/\(e.id)-thumb.jpg"
            j["templateName"] = names[e.templateID] ?? e.templateID
            return j
        }
        send(["type": "init", "entries": entries, "enabled": history.enabled])
    }

    private func export(_ ids: [String], heading: String, gif: Bool) {
        guard !exporting, let window else { return }
        let picked = ids.compactMap { history.entry($0) }.sorted { $0.timestamp < $1.timestamp }
        guard !picked.isEmpty else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [gif ? .gif : .png]
        panel.nameFieldStringValue = heading.replacingOccurrences(of: "[/:]", with: "-", options: .regularExpression) + (gif ? ".gif" : ".png")
        panel.canCreateDirectories = true
        let df = DateFormatter()
        df.dateFormat = "d MMM, HH:mm"
        let items = picked.map { e in
            HistoryExport.Item(image: history.imageURL(e), title: e.title, subtitle: "\(e.artist) · \(df.string(from: e.date))")
        }
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            MainActor.assumeIsolated {
                guard let self else { return }
                self.exporting = true
                self.send(["type": "busy", "text": gif ? "Making GIF…" : "Making contact sheet…"])
                Task {
                    let data = await Task.detached {
                        gif ? HistoryExport.gif(items.map(\.image)) : HistoryExport.contactSheet(items, heading: heading)
                    }.value
                    self.exporting = false
                    if let data, (try? data.write(to: url, options: .atomic)) != nil {
                        self.send(["type": "toast", "text": "Saved \(url.lastPathComponent)"])
                        NSWorkspace.shared.activateFileViewerSelecting([url])
                    } else {
                        self.send(["type": "toast", "text": "Couldn't save \(url.lastPathComponent)"])
                    }
                }
            }
        }
    }

    private func send(_ message: [String: Any]) {
        webView.evaluateJavaScript("window.App && App.receive(\(jsonString(message)))")
    }
}
