import Foundation

/// Reads the Spotify desktop app's current track over AppleScript. No login or API key needed.
///
/// AppleScript round-trips are slow (~45 ms for position/state, ~100 ms for everything), so they run on a
/// dedicated thread, never on the main thread. Spotify announces play/pause/skip/seek with a distributed
/// notification, which triggers an immediate check; otherwise a light check runs once a second just to keep the
/// templates' own playback clocks in sync. The full lookup only runs when the track changes.
final class SpotifyMonitor: @unchecked Sendable {
    /// Called on the main thread with the latest track (nil when Spotify is stopped or not running) and the time
    /// (ms since 1970) the position was read.
    var onUpdate: (@MainActor (Track?, Double) -> Void)?

    private let wake = NSCondition()
    private var pending = false
    private var thread: Thread?

    private static let fullSource = """
    if application "Spotify" is running then
      tell application "Spotify"
        if player state is stopped then return "STOPPED"
        set t to current track
        set d to ASCII character 31
        return (id of t) & d & (name of t) & d & (artist of t) & d & (album of t) & d & (artwork url of t) & d & (duration of t) & d & (player position as text) & d & (player state as text)
      end tell
    end if
    return "NOT_RUNNING"
    """

    private static let lightSource = """
    if application "Spotify" is running then
      tell application "Spotify"
        if player state is stopped then return "STOPPED"
        return (id of current track) & (ASCII character 31) & (player position as text) & (ASCII character 31) & (player state as text)
      end tell
    end if
    return "NOT_RUNNING"
    """

    func start() {
        DistributedNotificationCenter.default().addObserver(
            forName: NSNotification.Name("com.spotify.client.PlaybackStateChanged"), object: nil, queue: nil) { [weak self] _ in
            self?.checkNow()
        }
        let t = Thread { [weak self] in self?.run() }
        t.name = "Spotify monitor"
        t.qualityOfService = .userInitiated
        thread = t
        t.start()
    }

    /// Ask for a check right away (e.g. Spotify just changed state).
    func checkNow() {
        wake.lock()
        pending = true
        wake.signal()
        wake.unlock()
    }

    private func run() {
        // NSAppleScript objects stay on this one thread
        let full = NSAppleScript(source: Self.fullSource)!
        let light = NSAppleScript(source: Self.lightSource)!
        full.compileAndReturnError(nil)
        light.compileAndReturnError(nil)
        var current: Track?

        while true {
            let before = Date().timeIntervalSince1970 * 1000
            var track: Track?
            if let out = execute(light) {
                let p = out.components(separatedBy: "\u{1f}")
                if p.count == 3, let c = current, c.id == p[0] {
                    var t = c
                    t.position = Double(p[1].replacingOccurrences(of: ",", with: ".")) ?? t.position
                    t.isPlaying = p[2] == "playing"
                    track = t
                } else if p.count == 3, let f = execute(full) {
                    track = Self.parseFull(f)  // new track: get title, artist, artwork…
                }
            }
            let after = Date().timeIntervalSince1970 * 1000
            current = track
            let stamp = (before + after) / 2  // the position was read somewhere in the middle of the round-trip
            DispatchQueue.main.async { [weak self] in
                MainActor.assumeIsolated { self?.onUpdate?(track, stamp) }
            }

            // sleep until the next check, or until Spotify tells us something changed
            wake.lock()
            if !pending { wake.wait(until: Date().addingTimeInterval(track == nil ? 2 : 1)) }
            pending = false
            wake.unlock()
        }
    }

    private func execute(_ script: NSAppleScript) -> String? {
        var error: NSDictionary?
        guard let out = script.executeAndReturnError(&error).stringValue, out != "STOPPED", out != "NOT_RUNNING" else { return nil }
        return out
    }

    private static func parseFull(_ out: String) -> Track? {
        let p = out.components(separatedBy: "\u{1f}")
        guard p.count == 8 else { return nil }
        return Track(
            id: p[0], title: p[1], artist: p[2], album: p[3], artworkURL: p[4],
            duration: (Double(p[5]) ?? 0) / 1000,
            position: Double(p[6].replacingOccurrences(of: ",", with: ".")) ?? 0,
            isPlaying: p[7] == "playing"
        )
    }
}
