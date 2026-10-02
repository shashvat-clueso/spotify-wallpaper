import Foundation

/// Lyrics from one source.
struct LyricCandidate {
    let source: String  // "LRCLIB", "NetEase", "QQ Music", "Kugou"
    let lines: [LyricLine]
    let synced: Bool

    var json: [String: Any] {
        ["source": source, "synced": synced, "lines": lines.map { ["t": $0.t, "text": $0.text] }]
    }

    init(source: String, lines: [LyricLine], synced: Bool) {
        self.source = source; self.lines = lines; self.synced = synced
    }

    init?(json: [String: Any]) {
        guard let source = json["source"] as? String, let raw = json["lines"] as? [[String: Any]] else { return nil }
        self.init(source: source,
                  lines: raw.compactMap { d in (d["t"] as? Double).map { LyricLine(t: $0, text: d["text"] as? String ?? "") } },
                  synced: json["synced"] as? Bool ?? false)
    }
}

/// Fetches lyrics from several free sources in parallel and builds consensus timing from the synced ones.
final class LyricsService {
    static let sources = ["LRCLIB", "NetEase", "QQ Music", "Kugou"]
    private let cacheDir: URL

    init(paths: Paths) {
        cacheDir = paths.caches.appendingPathComponent("Lyrics")
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
    }

    /// Every source's result for the track. Results are cached; "not found" is re-checked after a day, and sources
    /// that failed (offline, timeout, rate-limited) are retried next time.
    func candidates(for track: Track, refresh: Bool = false) async -> [LyricCandidate] {
        let file = cacheFile(track)
        var cached: [String: Any] = [:]
        if !refresh, let data = try? Data(contentsOf: file) {
            cached = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        }
        let now = Date().timeIntervalSince1970
        let missing = Self.sources.filter { source in
            guard let entry = cached[source] as? [String: Any] else { return true }
            if let checked = entry["notFoundAt"] as? Double { return now - checked > 86_400 }  // look again daily
            return false
        }
        if !missing.isEmpty {
            let fetched = await withTaskGroup(of: (String, LyricCandidate??).self) { group in
                for source in missing {
                    group.addTask { (source, await self.fetch(source, track)) }
                }
                var out: [(String, LyricCandidate??)] = []
                for await r in group { out.append(r) }
                return out
            }
            for (source, result) in fetched {
                switch result {
                case .none: break                                   // request failed: retry later
                case .some(.none): cached[source] = ["notFoundAt": now]  // answered, nothing found
                case .some(.some(let c)): cached[source] = c.json
                }
            }
            if let data = try? JSONSerialization.data(withJSONObject: cached) { try? data.write(to: file) }
        }
        return Self.sources.compactMap { (cached[$0] as? [String: Any]).flatMap(LyricCandidate.init(json:)) }
    }

    private func cacheFile(_ track: Track) -> URL {
        let safe = track.id.replacingOccurrences(of: "[^A-Za-z0-9]", with: "_", options: .regularExpression)
        return cacheDir.appendingPathComponent(safe + ".v3.json")
    }

    /// nil = request failed; .some(nil) = the source answered but has no lyrics for this track.
    private func fetch(_ source: String, _ track: Track) async -> LyricCandidate?? {
        switch source {
        case "LRCLIB": return await LRCLIB.fetch(track)
        case "NetEase": return await NetEase.fetch(track)
        case "QQ Music": return await QQMusic.fetch(track)
        case "Kugou": return await Kugou.fetch(track)
        default: return .some(nil)
        }
    }

    // MARK: choosing / combining

    /// "Combined" builds consensus timing from every synced source; otherwise the named source is used.
    static func resolve(_ candidates: [LyricCandidate], choice: String, duration: Double) -> (Lyrics, String) {
        if choice != "Combined", let c = candidates.first(where: { $0.source == choice }) {
            return (lyrics(from: c, duration: duration), c.source)
        }
        let synced = candidates.filter { $0.synced && $0.lines.count >= 3 }
        if !synced.isEmpty {
            let (lines, used) = Consensus.combine(synced)
            return (Lyrics(lines: lines, synced: true), used.joined(separator: ", "))
        }
        if let plain = candidates.first(where: { !$0.lines.isEmpty }) {
            return (lyrics(from: plain, duration: duration), plain.source + " (unsynced)")
        }
        return (.none, "")
    }

