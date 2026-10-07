// ============================================================================================================
// TEMPORARY — DELETE AT MERGE.
// Stand-ins for the displays stream's TemplateStore / Engine API (APP-PAGE-CONTRACT.md) so `up/home` builds on
// its own. Home codes only against the contract signatures below; the real implementations replace this file.
// These stubs do not make the engine draw a different template per screen.
// ============================================================================================================
import AppKit

@MainActor private enum HomeStub {
    static var onActiveChanged: (() -> Void)?
    static let overridesKey = "homeStub.displayOverrides"
    static let recentsKey = "homeStub.recentIDs"
    static let favoritesKey = "homeStub.favoriteIDs"
}

extension TemplateStore {
    func activeID(for display: CGDirectDisplayID) -> String {
        if let id = displayOverrides[display], template(id) != nil { return id }
        return activeID
    }

    func setActive(_ id: String, display: CGDirectDisplayID?) {
        var overrides = UserDefaults.standard.dictionary(forKey: HomeStub.overridesKey) as? [String: String] ?? [:]
        if let display {
            overrides[String(display)] = id
        } else {
            activeID = id
            overrides = [:]
        }
        UserDefaults.standard.set(overrides, forKey: HomeStub.overridesKey)
        var recents = recentIDs.filter { $0 != id }
        recents.insert(id, at: 0)
        UserDefaults.standard.set(Array(recents.prefix(12)), forKey: HomeStub.recentsKey)
        onActiveChanged?()
    }

    var displayOverrides: [CGDirectDisplayID: String] {
        let raw = UserDefaults.standard.dictionary(forKey: HomeStub.overridesKey) as? [String: String] ?? [:]
        var out: [CGDirectDisplayID: String] = [:]
        for (k, v) in raw { if let d = CGDirectDisplayID(k) { out[d] = v } }
        return out
    }

    var recentIDs: [String] { UserDefaults.standard.stringArray(forKey: HomeStub.recentsKey) ?? [] }

    var favoriteIDs: Set<String> { Set(UserDefaults.standard.stringArray(forKey: HomeStub.favoritesKey) ?? []) }

    func setFavorite(_ id: String, _ on: Bool) {
        var f = favoriteIDs
        if on { f.insert(id) } else { f.remove(id) }
        UserDefaults.standard.set(f.sorted(), forKey: HomeStub.favoritesKey)
    }

    var onActiveChanged: (() -> Void)? {
        get { HomeStub.onActiveChanged }
        set { HomeStub.onActiveChanged = newValue }
    }

    func category(_ id: String) -> String {
        guard let t = template(id) else { return "Lyrics" }
        if let c = t.manifest["category"] as? String, !c.isEmpty { return c }
        return t.builtin ? "Lyrics" : "Yours"
    }
}

extension Engine {
    func templateID(for screen: NSScreen) -> String { store.activeID(for: displayID(screen)) }
}
