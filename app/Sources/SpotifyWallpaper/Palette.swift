import AppKit

struct RGB {
    var r: Double, g: Double, b: Double  // 0...255

    var hex: String {
        String(format: "#%02X%02X%02X", Int(r.rounded()), Int(g.rounded()), Int(b.rounded()))
    }
    var luminance: Double { (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 }
    /// Saturation-weighted brightness, so gradients built from these aren't muddy.
    var vividness: Double {
        let mx = max(r, g, b), mn = min(r, g, b)
        return (mx - mn) * 0.7 + mx * 0.3
    }
    func distance(_ o: RGB) -> Double { abs(r - o.r) + abs(g - o.g) + abs(b - o.b) }

    var hsl: (h: Double, s: Double, l: Double) {
        let rr = r / 255, gg = g / 255, bb = b / 255
        let mx = max(rr, gg, bb), mn = min(rr, gg, bb), l = (mx + mn) / 2
        guard mx != mn else { return (0, 0, l) }
        let d = mx - mn
        let s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
        var h: Double
        switch mx {
        case rr: h = (gg - bb) / d + (gg < bb ? 6 : 0)
        case gg: h = (bb - rr) / d + 2
        default: h = (rr - gg) / d + 4
        }
        h /= 6
        return (h, s, l)
    }

    init(r: Double, g: Double, b: Double) { self.r = r; self.g = g; self.b = b }

    init(h: Double, s: Double, l: Double) {
        func hue(_ p: Double, _ q: Double, _ t0: Double) -> Double {
            var t = t0
            if t < 0 { t += 1 }
            if t > 1 { t -= 1 }
            if t < 1 / 6 { return p + (q - p) * 6 * t }
            if t < 1 / 2 { return q }
            if t < 2 / 3 { return p + (q - p) * (2 / 3 - t) * 6 }
            return p
        }
        if s == 0 { self.init(r: l * 255, g: l * 255, b: l * 255); return }
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
        self.init(r: hue(p, q, h + 1 / 3) * 255, g: hue(p, q, h) * 255, b: hue(p, q, h - 1 / 3) * 255)
    }

    func with(s: Double? = nil, l: Double? = nil) -> RGB {
        let c = hsl
        return RGB(h: c.h, s: min(1, max(0, s ?? c.s)), l: min(1, max(0, l ?? c.l)))
    }
}

enum Palette {
    /// Colors pulled from the cover art, plus named roles templates can use (`auto:vibrant` etc).
    static func extract(from data: Data?) -> [String: Any] {
        var colors = data.flatMap(pixels).map(cluster) ?? []
        if colors.isEmpty { colors = [RGB(r: 40, g: 40, b: 44)] }
        while colors.count < 6 { colors.append(colors[colors.count - 1]) }

        let dominant = colors[0]
        let vibrant = colors.max { $0.vividness < $1.vividness }!
        let v = vibrant.hsl
        let paperBase = RGB(r: 232, g: 228, b: 219)
        let paper = RGB(r: paperBase.r * 0.95 + dominant.r * 0.05,
                        g: paperBase.g * 0.95 + dominant.g * 0.05,
                        b: paperBase.b * 0.95 + dominant.b * 0.05)
        return [
            "palette": colors.prefix(6).map(\.hex),
            "dominant": dominant.hex,
            "vibrant": vibrant.hex,
            "card": vibrant.with(s: max(v.s, 0.35), l: min(max(v.l, 0.30), 0.42)).hex,
            "deep": vibrant.with(s: v.s * 1.1, l: min(v.l, 0.32)).hex,
            "dark": vibrant.with(s: min(v.s, 0.5), l: 0.12).hex,
            "light": vibrant.with(s: min(v.s, 0.4), l: 0.92).hex,
            "muted": vibrant.with(s: min(v.s, 0.25), l: 0.45).hex,
            "paper": paper.hex,
            "onDominant": dominant.luminance > 0.55 ? "#111111" : "#FFFFFF",
        ]
    }

    private static func pixels(_ data: Data) -> [RGB]? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
        let n = 48
        var buf = [UInt8](repeating: 0, count: n * n * 4)
        let ok: Bool = buf.withUnsafeMutableBytes { raw in
            guard let ctx = CGContext(data: raw.baseAddress, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4,
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(img, in: CGRect(x: 0, y: 0, width: n, height: n))
            return true
        }
        guard ok else { return nil }
        return stride(from: 0, to: buf.count, by: 4).map { RGB(r: Double(buf[$0]), g: Double(buf[$0 + 1]), b: Double(buf[$0 + 2])) }
    }

    /// k-means, most common cluster first, skipping near-duplicates.
    private static func cluster(_ px: [RGB]) -> [RGB] {
        let k = 10
        var centers = (0..<k).map { px[($0 * px.count) / k + px.count / (2 * k)] }
        var counts = [Int](repeating: 0, count: k)
        for _ in 0..<12 {
            var sums = [(Double, Double, Double)](repeating: (0, 0, 0), count: k)
            counts = [Int](repeating: 0, count: k)
            for p in px {
                var best = 0, bestD = Double.infinity
                for (j, c) in centers.enumerated() {
                    let d = (p.r - c.r) * (p.r - c.r) + (p.g - c.g) * (p.g - c.g) + (p.b - c.b) * (p.b - c.b)
                    if d < bestD { bestD = d; best = j }
                }
                sums[best].0 += p.r; sums[best].1 += p.g; sums[best].2 += p.b
                counts[best] += 1
            }
            for j in 0..<k where counts[j] > 0 {
                let n = Double(counts[j])
                centers[j] = RGB(r: sums[j].0 / n, g: sums[j].1 / n, b: sums[j].2 / n)
            }
        }
        var out: [RGB] = []
        for j in (0..<k).sorted(by: { counts[$0] > counts[$1] }) where counts[j] > 0 {
            if out.allSatisfy({ $0.distance(centers[j]) > 60 }) { out.append(centers[j]) }
        }
        return out
    }
}
