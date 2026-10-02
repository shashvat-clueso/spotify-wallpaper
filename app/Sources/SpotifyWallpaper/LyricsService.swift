import Foundation

/// Synced lyrics from LRCLIB (free, no key), cached per track.
final class LyricsService {
    private let cacheDir: URL

    init(paths: Paths) {
        cacheDir = paths.caches.appendingPathComponent("Lyrics")
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
    }

    func fetch(_ track: Track) async -> Lyrics {
        let safe = track.id.replacingOccurrences(of: "[^A-Za-z0-9]", with: "_", options: .regularExpression)
        let file = cacheDir.appendingPathComponent(safe + ".json")

        var record: [String: Any]?
        if let data = try? Data(contentsOf: file) {
            record = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        }
        if record == nil {
            var get = URLComponents(string: "https://lrclib.net/api/get")!
            get.queryItems = [
                .init(name: "track_name", value: track.title),
                .init(name: "artist_name", value: track.artist),
                .init(name: "album_name", value: track.album),
                .init(name: "duration", value: String(Int(track.duration.rounded()))),
            ]
            if let exact = await getJSON(get.url!) as? [String: Any], exact["id"] != nil {
                record = exact
            } else {
                // fuzzy search with a cleaned-up title ("Song - Remastered 2011" -> "Song")
                let clean = track.title.components(separatedBy: " - ")[0].components(separatedBy: " (feat")[0]
                var search = URLComponents(string: "https://lrclib.net/api/search")!
                search.queryItems = [.init(name: "track_name", value: clean), .init(name: "artist_name", value: track.artist)]
                guard let any = await getJSON(search.url!) else { return .none }  // offline: don't cache, retry later
                let results = (any as? [[String: Any]]) ?? []
                record = results.sorted { a, b in
                    let sa = a["syncedLyrics"] is String, sb = b["syncedLyrics"] is String
                    if sa != sb { return sa }
                    let da = abs(((a["duration"] as? Double) ?? 0) - track.duration)
                    let db = abs(((b["duration"] as? Double) ?? 0) - track.duration)
                    return da < db
                }.first ?? [:]
            }
            if let data = try? JSONSerialization.data(withJSONObject: record ?? [:]) {
                try? data.write(to: file)
            }
        }

        if let synced = record?["syncedLyrics"] as? String, !synced.isEmpty {
            return Lyrics(lines: Self.parseLRC(synced), synced: true)
        }
        if let plain = record?["plainLyrics"] as? String, !plain.isEmpty {
            // no timestamps: spread the lines evenly across the song as a rough guess
            let lines = plain.components(separatedBy: .newlines)
                .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            let start = track.duration * 0.08, end = track.duration * 0.95
            let step = (end - start) / Double(max(1, lines.count))
            return Lyrics(lines: lines.enumerated().map { LyricLine(t: start + Double($0.offset) * step, text: $0.element) },
                          synced: false)
        }
        return .none
    }

    static func parseLRC(_ text: String) -> [LyricLine] {
        let stamp = try! NSRegularExpression(pattern: #"\[(\d+):(\d+(?:\.\d+)?)\]"#)
        let tag = try! NSRegularExpression(pattern: #"\[[^\]]*\]"#)
        var lines: [LyricLine] = []
        for raw in text.components(separatedBy: .newlines) {
            let ns = raw as NSString
            let lyric = tag.stringByReplacingMatches(in: raw, range: NSRange(location: 0, length: ns.length), withTemplate: "")
                .trimmingCharacters(in: .whitespaces)
            for m in stamp.matches(in: raw, range: NSRange(location: 0, length: ns.length)) {
                let min = Double(ns.substring(with: m.range(at: 1))) ?? 0
                let sec = Double(ns.substring(with: m.range(at: 2))) ?? 0
                lines.append(LyricLine(t: min * 60 + sec, text: lyric))
            }
        }
        return lines.sorted { $0.t < $1.t }
    }

    private func getJSON(_ url: URL) async -> Any? {
        var req = URLRequest(url: url, timeoutInterval: 8)
        req.setValue("SpotifyWallpaper/1.0", forHTTPHeaderField: "User-Agent")
        guard let (data, _) = try? await URLSession.shared.data(for: req) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }
}
