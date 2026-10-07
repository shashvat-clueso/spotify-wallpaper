import AppKit
import CryptoKit
import WebKit

/// Two outputs per screen:
///  - a live, animated layer just above the wallpaper (DesktopLayer), fed state + a 0.1s playback clock;
///    the template's own clock picks the lyric line, so it changes exactly on the line's timestamp
///  - the real wallpaper, a still of the same song, redrawn only when the track/template/settings change
///    (lock screen, Mission Control, and whenever the app isn't running)
@MainActor
final class Engine {
    let store: TemplateStore
    private let paths: Paths
    private let spotify = SpotifyMonitor()
    private let lyricsService: LyricsService
    private let setter: WallpaperSetter
    private(set) lazy var schemeHandler = SchemeHandler(paths: paths, store: store)

    private(set) var track: Track?
    private var pollStamp: Double = 0  // ms since 1970 when `track.position` was read
    private var lyrics = Lyrics.none
    private var candidates: [LyricCandidate] = []
    /// Which source(s) the current lyrics came from, for the menu.
    private(set) var lyricsSourceText = ""
    private var coverData: Data?
    /// Identifies the cover image itself, so templates can tell "new song, same album art" from a new cover.
    private var coverKey = ""
    private var colors: [String: Any] = Palette.extract(from: nil)
    private var loadedTrackID: String?
    private var loadingTrackID: String?

    private var layers: [CGDirectDisplayID: DesktopLayer] = [:]
    private var renderers: [CGDirectDisplayID: ScreenRenderer] = [:]
    private var liveKey = ""
    private var stillKey = ""
    private var stillRendering = false
    private var generation = 0  // bumped when template code changes on disk
    private var liveEpoch = 0   // bumped on every settings change
    private var stillEpoch = 0  // bumped once settings stop changing
    private var editStamp: Date?
    private var stillDebounce: Task<Void, Never>?
    private var latestTrack: Track?
    private var latestStamp: Double = 0
    /// When Spotify first stopped reporting a track. Skipping or seeking can make a single reading come back empty,
    /// so the wallpaper is only given back once nothing has played for `goneGrace` seconds.
    private var goneSince: Date?
    private static let goneGrace: TimeInterval = 5

    /// Called when the preview in the Customize window should get new state / a clock tick.
    var onStateChange: (() -> Void)?
    var onClock: ((String) -> Void)?
    var onTemplateFilesChanged: (() -> Void)?
    /// The finished still for the primary screen (JPEG), the track and template it shows. Feeds the history.
    var onStillRendered: ((Data, NSScreen, Track, String) -> Void)?

    /// Lyrics hidden (screen sharing / Focus Mode): sent as `focus` to the live layers and the still.
    var focus = false {
        didSet {
            guard focus != oldValue else { return }
            liveEpoch += 1
            stillEpoch += 1
            tick()
        }
    }

    var paused: Bool {
        get { UserDefaults.standard.bool(forKey: "paused") }
        set {
            UserDefaults.standard.set(newValue, forKey: "paused")
            if newValue { hideLayers(); setter.restore() }
            invalidate()
        }
    }

    /// Frames per second for the live layer's per-frame animation; 0 = the display's maximum.
    static let refreshRates = [0, 60, 30, 15]
    var refreshRate: Int {
        get { UserDefaults.standard.object(forKey: "refreshRate") as? Int ?? 0 }
        set {
            UserDefaults.standard.set(newValue, forKey: "refreshRate")
            liveEpoch += 1
            tick()
        }
    }

    var nowPlayingText: String {
        guard let t = track else { return "Spotify isn't playing" }
        return "\(t.title) — \(t.artist)"
    }

    init(store: TemplateStore, paths: Paths) {
        self.store = store
        self.paths = paths
        lyricsService = LyricsService(paths: paths)
        setter = WallpaperSetter(paths: paths)
    }

