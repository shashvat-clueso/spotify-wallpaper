import Foundation

/// Reads the Spotify desktop app's current track over AppleScript. No login or API key needed.
final class SpotifyMonitor {
    private let script: NSAppleScript

    init() {
        let source = """
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
        script = NSAppleScript(source: source)!
        script.compileAndReturnError(nil)
    }

    func poll() -> Track? {
        var error: NSDictionary?
        guard let out = script.executeAndReturnError(&error).stringValue else { return nil }
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
