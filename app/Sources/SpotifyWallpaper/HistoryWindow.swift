import AppKit
import UniformTypeIdentifiers

/// The History Wall's native side: every saved wallpaper as a gallery grouped by month, with a viewer and exports.
/// The page (ui/history.html) lives in Home's History tab; Home relays its messages here and `send` back to it.
@MainActor
final class HistoryBridge {
    private let history: HistoryStore
    private let store: TemplateStore
    private var exporting = false
    /// Delivers a message to the History Wall page (`App.receive`).
    var send: ([String: Any]) -> Void = { _ in }
    /// The window export panels attach to.
    var window: () -> NSWindow? = { nil }

    init(history: HistoryStore, store: TemplateStore) {
        self.history = history
        self.store = store
    }

    func handle(_ body: [String: Any]) {
        guard let type = body["type"] as? String else { return }
        let ids = body["ids"] as? [String] ?? []
        switch type {
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

    func sendInit() {
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
        guard !exporting, let window = window() else { return }
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
}
