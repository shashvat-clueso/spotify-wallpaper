import AppKit
import CryptoKit

/// Template thumbnails for Home and the Quick Switcher: each template's still with the current song, 640×400 JPEGs
/// cached in Caches/Spotify Wallpaper/Thumbs/<templateID>-<trackKey>-<paramsHash>.jpg and served by SchemeHandler at
/// sw://app/thumb/<templateID>.jpg?v=<hash>.
///
/// Drawn lazily, as web pages ask for them (lazy <img>s, so visible ones come first; the newest request is drawn
/// first), at most two at a time, and never while the real wallpaper's still is being drawn. A new song or a
/// template's settings changing gives the template a new key, so the next request draws it again.
@MainActor
final class ThumbnailService {
    static let size = CGSize(width: 640, height: 400)
    /// Templates lay out in vmin and px for a real screen, so they're drawn at a laptop-like size and scaled down.
    private static let viewport = CGSize(width: 1280, height: 800)
    private static let maxConcurrent = 2
    nonisolated private static let keep = 400

    private let engine: Engine
    private let store: TemplateStore
    private let dir: URL
    private var idle: [ScreenRenderer] = []
    private var running = 0
    private var queue: [String] = []                 // template ids; the last one is drawn next
    private var waiters: [String: [(Data?) -> Void]] = [:]
    private var epoch = 0                            // bumped when template code changes on disk
    private var writes = 0
    private var closeIdle: Task<Void, Never>?

    init(engine: Engine, store: TemplateStore, paths: Paths) {
        self.engine = engine
        self.store = store
        dir = paths.caches.appendingPathComponent("Thumbs")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        Task.detached(priority: .background) { [dir] in Self.prune(dir) }
    }

    /// Changes whenever the thumbnail would look different: the `v` in sw://app/thumb/<id>.jpg?v=…
    func version(for id: String) -> String { String(key(id).suffix(21)) }

    /// Every template's current version, for the web pages.
    func versions() -> [String: String] {
        let track = trackKey()
        return Dictionary(store.templates.map { ($0.id, String(key($0.id, track: track).suffix(21))) }, uniquingKeysWith: { a, _ in a })
    }

    /// Template code changed on disk: draw everything again.
    func invalidateAll() { epoch += 1 }

    /// The JPEG for a template, drawing it first if needed. Nil for an unknown template or a failed draw.
    func image(for id: String) async -> Data? {
        guard store.template(id) != nil else { return nil }
        if let data = try? Data(contentsOf: fileURL(id)) { return data }
        return await withCheckedContinuation { c in
            waiters[id, default: []].append { c.resume(returning: $0) }
            queue.removeAll { $0 == id }
            queue.append(id)
            pump()
        }
    }

    // MARK: drawing

    private func pump() {
        closeIdle?.cancel()
        while running < Self.maxConcurrent, let id = queue.popLast() {
            running += 1
            Task {
                await draw(id)
                running -= 1
                pump()
            }
        }
        if running == 0 && queue.isEmpty {
            // let the off-screen web views go once nothing has been asked for in a while
            closeIdle = Task { [weak self] in
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled, let self, self.running == 0 else { return }
                self.idle.forEach { $0.close() }
                self.idle.removeAll()
            }
        }
    }

    private func draw(_ id: String) async {
        // never compete with the real wallpaper's still
        while engine.stillRendering { try? await Task.sleep(for: .milliseconds(250)) }
        let file = fileURL(id)
        var data = try? Data(contentsOf: file)
        if data == nil, let t = store.template(id) {
            let renderer = idle.popLast() ?? ScreenRenderer(size: Self.viewport, configuration: engine.makeWebConfiguration())
            var payload = engine.statePayload(for: nil)
            payload["screen"] = ["width": Self.viewport.width, "height": Self.viewport.height, "scale": 1]
            payload["params"] = store.values(id)
            payload["focus"] = engine.focus
            var url = URLComponents(url: t.url, resolvingAgainstBaseURL: false)!
            url.queryItems = [.init(name: "v", value: String(epoch)), .init(name: "thumb", value: "1")]
            if let image = await renderer.render(url: url.url!, payload: payload) {
                let size = Self.size
                data = await Task.detached {
                    ShareCard.exactPixels(image, size: size).flatMap { HistoryStore.encodeJPEG($0, quality: 0.82) }
                }.value
            }
            idle.append(renderer)
            if let data {
                try? data.write(to: file, options: .atomic)
                writes += 1
                if writes % 60 == 0 { Task.detached(priority: .background) { [dir] in Self.prune(dir) } }
            }
        }
        for w in waiters.removeValue(forKey: id) ?? [] { w(data) }
    }

    // MARK: keys & cache

    private func fileURL(_ id: String) -> URL { dir.appendingPathComponent(key(id) + ".jpg") }

    /// <templateID>-<trackKey>-<paramsHash>
    private func key(_ id: String, track: String? = nil) -> String {
        let trackKey = track ?? self.trackKey()
        var params = jsonSorted(store.values(id))
        params += "|\(epoch)|\(engine.focus)"
        if let t = store.template(id), !t.builtin {
            // a user template's code can change between launches too
            for f in ["index.html", "manifest.json", "design.json"] {
                let d = (try? t.dir.appendingPathComponent(f).resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
                params += "|\(d?.timeIntervalSince1970 ?? 0)"
            }
        }
        let safeID = id.replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "_", options: .regularExpression)
        return "\(safeID)-\(trackKey)-\(hash(params).prefix(10))"
    }

    /// The song the thumbnails show (the sample song when nothing is playing).
    private func trackKey() -> String {
        let track = engine.statePayload(for: nil)["track"] as? [String: Any]
        return String(hash((track?["id"] as? String ?? "none") + (track?["coverKey"] as? String ?? "")).prefix(10))
    }

    private func hash(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func jsonSorted(_ object: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .fragmentsAllowed]) else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }

    /// Keeps the newest `keep` thumbnails.
    nonisolated private static func prune(_ dir: URL) {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey]),
              files.count > keep else { return }
        let dated = files.map { f in (f, (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast) }
        for (f, _) in dated.sorted(by: { $0.1 > $1.1 }).dropFirst(keep) { try? fm.removeItem(at: f) }
    }
}