    private static func lyrics(from c: LyricCandidate, duration: Double) -> Lyrics {
        if c.synced { return Lyrics(lines: c.lines, synced: true) }
        // no timestamps: spread the lines evenly across the song as a rough guess
        let start = duration * 0.08, end = duration * 0.95
        let step = (end - start) / Double(max(1, c.lines.count))
        return Lyrics(lines: c.lines.enumerated().map { LyricLine(t: start + Double($0.offset) * step, text: $0.element.text) },
                      synced: false)
    }

    // MARK: parsing helpers shared by the sources

    static func parseLRC(_ text: String, track: Track) -> [LyricLine] {
        let stamp = try! NSRegularExpression(pattern: #"\[(\d+):(\d+(?:[.:]\d+)?)\]"#)
        let tag = try! NSRegularExpression(pattern: #"\[[^\]]*\]"#)
        var lines: [LyricLine] = []
        for raw in decodeEntities(text).components(separatedBy: .newlines) {
            let ns = raw as NSString
            var lyric = tag.stringByReplacingMatches(in: raw, range: NSRange(location: 0, length: ns.length), withTemplate: "")
                .trimmingCharacters(in: .whitespaces)
            if lyric.range(of: #"^[♪♫♬♩\s.…]*$"#, options: .regularExpression) != nil { lyric = "" }  // instrumental gap
            for m in stamp.matches(in: raw, range: NSRange(location: 0, length: ns.length)) {
                let min = Double(ns.substring(with: m.range(at: 1))) ?? 0
                let sec = Double(ns.substring(with: m.range(at: 2)).replacingOccurrences(of: ":", with: ".")) ?? 0
                lines.append(LyricLine(t: min * 60 + sec, text: lyric))
            }
        }
        lines.sort { $0.t < $1.t }
        return lines.filter { !isCredit($0, track: track) }
    }

    /// Credit/header lines some sources put at the top ("作词 : …", "Lyrics by …", "Title - Artist").
    private static func isCredit(_ line: LyricLine, track: Track) -> Bool {
        let text = line.text
        if text.range(of: #"^\s*(作词|作詞|作曲|编曲|編曲|制作|製作|制作人|製作人|混音|母带|和声|吉他|贝斯|鼓|录音|錄音|监制|監製|出品|词|詞|曲|演唱|原唱|歌|OP|SP|작사|작곡|편곡|노래)\s*[:：]"#,
                      options: .regularExpression) != nil { return true }
        if text.range(of: #"^\s*(lyrics|written|composed|produced|producer|composer|lyricist|arranger|music|vocals?|mixed|mastered)\s*(by)?\s*[:：]"#,
                      options: [.regularExpression, .caseInsensitive]) != nil { return true }
        if line.t < 15 {
            let n = Match.normalize(text)
            if n.contains(Match.normalize(Match.cleanTitle(track.title))) && n.contains(Match.normalize(track.artist)) { return true }
        }
        return false
    }

    private static func decodeEntities(_ s: String) -> String {
        guard s.contains("&") else { return s }
        var out = s
        for (k, v) in ["&apos;": "'", "&#39;": "'", "&quot;": "\"", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&#58;": ":",
                       "&#46;": ".", "&#45;": "-", "&#32;": " ", "&#10;": "\n", "&#13;": ""] {
            out = out.replacingOccurrences(of: k, with: v)
        }
        return out
    }

    /// No cookies: the lyric sites set tracking cookies and start serving decoy results to clients that send them back.
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCache = nil
        return URLSession(configuration: config)
    }()

    static func getData(_ url: URL, headers: [String: String] = [:], body: Data? = nil) async -> Data? {
        var req = URLRequest(url: url, timeoutInterval: 7)
        req.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
                     forHTTPHeaderField: "User-Agent")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        if let body { req.httpMethod = "POST"; req.httpBody = body }
        guard let (data, response) = try? await session.data(for: req),
              let http = response as? HTTPURLResponse, http.statusCode < 500 else { return nil }
        return data
    }

    static func getJSON(_ url: URL, headers: [String: String] = [:], body: Data? = nil) async -> Any? {
        guard let data = await getData(url, headers: headers, body: body) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) ?? [:]
    }
}

