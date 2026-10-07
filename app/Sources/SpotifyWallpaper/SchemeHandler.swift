import CoreImage
import WebKit

/// Serves everything the web views load from one origin, sw://app/…
///   /template/<id>/<file>   template files (user folder overrides built-ins)
///   /runtime/<file>         the shared template runtime
///   /ui/<file>              the Customize window
///   /cover/<anything>       the current track's cover art
///   /coverblur/<px>/<sat>/…  the cover blurred (and saturated) once, so templates never blur it live
///   /font/<file>            a font from the system font folders
///   /history/<YYYY-MM>/<file>.jpg  a saved wallpaper from the listening history (nothing else in that folder)
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
        case "coverblur" where parts.count >= 3:
            let source = cover() ?? (try? Data(contentsOf: paths.web.appendingPathComponent("ui/sample-cover.jpg")))
            if let source { data = blurredCover(source, radius: Double(parts[1]) ?? 80, saturation: Double(parts[2]) ?? 1) }
            mime = "image/jpeg"
        case "history" where parts.count == 3 && url.pathExtension.lowercased() == "jpg":
            data = read(HistoryStore.directory(paths), parts[1...])
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

    private var blurCache: [String: Data] = [:]
    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])

    /// The cover blurred like CSS `blur(<radius>px)` on a ~1900px-wide background, computed at low resolution
    /// (the result is soft anyway) and cached per song and settings.
    private func blurredCover(_ data: Data, radius: Double, saturation: Double) -> Data? {
        let key = "\(data.count)-\(data.prefix(64).hashValue)-\(radius)-\(saturation)"
        if let hit = blurCache[key] { return hit }
        guard let image = CIImage(data: data), image.extent.width > 0 else { return nil }
        let width: CGFloat = 480
        let scale = width / image.extent.width
        var out = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let extent = out.extent
        let sigma = radius * Double(width) / 1900
        if sigma > 0.3 { out = out.clampedToExtent().applyingGaussianBlur(sigma: sigma).cropped(to: extent) }
        if saturation != 1 { out = out.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: saturation]) }
        guard let jpeg = ciContext.jpegRepresentation(of: out, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                                                      options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.9])
        else { return nil }
        if blurCache.count > 24 { blurCache.removeAll() }
        blurCache[key] = jpeg
        return jpeg
    }

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
