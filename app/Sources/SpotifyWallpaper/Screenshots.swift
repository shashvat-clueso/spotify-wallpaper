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
        NSApp.terminate(nil)
    }
}
