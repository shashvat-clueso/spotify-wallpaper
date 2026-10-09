import AppKit
import WebKit

/// Renders a template at one screen's size in an off-screen web view and snapshots it to an image.
@MainActor
final class ScreenRenderer: NSObject, WKNavigationDelegate {
    let size: CGSize
    private let window: NSWindow
    private let webView: WKWebView
    private var loadedURL: URL?
    private var navigation: CheckedContinuation<Void, Never>?
    private var closed = false

    init(size: CGSize, configuration: WKWebViewConfiguration) {
        self.size = size
        webView = WKWebView(frame: CGRect(origin: .zero, size: size), configuration: configuration)
        // Far off-screen but "visible", so WebKit keeps painting it.
        window = NSWindow(contentRect: CGRect(x: -40000, y: -40000, width: size.width, height: size.height),
                          styleMask: .borderless, backing: .buffered, defer: false)
        super.init()
        window.isReleasedWhenClosed = false
        window.ignoresMouseEvents = true
        window.collectionBehavior = [.canJoinAllSpaces, .ignoresCycle, .stationary]
        window.contentView = webView
        webView.navigationDelegate = self
        window.orderBack(nil)
    }

    /// Frees the web view even mid-render: a load waiting in a closed window never finishes on its own, and the
    /// awaiting task would keep this renderer (a screen-sized page) alive for good.
    func close() {
        closed = true
        finishNavigation()
        webView.stopLoading()
        webView.navigationDelegate = nil
        window.contentView = nil
        window.close()
    }

    func render(url: URL, payload: [String: Any]) async -> NSImage? {
        guard !closed else { return nil }
        if loadedURL != url {
            await withCheckedContinuation { c in
                navigation = c
                webView.load(URLRequest(url: url))
                // a load can stall (a suspended or killed web process); give up rather than wait forever
                Task { [weak self] in
                    try? await Task.sleep(for: .seconds(20))
                    self?.finishNavigation()
                }
            }
            guard !closed else { return nil }
            loadedURL = url
        }
        do {
            _ = try await webView.callAsyncJavaScript(
                "await window.__sw.render(JSON.parse(json)); return true;",
                arguments: ["json": jsonString(payload)], in: nil, contentWorld: .page)
        } catch {
            NSLog("SpotifyWallpaper: template error: \(error)")
        }
        let config = WKSnapshotConfiguration()
        config.rect = webView.bounds
        config.afterScreenUpdates = true
        return try? await webView.takeSnapshot(configuration: config)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finishNavigation() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finishNavigation() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finishNavigation()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loadedURL = nil  // the next render loads the page again
        finishNavigation()
    }

    private func finishNavigation() {
        navigation?.resume()
        navigation = nil
    }
}

/// Reloads a web view whose web content process was killed (memory pressure, a crash), which otherwise leaves the
/// window blank for good. Keep a reference to it alongside the web view; `onReload` runs after the reload starts.
@MainActor
final class ReloadOnCrash: NSObject, WKNavigationDelegate {
    var onReload: (() -> Void)?

    init(_ webView: WKWebView) {
        super.init()
        webView.navigationDelegate = self
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        NSLog("SpotifyWallpaper: a web page's process ended; reloading it")
        webView.reload()
        onReload?()
    }
}