// MARK: - text matching

enum Match {
    static func normalize(_ s: String) -> String {
        let lowered = s.lowercased().folding(options: .diacriticInsensitive, locale: nil)
        let noBrackets = lowered.replacingOccurrences(of: #"\([^)]*\)|\[[^\]]*\]"#, with: " ", options: .regularExpression)
        let letters = noBrackets.replacingOccurrences(of: #"[^\p{L}\p{N}]+"#, with: " ", options: .regularExpression)
        return letters.trimmingCharacters(in: .whitespaces)
    }

    /// Title without "- Remastered 2011", "(feat. …)" etc.
    static func cleanTitle(_ s: String) -> String {
        let base = s.components(separatedBy: " - ")[0]
        return base.replacingOccurrences(of: #"\s*[\(\[](feat|with|ft)\.?[^\)\]]*[\)\]]"#, with: "", options: [.regularExpression, .caseInsensitive])
    }

    /// Dice coefficient on character bigrams of normalized text, 0…1.
    static func similarity(_ a: String, _ b: String) -> Double {
        let x = Array(normalize(a).replacingOccurrences(of: " ", with: "")), y = Array(normalize(b).replacingOccurrences(of: " ", with: ""))
        if x.isEmpty || y.isEmpty { return x == y ? 1 : 0 }
        if x == y { return 1 }
        guard x.count > 1, y.count > 1 else { return 0 }
        var bigrams: [String: Int] = [:]
        for i in 0..<(x.count - 1) { bigrams[String(x[i...i + 1]), default: 0] += 1 }
        var hits = 0
        for i in 0..<(y.count - 1) {
            let k = String(y[i...i + 1])
            if let n = bigrams[k], n > 0 { hits += 1; bigrams[k] = n - 1 }
        }
        return 2 * Double(hits) / Double(x.count + y.count - 2)
    }

    /// Words marking a different recording. These must match both ways: a remix only pairs with remixes, and the
    /// original only with originals.
    private static let versionWords = ["remix", "live", "acoustic", "cover", "instrumental", "karaoke", "sped up", "slowed",
                                       "reverb", "nightcore", "demo", "english", "spanish", "portuguese", "korean", "japanese",
                                       "chinese", "伴奏", "现场", "翻唱"]
    /// Minor labels sources often leave out: only rejected when the hit has one the Spotify title doesn't.
    private static let minorWords = ["version", "ver.", "edit", "mix", "dj"]

    private static func marks(_ title: String, _ words: [String]) -> Set<String> {
        let t = " " + title.lowercased().replacingOccurrences(of: #"[^\p{L}\p{N}.]+"#, with: " ", options: .regularExpression) + " "
        return Set(words.filter { t.contains(" \($0) ") || (!$0.allSatisfy(\.isASCII) && t.contains($0)) })
    }

    /// How well a search hit matches the track; nil if it's clearly a different song or another version of it.
    static func score(title: String, artist: String, duration: Double?, for track: Track) -> Double? {
        guard marks(title, versionWords) == marks(track.title, versionWords),
              marks(title, minorWords).isSubset(of: marks(track.title, minorWords)) else { return nil }
        let t = max(similarity(title, track.title), similarity(cleanTitle(title), cleanTitle(track.title)))
        let a = similarity(artist, track.artist)
        let artistOK = a > 0.5 || normalize(artist).contains(normalize(track.artist).components(separatedBy: " ").first ?? "")
        guard t >= 0.6, artistOK else { return nil }
        var score = t + a * 0.5
        if let d = duration, d > 0 {
            let diff = abs(d - track.duration)
            guard diff <= 6 else { return nil }
            score -= diff / 10
        }
        return score
    }
}

// MARK: - consensus timing

enum Consensus {
    /// Matches lines across sources by text and takes the median timestamp per line. The source that agrees most
    /// with the others provides the text; sources whose timing is far off (another version, bad sync) are dropped.
    static func combine(_ candidates: [LyricCandidate]) -> ([LyricLine], [String]) {
        guard candidates.count > 1 else { return (candidates[0].lines, [candidates[0].source]) }

        // pairwise median timing difference between sources
        var deviation = [[Double]](repeating: [Double](repeating: 0, count: candidates.count), count: candidates.count)
        for i in candidates.indices {
            for j in candidates.indices where j != i {
                // the same song needs a good share of lines to match, not just a shared chorus (measured: another
                // version ~10-20%, the same song in another script ~40%, same song and script 75-100%)
                let pairs = align(candidates[i].lines, candidates[j].lines)
                let textLines = [candidates[i].lines, candidates[j].lines]
                    .map { $0.filter { Match.normalize($0.text).count >= 3 }.count }.min()!
                let coverage = Double(pairs.count) / Double(max(1, textLines))
                deviation[i][j] = pairs.count >= 3 && coverage >= 0.3 ? median(pairs.map { abs($0.1 - $0.0) }) : 99
            }
        }
        // the reference is the source closest to everyone else; sources far from it (another version, bad sync) drop out
        let reference = candidates.indices.min { deviation[$0].reduce(0, +) < deviation[$1].reduce(0, +) }!
        var inliers: [Int] = []
        for i in candidates.indices where i == reference || deviation[reference][i] <= 1.5 {
            // some sources share a catalogue (QQ Music and Kugou are both Tencent); identical timing votes once
            if inliers.contains(where: { deviation[$0][i] < 0.03 }) { continue }
            inliers.append(i)
        }
        // line text comes from the best-edited inlier (candidates arrive in preference order: LRCLIB first)
        let base = inliers.min()!

        var times = candidates[base].lines.map { [$0.t] }
        for j in inliers where j != base {
            for (bi, t) in alignIndices(candidates[base].lines, candidates[j].lines) { times[bi].append(t) }
        }
        var out: [LyricLine] = []
        var last = -Double.infinity
        for (k, line) in candidates[base].lines.enumerated() {
            let t = max(median(times[k]), last + 0.01)  // keep lines in order
            out.append(LyricLine(t: t, text: line.text))
            last = t
        }
        let used = [candidates[base].source] + inliers.filter { $0 != base }.map { candidates[$0].source }
        return (out, used)
    }

    /// (time in a, time in b) for lines that match.
    static func align(_ a: [LyricLine], _ b: [LyricLine]) -> [(Double, Double)] {
        alignIndices(a, b).map { (a[$0.0].t, $0.1) }
    }

    /// Greedy in-order alignment: each line of `a` is matched to the most similar unused line of `b` nearby in time.
    static func alignIndices(_ a: [LyricLine], _ b: [LyricLine]) -> [(Int, Double)] {
        var out: [(Int, Double)] = []
        var j0 = 0
        for (i, line) in a.enumerated() {
            let text = Match.normalize(line.text)
            guard text.count >= 3 else { continue }
            var best = -1, bestSim = 0.72
            var j = j0
            while j < b.count && b[j].t < line.t + 12 {
                if b[j].t > line.t - 12 {
                    let s = Match.similarity(line.text, b[j].text)
                    if s > bestSim { bestSim = s; best = j }
                }
                j += 1
            }
            if best >= 0 {
                out.append((i, b[best].t))
                j0 = best + 1
            }
        }
        return out
    }

    static func median(_ xs: [Double]) -> Double {
        let s = xs.sorted()
        guard !s.isEmpty else { return 0 }
        return s.count % 2 == 1 ? s[s.count / 2] : (s[s.count / 2 - 1] + s[s.count / 2]) / 2
    }
}

// MARK: - sources

private enum LRCLIB {
    static func fetch(_ t: Track) async -> LyricCandidate?? {
        var get = URLComponents(string: "https://lrclib.net/api/get")!
        get.queryItems = [.init(name: "track_name", value: t.title), .init(name: "artist_name", value: t.artist),
                          .init(name: "album_name", value: t.album), .init(name: "duration", value: String(Int(t.duration.rounded())))]
        var record = await LyricsService.getJSON(get.url!) as? [String: Any]
        if record?["id"] == nil {
            var search = URLComponents(string: "https://lrclib.net/api/search")!
            search.queryItems = [.init(name: "track_name", value: Match.cleanTitle(t.title)), .init(name: "artist_name", value: t.artist)]
            guard let any = await LyricsService.getJSON(search.url!) else { return nil }
            let results = (any as? [[String: Any]] ?? []).filter {
                Match.score(title: $0["trackName"] as? String ?? "", artist: $0["artistName"] as? String ?? "",
                            duration: $0["duration"] as? Double, for: t) != nil
            }
            record = results.sorted { a, b in
                let sa = a["syncedLyrics"] is String, sb = b["syncedLyrics"] is String
                if sa != sb { return sa }
                return abs(((a["duration"] as? Double) ?? 0) - t.duration) < abs(((b["duration"] as? Double) ?? 0) - t.duration)
            }.first
        }
        if let synced = record?["syncedLyrics"] as? String, !synced.isEmpty {
            return .some(LyricCandidate(source: "LRCLIB", lines: LyricsService.parseLRC(synced, track: t), synced: true))
        }
        if let plain = record?["plainLyrics"] as? String, !plain.isEmpty {
            let lines = plain.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            return .some(LyricCandidate(source: "LRCLIB", lines: lines.map { LyricLine(t: 0, text: $0) }, synced: false))
        }
        return .some(nil)
    }
}

private enum NetEase {
    static let headers = ["Referer": "https://music.163.com"]

    static func fetch(_ t: Track) async -> LyricCandidate?? {
        var search = URLComponents(string: "https://music.163.com/api/search/get")!
        search.queryItems = [.init(name: "s", value: "\(Match.cleanTitle(t.title)) \(t.artist)"), .init(name: "type", value: "1"),
                             .init(name: "limit", value: "10")]
        guard let res = await LyricsService.getJSON(search.url!, headers: headers) as? [String: Any],
              res["code"] as? Int == 200 else { return nil }  // anything else is an error or a rate limit
        let songs = ((res["result"] as? [String: Any])?["songs"] as? [[String: Any]]) ?? []
        let best = songs.compactMap { s -> (Int, Double)? in
            guard let id = s["id"] as? Int else { return nil }
            let artist = ((s["artists"] as? [[String: Any]])?.first?["name"] as? String) ?? ""
            let ms = (s["duration"] as? Double) ?? 0
            return Match.score(title: s["name"] as? String ?? "", artist: artist, duration: ms > 0 ? ms / 1000 : nil, for: t).map { (id, $0) }
        }.max { $0.1 < $1.1 }
        guard let id = best?.0 else { return .some(nil) }
        let url = URL(string: "https://music.163.com/api/song/lyric?id=\(id)&lv=1")!
        guard let ly = await LyricsService.getJSON(url, headers: headers) as? [String: Any], ly["code"] as? Int == 200 else { return nil }
        let lrc = (ly["lrc"] as? [String: Any])?["lyric"] as? String ?? ""
        let lines = LyricsService.parseLRC(lrc, track: t)
        return .some(lines.count >= 3 ? LyricCandidate(source: "NetEase", lines: lines, synced: true) : nil)
    }
}

private enum QQMusic {
    static let headers = ["Referer": "https://y.qq.com", "Content-Type": "application/json"]

    static func fetch(_ t: Track) async -> LyricCandidate?? {
        let body: [String: Any] = [
            "comm": ["ct": 19, "cv": 1859],
            "req": ["method": "DoSearchForQQMusicDesktop", "module": "music.search.SearchCgiService",
                    "param": ["query": "\(Match.cleanTitle(t.title)) \(t.artist)", "num_per_page": 10, "page_num": 1, "search_type": 0]],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body),
              let res = await LyricsService.getJSON(URL(string: "https://u.y.qq.com/cgi-bin/musicu.fcg")!, headers: headers, body: data)
                as? [String: Any], (res["req"] as? [String: Any])?["code"] as? Int == 0 else { return nil }  // 2001 = throttled
        let list = ((((res["req"] as? [String: Any])?["data"] as? [String: Any])?["body"] as? [String: Any])?["song"]
            as? [String: Any])?["list"] as? [[String: Any]] ?? []
        let best = list.compactMap { s -> (String, Double)? in
            guard let mid = s["mid"] as? String else { return nil }
            let artist = ((s["singer"] as? [[String: Any]])?.first?["name"] as? String) ?? ""
            return Match.score(title: s["title"] as? String ?? "", artist: artist, duration: s["interval"] as? Double, for: t).map { (mid, $0) }
        }.max { $0.1 < $1.1 }
        guard let mid = best?.0 else { return .some(nil) }
        var lyric = URLComponents(string: "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg")!
        lyric.queryItems = [.init(name: "songmid", value: mid), .init(name: "format", value: "json"),
                            .init(name: "nobase64", value: "1"), .init(name: "g_tk", value: "5381")]
        guard let ly = await LyricsService.getJSON(lyric.url!, headers: ["Referer": "https://y.qq.com"]) as? [String: Any],
              ly["retcode"] as? Int ?? ly["code"] as? Int == 0 else { return nil }
        let lines = LyricsService.parseLRC(ly["lyric"] as? String ?? "", track: t)
        return .some(lines.count >= 3 ? LyricCandidate(source: "QQ Music", lines: lines, synced: true) : nil)
    }
}

private enum Kugou {
    static func fetch(_ t: Track) async -> LyricCandidate?? {
        var search = URLComponents(string: "https://lyrics.kugou.com/search")!
        search.queryItems = [.init(name: "ver", value: "1"), .init(name: "man", value: "yes"), .init(name: "client", value: "pc"),
                             .init(name: "keyword", value: "\(t.artist) - \(Match.cleanTitle(t.title))"),
                             .init(name: "duration", value: String(Int(t.duration * 1000))), .init(name: "hash", value: "")]
        guard let res = await LyricsService.getJSON(search.url!) as? [String: Any], res["status"] as? Int == 200 else { return nil }
        let candidates = res["candidates"] as? [[String: Any]] ?? []
        let best = candidates.compactMap { c -> ([String: Any], Double)? in
            let ms = (c["duration"] as? Double) ?? 0
            return Match.score(title: c["song"] as? String ?? "", artist: c["singer"] as? String ?? "",
                               duration: ms > 0 ? ms / 1000 : nil, for: t).map { (c, $0) }
        }.max { $0.1 < $1.1 }?.0
        guard let best, let id = best["id"].map({ "\($0)" }), let key = best["accesskey"] as? String else { return .some(nil) }
        var download = URLComponents(string: "https://lyrics.kugou.com/download")!
        download.queryItems = [.init(name: "ver", value: "1"), .init(name: "client", value: "pc"), .init(name: "id", value: id),
                               .init(name: "accesskey", value: key), .init(name: "fmt", value: "lrc"), .init(name: "charset", value: "utf8")]
        guard let d = await LyricsService.getJSON(download.url!) as? [String: Any], d["status"] as? Int == 200 else { return nil }
        guard let b64 = d["content"] as? String, let raw = Data(base64Encoded: b64), let lrc = String(data: raw, encoding: .utf8) else {
            return .some(nil)
        }
        let lines = LyricsService.parseLRC(lrc, track: t)
        return .some(lines.count >= 3 ? LyricCandidate(source: "Kugou", lines: lines, synced: true) : nil)
    }
}
