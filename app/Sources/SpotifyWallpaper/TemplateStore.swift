import Foundation

struct WallpaperTemplate {
    let id: String  // folder name
    let dir: URL
    let manifest: [String: Any]
    let builtin: Bool

    var name: String { manifest["name"] as? String ?? id }
    var description: String { manifest["description"] as? String ?? "" }
    var params: [[String: Any]] { manifest["params"] as? [[String: Any]] ?? [] }
    var url: URL { URL(string: "sw://app/template/\(id)/index.html")! }

    var summary: [String: Any] {
        ["id": id, "name": name, "description": description, "builtin": builtin, "params": params]
    }
}

/// Built-in templates ship in the app bundle; user templates live in
/// ~/Library/Application Support/Spotify Wallpaper/Templates and override built-ins with the same folder name.
@MainActor
final class TemplateStore {
    private(set) var templates: [WallpaperTemplate] = []
    private let paths: Paths
    private let defaults = UserDefaults.standard
    private static let builtinOrder = ["card", "poster", "minimal", "glow"]

    init(paths: Paths) {
        self.paths = paths
        installGuide()
        reload()
    }

    func reload() {
        var byID: [String: WallpaperTemplate] = [:]
        for (dir, builtin) in [(paths.builtinTemplates, true), (paths.userTemplates, false)] {
            let subs = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
            for sub in subs {
                guard let data = try? Data(contentsOf: sub.appendingPathComponent("manifest.json")),
                      let manifest = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
                byID[sub.lastPathComponent] = WallpaperTemplate(id: sub.lastPathComponent, dir: sub, manifest: manifest, builtin: builtin)
            }
        }
        templates = byID.values.sorted { a, b in
            let ia = Self.builtinOrder.firstIndex(of: a.id) ?? Int.max, ib = Self.builtinOrder.firstIndex(of: b.id) ?? Int.max
            return ia != ib ? ia < ib : a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }

    func template(_ id: String) -> WallpaperTemplate? { templates.first { $0.id == id } }

    var activeID: String {
        get {
            let saved = defaults.string(forKey: "activeTemplate") ?? "card"
            return template(saved) != nil ? saved : (templates.first?.id ?? "card")
        }
        set { defaults.set(newValue, forKey: "activeTemplate") }
    }

    var active: WallpaperTemplate? { template(activeID) }

    // MARK: parameter values

    func values(_ id: String) -> [String: Any] {
        var out = defaultValues(id)
        for (k, v) in saved(id) { out[k] = v }
        return out
    }

    func defaultValues(_ id: String) -> [String: Any] {
        var out: [String: Any] = [:]
        for p in template(id)?.params ?? [] {
            if let key = p["key"] as? String { out[key] = p["default"] }
        }
        return out
    }

    func setValue(_ id: String, key: String, value: Any) {
        var s = saved(id)
        s[key] = value
        defaults.set(s, forKey: "params." + id)
    }

    func reset(_ id: String) { defaults.removeObject(forKey: "params." + id) }

    private func saved(_ id: String) -> [String: Any] {
        defaults.dictionary(forKey: "params." + id) ?? [:]
    }

    // MARK: editing

    /// Copies a template into the user folder so its code can be edited. Returns the new id.
    func duplicate(_ id: String) -> String? {
        guard let src = template(id) else { return nil }
        let fm = FileManager.default
        var newID = id + "-custom", n = 2
        while fm.fileExists(atPath: paths.userTemplates.appendingPathComponent(newID).path) {
            newID = "\(id)-custom-\(n)"; n += 1
        }
        let dest = paths.userTemplates.appendingPathComponent(newID)
        do { try fm.copyItem(at: src.dir, to: dest) } catch { return nil }
        var manifest = src.manifest
        manifest["name"] = src.name + " (Custom)"
        if let data = try? JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: dest.appendingPathComponent("manifest.json"))
        }
        defaults.set(saved(id), forKey: "params." + newID)
        reload()
        return newID
    }

    /// Latest modification time across user templates, for live reload while editing code.
    func userTemplatesStamp() -> Date {
        var latest = Date.distantPast
        for t in templates where !t.builtin {
            let files = FileManager.default.enumerator(at: t.dir, includingPropertiesForKeys: [.contentModificationDateKey])
            while let f = files?.nextObject() as? URL {
                if let d = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate, d > latest { latest = d }
            }
        }
        return latest
    }

    private func installGuide() {
        let src = paths.web.appendingPathComponent("TEMPLATE_GUIDE.md")
        let dest = paths.userTemplates.appendingPathComponent("TEMPLATE_GUIDE.md")
        try? FileManager.default.removeItem(at: dest)
        try? FileManager.default.copyItem(at: src, to: dest)
    }
}
