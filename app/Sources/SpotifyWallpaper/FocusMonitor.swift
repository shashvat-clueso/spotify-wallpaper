import AppKit
import CoreGraphics

/// Guesses whether the screen is being shared, from the on-screen window list every 2 s.
///
/// Sharing apps show a toolbar or banner while a share is live ("zoom share toolbar", Chrome's
/// "meet.google.com is sharing your screen." bar, Teams' sharing control bar, …). Those window *titles*
/// are only visible to apps with Screen Recording permission on macOS 14+; without it every other app's
/// window name is empty, and only the owner-based rules below can fire (Zoom/Teams floating toolbars,
/// macOS Screen Sharing). Browser-based sharing (Meet, Teams/Slack web) can't be seen without the permission.
@MainActor
final class FocusMonitor {
    struct Window {
        var owner: String
        var name: String
        var layer: Int
        var width: Double
        var height: Double
    }

    private(set) var sharing = false
    private(set) var reason = ""
    var onChange: ((Bool) -> Void)?
    private var timer: Timer?

    var running: Bool { timer != nil }

    func start() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
        poll()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        update(nil)
    }

    /// Whether window titles are readable (Screen Recording permission). Doesn't prompt.
    static var canReadTitles: Bool { CGPreflightScreenCaptureAccess() }

    private func poll() {
        let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        let ownPID = ProcessInfo.processInfo.processIdentifier
        let windows = raw.compactMap { w -> Window? in
            if (w[kCGWindowOwnerPID as String] as? Int32) == ownPID { return nil }
            let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
            return Window(owner: w[kCGWindowOwnerName as String] as? String ?? "", name: w[kCGWindowName as String] as? String ?? "",
                          layer: w[kCGWindowLayer as String] as? Int ?? 0,
                          width: (b["Width"] as? NSNumber)?.doubleValue ?? 0, height: (b["Height"] as? NSNumber)?.doubleValue ?? 0)
        }
        update(Self.match(windows))
    }

    private func update(_ hit: String?) {
        let now = hit != nil
        reason = hit ?? ""
        guard now != sharing else { return }
        sharing = now
        onChange?(now)
    }

    // MARK: rules (pure, so they can be tested on sample window lists)

    /// Phrases a sharing banner/toolbar title contains, whatever app shows it (browsers, Meet, Teams web, …).
    private nonisolated static let bannerPhrases = ["is sharing your screen", "is sharing a window", "is sharing your entire screen",
                                        "is sharing this tab", "is sharing a tab", "you are screen sharing", "you're sharing your screen",
                                        "you are sharing your screen", "stop sharing"]

    /// The reason sharing was detected (for the menu), or nil.
    nonisolated static func match(_ windows: [Window]) -> String? {
        for w in windows {
            let owner = w.owner.lowercased(), name = w.name.lowercased()
            if !name.isEmpty, bannerPhrases.contains(where: name.contains) { return "\(w.owner): “\(w.name)”" }
            switch true {
            case owner == "zoom.us" || owner.hasPrefix("zoom"):
                if name.contains("share") || name.contains("sharing") { return "Zoom" }
                // no titles: Zoom's share toolbar is a wide, short window floating above everything
                if name.isEmpty, w.layer >= 3, w.width >= 300, w.height > 0, w.height <= 90 { return "Zoom" }
            case owner.contains("teams"):
                if name.contains("sharing") || name.contains("presenting") || name.contains("control bar") { return "Microsoft Teams" }
                if name.isEmpty, w.layer >= 3, w.width >= 300, w.height > 0, w.height <= 90 { return "Microsoft Teams" }
            case owner == "slack":
                if name.contains("screen shar") || name.contains("is sharing") { return "Slack" }
            case owner.hasPrefix("discord"):
                if name.contains("screen share") || name.contains("screenshare") || name.contains("go live") { return "Discord" }
            case owner == "facetime":
                if name.contains("shar") { return "FaceTime" }
            case owner.contains("webex"):
                if name.contains("shar") { return "Webex" }
            case owner == "screen sharing" || owner == "screensharingd" || owner == "ssmenuagent":
                // the macOS Screen Sharing app, or the menu-bar agent shown while someone views this Mac
                return "Screen Sharing"
            default:
                break
            }
        }
        return nil
    }
}
