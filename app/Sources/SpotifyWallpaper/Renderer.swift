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

    func close() { window.close() }

    func render(url: URL, payload: [String: Any]) async -> NSImage? {
        if loadedURL != url {
            await withCheckedContinuation { c in
                navigation = c
                webView.load(URLRequest(url: url))
            }
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

    private func finishNavigation() {
        navigation?.resume()
        navigation = nil
    }
}
