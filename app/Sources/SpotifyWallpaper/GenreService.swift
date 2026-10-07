import Foundation

/// The artist's genre from the iTunes Search API (keyless), e.g. "Alternative". Cached per artist in memory and on
/// disk; "not found" is re-checked after a week, failed requests on the next song by that artist.
actor GenreService {
    private let file: URL
    private var cache: [String: [String: Any]]  // artist key → ["genre": String, "at": seconds since 1970]

    init(paths: Paths) {
        file = paths.caches.appendingPathComponent("genres.json")
        cache = (try? Data(contentsOf: file)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: [String: Any]] } ?? [:]
    }

    /// "" when unknown.
    func genre(artist: String, title: String) async -> String {
        let key = Match.normalize(artist)
        guard !key.isEmpty else { return "" }
        if let hit = cache[key], let g = hit["genre"] as? String,
           !g.isEmpty || Date().timeIntervalSince1970 - (hit["at"] as? Double ?? 0) < 7 * 86_400 { return g }
        guard let found = await lookup(artist: artist, title: title) else { return "" }  // offline: ask again next time
        cache[key] = ["genre": found, "at": Date().timeIntervalSince1970]
        if let data = try? JSONSerialization.data(withJSONObject: cache) { try? data.write(to: file, options: .atomic) }
        return found
    }

    /// nil = the request failed.
    private func lookup(artist: String, title: String) async -> String? {
        // Spotify can list several artists ("A, B"); try the whole string, then the first one
        var names = [artist]
        if let first = artist.split(separator: #/,\s|\s&\s|\s(?:feat|ft)\.?\s/#).first.map(String.init), first != artist { names.append(first) }
        for name in names {
            guard let results = await search(term: name, entity: "musicArtist") else { return nil }
            let best = results.compactMap { r -> (String, Double)? in
                guard let g = r["primaryGenreName"] as? String, !g.isEmpty else { return nil }
                let s = Match.similarity(r["artistName"] as? String ?? "", name)
                return s >= 0.8 ? (g, s) : nil
            }.max { $0.1 < $1.1 }  // results come in relevance order; max keeps the first of equals
            if let best { return best.0 }
        }
        // no artist page (or no genre on it): the song itself has one
        guard let songs = await search(term: "\(names.last!) \(Match.cleanTitle(title))", entity: "song") else { return nil }
        let song = songs.first {
            Match.similarity($0["artistName"] as? String ?? "", names.last!) >= 0.6
                && Match.similarity($0["trackName"] as? String ?? "", Match.cleanTitle(title)) >= 0.6
        }
        return song?["primaryGenreName"] as? String ?? ""
    }

    private func search(term: String, entity: String) async -> [[String: Any]]? {
        var url = URLComponents(string: "https://itunes.apple.com/search")!
        url.queryItems = [.init(name: "term", value: term), .init(name: "entity", value: entity), .init(name: "limit", value: "5")]
        let req = URLRequest(url: url.url!, timeoutInterval: 4)
        guard let (data, response) = try? await URLSession.shared.data(for: req), (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json["results"] as? [[String: Any]] ?? []
    }
}
