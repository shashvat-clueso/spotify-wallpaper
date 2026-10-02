import AppKit
import WebKit

/// A live, animated copy of the template on one screen, drawn just above the real wallpaper and below the
/// desktop icons, on every Space. The real wallpaper underneath holds a still of the same song.
@MainActor
final class DesktopLayer: NSObject, WKNavigationDelegate {
    let frame: CGRect
    private let window: NSWindow
    private let webView: WKWebView
    private var url: URL?
    private var loaded = false
    private var full: String?
    private var clock: String?
    private var visible = false

    init(screen: NSScreen, configuration: WKWebViewConfiguration) {
        frame = screen.frame
        webView = WKWebView(frame: CGRect(origin: .zero, size: frame.size), configuration: configuration)
        window = NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
        super.init()
        window.setFrame(frame, display: false)
        // The wallpaper sits one level below desktopWindow and Finder's icons at desktopIconWindow.
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.ignoresMouseEvents = true
        window.isReleasedWhenClosed = false
        window.hasShadow = false
        window.backgroundColor = .black
        window.alphaValue = 0
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        window.contentView = webView
    }

    func load(_ newURL: URL) {
        guard newURL != url else { return }
        url = newURL
        loaded = false
        webView.load(URLRequest(url: newURL))
    }

    /// Everything the template needs; sent when the track, template or settings change.
    func sendState(_ json: String) {
        full = json
        if loaded { webView.evaluateJavaScript("window.__sw && __sw.live(\(json))") }
    }

    /// Just the playback position, sent on every Spotify check to keep the template's clock in sync.
    func sendClock(_ json: String) {
        clock = json
        if loaded { webView.evaluateJavaScript("window.__sw && __sw.clock(\(json))") }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        if let full { webView.evaluateJavaScript("window.__sw && __sw.live(\(full))") }
        if let clock { webView.evaluateJavaScript("window.__sw && __sw.clock(\(clock))") }
    }

    func show() {
        guard !visible, loaded, full != nil else { return }
        visible = true
        window.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.6
            window.animator().alphaValue = 1
        }
    }

    func hide() {
        guard visible else { return }
        visible = false
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.6
            window.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated {
                if self?.visible == false { self?.window.orderOut(nil) }
            }
        })
    }

    func close() { window.close() }
}
