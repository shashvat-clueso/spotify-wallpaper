import WebKit

/// Serves everything the web views load from one origin, sw://app/…
///   /template/<id>/<file>   template files (user folder overrides built-ins)
///   /runtime/<file>         the shared template runtime
///   /ui/<file>              the Customize window
///   /cover/<anything>       the current track's cover art
///   /font/<file>            a font from the system font folders
@MainActor
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    private let paths: Paths
    private let store: TemplateStore
    var cover: () -> Data? = { nil }

    private static let fontDirs = ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts",
                                   NSHomeDirectory() + "/Library/Fonts"]

    init(paths: Paths, store: TemplateStore) {
        self.paths = paths
        self.store = store
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let parts = url.path.split(separator: "/").map { String($0).removingPercentEncoding ?? String($0) }
        var data: Data?
        var mime = Self.mime(url.pathExtension)

        switch parts.first {
        case "template" where parts.count >= 3:
            if let t = store.template(parts[1]) { data = read(t.dir, parts[2...]) }
        case "runtime", "ui":
            data = read(paths.web, parts[...])
        case "cover":
            data = cover() ?? (try? Data(contentsOf: paths.web.appendingPathComponent("ui/sample-cover.jpg")))
            mime = "image/jpeg"
        case "font" where parts.count == 2:
            for dir in Self.fontDirs where data == nil {
                data = read(URL(fileURLWithPath: dir), parts[1...])
            }
        default:
            break
        }

        let status = data == nil ? 404 : 200
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": mime, "Cache-Control": "no-store",
                                                      "Access-Control-Allow-Origin": "*"])!
        task.didReceive(response)
        task.didReceive(data ?? Data())
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    /// Reads base/parts, refusing anything that escapes base.
    private func read(_ base: URL, _ parts: ArraySlice<String>) -> Data? {
        let file = parts.reduce(base) { $0.appendingPathComponent($1) }.standardizedFileURL
        guard file.path.hasPrefix(base.standardizedFileURL.path + "/") else { return nil }
        return try? Data(contentsOf: file)
    }

    private static func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "gif": return "image/gif"
        case "ttf": return "font/ttf"
        case "otf": return "font/otf"
        case "woff2": return "font/woff2"
        case "ttc": return "font/collection"
        default: return "application/octet-stream"
        }
    }
}
