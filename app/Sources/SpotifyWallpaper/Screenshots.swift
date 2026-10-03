import AppKit

/// Developer tool: `SpotifyWallpaper --screenshots <dir>` renders every template, plus the Customize window,
/// with the bundled sample song and quits. Used for the README.
@MainActor
enum Screenshots {
    static var outputDir: URL? {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--screenshots"), i + 1 < args.count else { return nil }
        return URL(fileURLWithPath: args[i + 1])
    }

    static func run(to dir: URL, engine: Engine, store: TemplateStore, paths: Paths) async {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let size = CGSize(width: 1512, height: 982)
        let renderer = ScreenRenderer(size: size, configuration: engine.makeWebConfiguration())
        for template in store.templates where template.builtin {
            var payload = engine.statePayload(for: nil)
            payload["screen"] = ["width": size.width, "height": size.height, "scale": 2]
            payload["params"] = store.defaultValues(template.id)
            if let image = await renderer.render(url: template.url, payload: payload), let jpeg = jpegData(image, quality: 0.86) {
                try? jpeg.write(to: dir.appendingPathComponent("template-\(template.id).jpg"))
            }
        }
        renderer.close()

        let settings = SettingsWindowController(engine: engine, store: store, paths: paths)
        settings.show()
        try? await Task.sleep(for: .seconds(4))
        if let image = await settings.snapshot(), let jpeg = jpegData(image, quality: 0.86) {
            try? jpeg.write(to: dir.appendingPathComponent("customize.jpg"))
        }
        settings.close()

        // Template Builder: the editor with a starter open, and every starter rendered as a real template
        let builder = BuilderWindowController(engine: engine, store: store, templateID: nil)
        builder.show()
        try? await Task.sleep(for: .seconds(3))
        _ = await builder.evaluate("document.querySelectorAll('.starter')[1].click(); select(B.design.layers[4].id); true")
        try? await Task.sleep(for: .seconds(3))
        if let image = await builder.snapshot(), let jpeg = jpegData(image, quality: 0.86) {
            try? jpeg.write(to: dir.appendingPathComponent("builder.jpg"))
        }
        // Follow time: the analog clock starter with its seconds hand selected
        _ = await builder.evaluate("B.design = clone(STARTERS.find(s => s.name === 'Analog Clock').design); renderAll(); select('sec'); document.getElementById('inspector').scrollTop = 99999; true")
        try? await Task.sleep(for: .seconds(2))
        if let image = await builder.snapshot(), let jpeg = jpegData(image, quality: 0.86) {
            try? jpeg.write(to: dir.appendingPathComponent("builder-follow.jpg"))
        }
        // Edit Code: the canvas turns the open design into a standalone HTML template
        let exported = await builder.evaluate("""
            new Promise(r => { addEventListener('message', e => { if (e.data && e.data.type === 'sw:exported') r(e.data.html); });
              canvas.contentWindow.postMessage({ type: 'sw:export', design: B.design }, '*'); })
            """)
        if let html = exported as? String { try? html.write(to: dir.appendingPathComponent("export-test.html"), atomically: true, encoding: .utf8) }
        let starters = (await builder.evaluate("JSON.stringify(STARTERS.map(s => s.design))") as? String)
            .flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [Any] ?? []
        builder.close()
        let stillRenderer = ScreenRenderer(size: size, configuration: engine.makeWebConfiguration())
        for (i, design) in starters.enumerated() {
            guard let id = store.saveDesign(id: nil, name: "zz builder screenshot \(i)", design: design),
                  let template = store.template(id) else { continue }
            var payload = engine.statePayload(for: nil)
            payload["screen"] = ["width": size.width, "height": size.height, "scale": 2]
            payload["params"] = [String: Any]()
            if let image = await stillRenderer.render(url: template.url, payload: payload), let jpeg = jpegData(image, quality: 0.86) {
                try? jpeg.write(to: dir.appendingPathComponent("builder-starter-\(i).jpg"))
            }
            try? FileManager.default.removeItem(at: template.dir)
        }
        store.reload()
        NSApp.terminate(nil)
    }
}

/// Developer tool: `SpotifyWallpaper --lyrics "<title>" "<artist>" "<album>" <seconds>` prints what each lyrics
/// source found and the combined timing, then quits.
@MainActor
enum LyricsProbe {
    static var request: Track? {
        let a = CommandLine.arguments
        guard let i = a.firstIndex(of: "--lyrics"), i + 4 < a.count, let d = Double(a[i + 4]) else { return nil }
        return Track(id: "probe:" + a[i + 1] + a[i + 2], title: a[i + 1], artist: a[i + 2], album: a[i + 3], artworkURL: "",
                     duration: d, position: 0, isPlaying: false)
    }

    static func run(_ track: Track, paths: Paths) async {
        let found = await LyricsService(paths: paths).candidates(for: track, refresh: true)
        for c in found {
            let sample = c.lines.prefix(3).map { String(format: "%.2f %@", $0.t, $0.text) }.joined(separator: " | ")
            print("\(c.source) \(c.synced ? "synced" : "plain") \(c.lines.count) lines: \(sample)")
        }
        for name in LyricsService.sources where !found.contains(where: { $0.source == name }) { print("\(name): nothing") }
        let (lyrics, used) = LyricsService.resolve(found, choice: "Combined", duration: track.duration)
        print("COMBINED from [\(used)] \(lyrics.lines.count) lines")
        for l in lyrics.lines.prefix(6) { print(String(format: "  %6.2f  %@", l.t, l.text)) }
        exit(0)
    }
}