    func makeWebConfiguration(throttleWhenHidden: Bool = false) -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "sw")
        if !throttleWhenHidden { config.preferences.inactiveSchedulingPolicy = .none }
        return config
    }

    func start() {
        schemeHandler.cover = { [weak self] in self?.coverData }
        // Spotify is read on its own thread; each reading lands here
        spotify.onUpdate = { [weak self] track, stamp in
            guard let self else { return }
            if track == nil, self.latestTrack != nil {
                let since = self.goneSince ?? Date()
                self.goneSince = since
                if Date().timeIntervalSince(since) < Self.goneGrace { return }  // probably a skip/seek blip: hold on
            }
            self.goneSince = nil
            self.latestTrack = track
            self.latestStamp = stamp
            self.tick()
        }
        spotify.start()
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.checkTemplateEdits() }
        }
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.setter.reapply() }
        }
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.screensChanged() }
        }
        tick()
    }

    func shutdown() {
        hideLayers()
        setter.restore()
    }

    /// Redraw everything, e.g. after switching templates.
    func invalidate() {
        liveKey = ""
        stillKey = ""
        tick()
    }

    /// Settings changed: the live layer updates immediately, the still once the sliders stop moving.
    func paramsChanged() {
        liveEpoch += 1
        tick()
        stillDebounce?.cancel()
        stillDebounce = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled, let self else { return }
            self.stillEpoch += 1
            self.tick()
        }
    }

    private func screensChanged() {
        layers.values.forEach { $0.close() }
        layers.removeAll()
        renderers.values.forEach { $0.close() }
        renderers.removeAll()
        invalidate()
    }

    // MARK: main loop

    private func tick() {
        let previousID = track?.id
        track = latestTrack
        pollStamp = latestStamp
        guard let t = track else {
            hideLayers()
            setter.restore()
            liveKey = ""
            stillKey = ""
            if previousID != nil { onStateChange?() }
            return
        }
        if t.id != loadedTrackID && t.id != loadingTrackID {
            loadingTrackID = t.id
            Task { await load(t) }
        }
        guard loadedTrackID == t.id, !paused, let template = store.active else { return }

        // live layers
        syncLayers(template)
        let lk = "\(t.id)|\(template.id)|\(generation)|\(liveEpoch)"
        if lk != liveKey {
            liveKey = lk
            for (id, layer) in layers {
                let screen = NSScreen.screens.first { displayID($0) == id }
                var payload = statePayload(for: screen)
                payload["params"] = store.values(template.id)
                payload["fps"] = refreshRate
                payload["focus"] = focus
                layer.sendState(jsonString(payload))
            }
            onStateChange?()
        }
        let clock = jsonString(["position": t.position, "isPlaying": t.isPlaying, "stamp": pollStamp])
        layers.values.forEach { $0.sendClock(clock); $0.show() }
        onClock?(clock)

        // real wallpaper still
        let sk = "\(t.id)|\(template.id)|\(generation)|\(stillEpoch)"
        if sk != stillKey && !stillRendering {
            stillKey = sk
            Task { await renderStill(template) }
        }
    }

    private func syncLayers(_ template: WallpaperTemplate) {
        var url = URLComponents(url: template.url, resolvingAgainstBaseURL: false)!
        url.queryItems = [.init(name: "v", value: String(generation)), .init(name: "live", value: "1")]
        for screen in NSScreen.screens {
            let id = displayID(screen)
            if layers[id]?.frame != screen.frame {
                layers[id]?.close()
                layers[id] = DesktopLayer(screen: screen, configuration: makeWebConfiguration(throttleWhenHidden: true))
                liveKey = ""
            }
            layers[id]?.load(url.url!)
        }
    }

    private func hideLayers() { layers.values.forEach { $0.hide() } }

    private func load(_ t: Track) async {
        async let cover = download(t.artworkURL)
        async let found = lyricsService.candidates(for: t)
        let (c, cs) = await (cover, found)
        coverData = c
        coverKey = c.map { SHA256.hash(data: $0).prefix(8).map { String(format: "%02x", $0) }.joined() } ?? ""
        colors = Palette.extract(from: c)
        candidates = cs
        loadedTrackID = t.id
        if loadingTrackID == t.id { loadingTrackID = nil }
        applyLyrics()
    }

    // MARK: lyrics source & timing (chosen per song, remembered)

    /// Sources that have lyrics for the current song, and whether each is synced.
    var lyricsSources: [(name: String, synced: Bool)] { candidates.map { ($0.source, $0.synced) } }

    /// "Combined" (consensus timing from every synced source) or one source's name.
    var lyricsChoice: String {
        get { loadedTrackID.flatMap { UserDefaults.standard.string(forKey: "lyricsChoice." + $0) } ?? "Combined" }
        set {
            guard let id = loadedTrackID else { return }
            UserDefaults.standard.set(newValue, forKey: "lyricsChoice." + id)
            applyLyrics()
        }
    }

    /// Seconds added to every timestamp: positive shows lines later, negative earlier.
    var lyricsOffset: Double {
        get { loadedTrackID.map { UserDefaults.standard.double(forKey: "lyricsOffset." + $0) } ?? 0 }
        set {
            guard let id = loadedTrackID else { return }
            UserDefaults.standard.set(newValue, forKey: "lyricsOffset." + id)
            applyLyrics()
        }
    }

    func refetchLyrics() {
        guard let t = track, t.id == loadedTrackID else { return }
        Task {
            candidates = await lyricsService.candidates(for: t, refresh: true)
            applyLyrics()
        }
    }

    private func applyLyrics() {
        var (resolved, source) = LyricsService.resolve(candidates, choice: lyricsChoice, duration: track?.duration ?? 0)
        let offset = lyricsOffset
        if offset != 0 { resolved.lines = resolved.lines.map { LyricLine(t: $0.t + offset, text: $0.text) } }
        lyrics = resolved
        lyricsSourceText = source
        liveEpoch += 1
        stillEpoch += 1
        tick()
    }

    private func download(_ url: String) async -> Data? {
        guard let u = URL(string: url) else { return nil }
        return try? await URLSession.shared.data(from: u).0
    }

    // MARK: still for the real wallpaper

    private func renderStill(_ template: WallpaperTemplate) async {
        stillRendering = true
        defer { stillRendering = false }
        var url = URLComponents(url: template.url, resolvingAgainstBaseURL: false)!
        url.queryItems = [.init(name: "v", value: String(generation))]
        let trackID = track?.id
        for screen in NSScreen.screens {
            let id = displayID(screen), size = screen.frame.size
            if renderers[id]?.size != size {
                renderers[id]?.close()
                renderers[id] = ScreenRenderer(size: size, configuration: makeWebConfiguration())
            }
            var payload = statePayload(for: screen)
            payload["params"] = store.values(template.id)
            payload["focus"] = focus
            guard let image = await renderers[id]?.render(url: url.url!, payload: payload) else { continue }
            let jpeg = await Task.detached { jpegData(image) }.value
            // the song may have changed or stopped while drawing
            guard let jpeg, !paused, track?.id == trackID, track != nil else { return }
            setter.show(jpeg, on: screen)
            if let t = track, screen == NSScreen.screens.first { onStillRendered?(jpeg, screen, t, template.id) }
        }
    }

    // MARK: state sent to templates

    func statePayload(for screen: NSScreen? = NSScreen.main) -> [String: Any] {
        let screenInfo: [String: Any] = [
            "width": screen?.frame.width ?? 1512, "height": screen?.frame.height ?? 982,
            "scale": screen?.backingScaleFactor ?? 2,
        ]
        guard let t = track, loadedTrackID == t.id else { return sample(screenInfo) }
        let safeID = t.id.replacingOccurrences(of: "[^A-Za-z0-9]", with: "_", options: .regularExpression)
        return [
            "track": ["id": t.id, "title": t.title, "artist": t.artist, "album": t.album,
                      "cover": "sw://app/cover/\(safeID).jpg", "coverKey": coverKey, "duration": t.duration,
                      "position": t.position, "isPlaying": t.isPlaying, "stamp": pollStamp],
            "lyrics": ["lines": lyrics.lines.map { ["t": $0.t, "text": $0.text] },
                       "index": lyrics.index(at: t.position), "synced": lyrics.synced],
            "colors": colors,
            "screen": screenInfo,
        ]
    }

    private lazy var sampleColors: [String: Any] =
        Palette.extract(from: try? Data(contentsOf: paths.web.appendingPathComponent("ui/sample-cover.jpg")))

    /// Shown in the preview when Spotify isn't playing.
    private func sample(_ screenInfo: [String: Any]) -> [String: Any] {
        let lines = ["Streetlights hum a song we used to know", "Your jacket on my shoulders, walking slow",
                     "The city sleeps but we're still wide awake", "Counting every chance we didn't take",
                     "", "Stay a little longer, stay till morning light",
                     "We can fold the stars up, keep them out of sight", "Stay a little longer, it's alright"]
        return [
            "track": ["id": "sample", "title": "Till Morning Light", "artist": "Sample Artist",
                      "album": "Preview Sessions", "cover": "sw://app/ui/sample-cover.jpg",
                      "duration": 214.0, "position": 71.0, "isPlaying": false,
                      "stamp": Date().timeIntervalSince1970 * 1000],
            "lyrics": ["lines": lines.enumerated().map { ["t": 52.0 + Double($0.offset) * 6, "text": $0.element] },
                       "index": 3, "synced": true],
            "colors": sampleColors,
            "screen": screenInfo,
        ]
    }

    // MARK: live reload while editing a template's code

    private func checkTemplateEdits() {
        let stamp = store.userTemplatesStamp()
        if let old = editStamp, stamp > old {
            store.reload()
            generation += 1
            onTemplateFilesChanged?()
            invalidate()
        }
        editStamp = stamp
    }
}
