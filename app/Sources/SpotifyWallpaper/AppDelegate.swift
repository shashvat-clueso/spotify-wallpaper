import AppKit
import Carbon.HIToolbox
import ServiceManagement

private extension Double {
    func rounded(toPlaces p: Int) -> Double {
        let m = pow(10, Double(p))
        return (self * m).rounded() / m
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let paths = Paths()
    private lazy var store = TemplateStore(paths: paths)
    private lazy var engine = Engine(store: store, paths: paths)
    private var statusItem: NSStatusItem!
    private var settings: SettingsWindowController?
    private var builder: BuilderWindowController?
    private var whatsNew: WhatsNewWindowController?
    private let updater = Updater()
    private lazy var history = HistoryStore(paths: paths)
    private var historyWindow: HistoryWindowController?
    private lazy var shareCard = ShareCard(engine: engine, store: store)
    private let focusMonitor = FocusMonitor()
    private lazy var installer = TemplateInstaller(store: store, paths: paths)
    /// Focus Mode switched on by hand (not remembered across launches).
    private var manualFocus = false
    /// .swtemplate files / install links that arrived before launch finished.
    private var pendingOpen: [URL]? = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let probe = LyricsProbe.request {
            Task { await LyricsProbe.run(probe, paths: paths) }
            return
        }
        if let dir = Screenshots.outputDir {
            Task { await Screenshots.run(to: dir, engine: engine, store: store, paths: paths) }
            return
        }
        installEditMenu()
        handleTermination()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "music.note", accessibilityDescription: "Spotify Wallpaper")
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu

        engine.onStateChange = { [weak self] in self?.settings?.pushState(); self?.builder?.pushState() }
        engine.onClock = { [weak self] clock in self?.settings?.pushClock(clock); self?.builder?.pushClock(clock) }
        engine.onTemplateFilesChanged = { [weak self] in self?.settings?.templateFilesChanged() }
        setUpAppFeatures()
        engine.start()
        updater.start()

        if WhatsNewWindowController.shouldShowAfterUpdate() { openWhatsNew() }
        if !UserDefaults.standard.bool(forKey: "launchedBefore") {
            UserDefaults.standard.set(true, forKey: "launchedBefore")
            openSettings()
        }
        let queued = pendingOpen ?? []
        pendingOpen = nil
        queued.forEach { installer.open($0) }
    }

    // MARK: history, lyric cards, focus, template sharing

    private func setUpAppFeatures() {
        engine.onStillRendered = { [weak self] jpeg, _, track, templateID in
            guard let self, !self.engine.focus else { return }  // no history while lyrics are hidden
            self.history.record(jpeg, track: track, templateID: templateID,
                                colors: self.engine.statePayload(for: nil)["colors"] as? [String: Any] ?? [:])
        }
        history.onChange = { [weak self] in self?.historyWindow?.historyChanged() }
        focusMonitor.onChange = { [weak self] _ in self?.updateFocus() }
        if hideLyricsWhileSharing { focusMonitor.start() }
        installer.onInstalled = { [weak self] id in
            guard let self else { return }
            self.openSettings()
            self.settings?.sendInit(select: id)
        }
        HotKeys.shared.register(kVK_ANSI_L) { [weak self] in self?.shareCard.share() }
        HotKeys.shared.register(kVK_ANSI_F) { [weak self] in self?.toggleFocusMode() }
    }

    /// Double-clicked .swtemplate files and spotify-wallpaper://install?url=… links.
    func application(_ application: NSApplication, open urls: [URL]) {
        if pendingOpen != nil { pendingOpen?.append(contentsOf: urls) } else { urls.forEach { installer.open($0) } }
    }

    private var hideLyricsWhileSharing: Bool {
        get { UserDefaults.standard.object(forKey: "hideLyricsWhileSharing") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "hideLyricsWhileSharing") }
    }

    private func updateFocus() {
        engine.focus = manualFocus || (hideLyricsWhileSharing && focusMonitor.sharing)
    }

    @objc private func toggleFocusMode() {
        manualFocus.toggle()
        updateFocus()
        HUD.show(title: manualFocus ? "Focus Mode on" : "Focus Mode off",
                 detail: manualFocus ? "Lyrics are hidden until you turn it off (⌃⌥⌘F)." : nil)
    }

    @objc private func toggleHideWhileSharing() {
        hideLyricsWhileSharing.toggle()
        if hideLyricsWhileSharing { focusMonitor.start() } else { focusMonitor.stop() }
        updateFocus()
    }

    @objc private func requestScreenRecording() {
        if !CGRequestScreenCaptureAccess() {
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
        }
    }

    @objc private func shareLyricCard() { shareCard.share() }

    @objc private func pickShareFormat(_ sender: NSMenuItem) {
        if let raw = sender.representedObject as? String, let f = ShareCard.Format(rawValue: raw) { shareCard.format = f }
    }

    @objc private func openHistory() {
        if historyWindow == nil { historyWindow = HistoryWindowController(engine: engine, history: history, store: store) }
        historyWindow?.show()
    }

    @objc private func toggleHistory() { history.enabled.toggle() }

    @objc private func clearHistory() {
        history.load()
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Clear your wallpaper history?"
        alert.informativeText = "This deletes all \(history.entries.count) saved wallpapers from the History Wall. It can't be undone."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Clear History")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        if alert.runModal() == .alertFirstButtonReturn { history.clear() }
    }

    private func appFeatureItems(_ menu: NSMenu) {
        let ctrlOptCmd: NSEvent.ModifierFlags = [.control, .option, .command]
        let share = add(menu, "Share Lyric Card", #selector(shareLyricCard), "l")
        share.keyEquivalentModifierMask = ctrlOptCmd
        share.isEnabled = engine.track != nil
        let format = NSMenuItem(title: "Lyric Card Size", action: nil, keyEquivalent: "")
        let formats = NSMenu()
        for f in ShareCard.Format.allCases {
            let item = NSMenuItem(title: f.title, action: #selector(pickShareFormat(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = f.rawValue
            item.state = shareCard.format == f ? .on : .off
            formats.addItem(item)
        }
        format.submenu = formats
        menu.addItem(format)
        menu.addItem(.separator())

        let focus = add(menu, "Focus Mode", #selector(toggleFocusMode), "f")
        focus.keyEquivalentModifierMask = ctrlOptCmd
        focus.state = manualFocus ? .on : .off
        add(menu, "Hide Lyrics While Screen Sharing", #selector(toggleHideWhileSharing), "").state = hideLyricsWhileSharing ? .on : .off
        if hideLyricsWhileSharing && focusMonitor.sharing {
            let note = NSMenuItem(title: "Screen sharing detected (\(focusMonitor.reason)): lyrics hidden", action: nil, keyEquivalent: "")
            note.isEnabled = false
            menu.addItem(note)
        } else if hideLyricsWhileSharing && !FocusMonitor.canReadTitles {
            add(menu, "Detect Sharing in Browsers Too…", #selector(requestScreenRecording), "").toolTip =
                "Window titles (like Chrome's \"is sharing your screen\" bar) need Screen Recording permission. Without it, only Zoom, Teams and Screen Sharing are noticed."
        }
        menu.addItem(.separator())
    }

    func applicationWillTerminate(_ notification: Notification) {
        if Screenshots.outputDir == nil { engine.shutdown() }
    }

    /// `kill`/`pkill` skip applicationWillTerminate; route them through a normal quit so the wallpaper is restored.
    private var signalSources: [DispatchSourceSignal] = []
    private func handleTermination() {
        for sig in [SIGTERM, SIGINT, SIGHUP] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { NSApp.terminate(nil) }
            source.resume()
            signalSources.append(source)
        }
    }

    // Re-opening the app from Finder/Spotlight while it's running opens the Customize window.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openSettings()
        return false
    }

    // MARK: menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let playing = NSMenuItem(title: engine.nowPlayingText, action: nil, keyEquivalent: "")
        playing.isEnabled = false
        menu.addItem(playing)
        menu.addItem(.separator())

        let templates = NSMenuItem(title: "Template", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for t in store.templates {
            let item = NSMenuItem(title: t.name, action: #selector(pickTemplate(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = t.id
            item.state = t.id == store.activeID ? .on : .off
            sub.addItem(item)
        }
        templates.submenu = sub
        menu.addItem(templates)
        add(menu, "Customize…", #selector(openSettings), ",")
        add(menu, "Template Builder…", #selector(newBuilderTemplate), "")
        add(menu, "History Wall…", #selector(openHistory), "")
        menu.addItem(lyricsMenu())

        let rate = NSMenuItem(title: "Refresh Rate", action: nil, keyEquivalent: "")
        let rates = NSMenu()
        for fps in Engine.refreshRates {
            let item = NSMenuItem(title: fps == 0 ? "Display Maximum" : "\(fps) fps", action: #selector(pickRefreshRate(_:)), keyEquivalent: "")
            item.target = self
            item.tag = fps
            item.state = engine.refreshRate == fps ? .on : .off
            rates.addItem(item)
        }
        rates.addItem(.separator())
        let note = NSMenuItem(title: "Lower rates save battery. Lyric timing stays exact.", action: nil, keyEquivalent: "")
        note.isEnabled = false
        rates.addItem(note)
        rate.submenu = rates
        menu.addItem(rate)
        add(menu, engine.paused ? "Resume Wallpaper" : "Pause Wallpaper", #selector(togglePause), "")
        menu.addItem(.separator())
        appFeatureItems(menu)
        add(menu, "Keep a History of Wallpapers", #selector(toggleHistory), "").state = history.enabled ? .on : .off
        add(menu, "Clear History…", #selector(clearHistory), "")
        menu.addItem(.separator())
        add(menu, "Open Templates Folder", #selector(openTemplatesFolder), "")
        menu.addItem(.separator())
        let version = NSMenuItem(title: updater.status ?? "Spotify Wallpaper \(updater.currentVersion)", action: nil, keyEquivalent: "")
        version.isEnabled = false
        menu.addItem(version)
        add(menu, "What's New…", #selector(openWhatsNew), "")
        add(menu, "Check for Updates…", #selector(checkForUpdates), "")
        add(menu, "Automatically Install Updates", #selector(toggleAutoUpdate), "").state = updater.automatic ? .on : .off
        add(menu, "Launch at Login", #selector(toggleLaunchAtLogin), "").state =
            SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(.separator())
        add(menu, "Quit Spotify Wallpaper", #selector(quit), "q")
    }

    @discardableResult
    private func add(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        menu.addItem(item)
        return item
    }

    @objc private func pickTemplate(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        store.activeID = id
        engine.invalidate()
        settings?.sendInit()
    }

    @objc private func openWhatsNew() {
        if whatsNew == nil { whatsNew = WhatsNewWindowController(engine: engine) }
        whatsNew?.show()
    }

    @objc private func checkForUpdates() { Task { await updater.check(userInitiated: true) } }

    @objc private func toggleAutoUpdate() {
        updater.automatic.toggle()
        if updater.automatic { Task { await updater.check(userInitiated: false) } }
    }

    @objc private func pickRefreshRate(_ sender: NSMenuItem) { engine.refreshRate = sender.tag }

    private func lyricsMenu() -> NSMenuItem {
        let item = NSMenuItem(title: "Lyrics", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        let sources = engine.lyricsSources
        let info = NSMenuItem(title: engine.track == nil ? "Nothing playing"
                                : engine.lyricsSourceText.isEmpty ? "No lyrics found" : "From \(engine.lyricsSourceText)",
                              action: nil, keyEquivalent: "")
        info.isEnabled = false
        sub.addItem(info)
        sub.addItem(.separator())

        let synced = sources.filter(\.synced).count
        var choices = [("Combined", synced > 1 ? "Combined timing (\(synced) sources)" : "Best available")]
        choices += sources.map { ($0.name, $0.synced ? $0.name : "\($0.name) (unsynced)") }
        for (value, title) in choices {
            let c = NSMenuItem(title: title, action: #selector(pickLyricsSource(_:)), keyEquivalent: "")
            c.target = self
            c.representedObject = value
            c.state = engine.lyricsChoice == value ? .on : .off
            c.isEnabled = !sources.isEmpty
            sub.addItem(c)
        }
        sub.addItem(.separator())

        let offset = engine.lyricsOffset
        for (title, delta) in [("Show Lines Earlier (−0.25 s)", -0.25), ("Show Lines Later (+0.25 s)", 0.25)] {
            let n = NSMenuItem(title: title, action: #selector(nudgeLyrics(_:)), keyEquivalent: "")
            n.target = self
            n.representedObject = delta
            n.isEnabled = !sources.isEmpty
            sub.addItem(n)
        }
        let reset = NSMenuItem(title: offset == 0 ? "Timing: as published" : String(format: "Reset Timing (now %+.2f s)", offset),
                               action: offset == 0 ? nil : #selector(resetLyricsTiming), keyEquivalent: "")
        reset.target = self
        reset.isEnabled = offset != 0
        sub.addItem(reset)
        sub.addItem(.separator())
        let refetch = NSMenuItem(title: "Search Again", action: #selector(refetchLyrics), keyEquivalent: "")
        refetch.target = self
        refetch.isEnabled = engine.track != nil
        sub.addItem(refetch)

        item.submenu = sub
        return item
    }

    @objc private func pickLyricsSource(_ sender: NSMenuItem) {
        if let v = sender.representedObject as? String { engine.lyricsChoice = v }
    }

    @objc private func nudgeLyrics(_ sender: NSMenuItem) {
        if let d = sender.representedObject as? Double { engine.lyricsOffset = (engine.lyricsOffset + d).rounded(toPlaces: 2) }
    }

    @objc private func resetLyricsTiming() { engine.lyricsOffset = 0 }

    @objc private func refetchLyrics() { engine.refetchLyrics() }

    @objc private func openSettings() {
        if settings == nil {
            settings = SettingsWindowController(engine: engine, store: store, paths: paths)
            settings?.onOpenBuilder = { [weak self] id in self?.openBuilder(id) }
            settings?.installer = installer
        }
        settings?.show()
    }

    @objc private func newBuilderTemplate() { openBuilder(nil) }

    /// Opens the Template Builder on a Builder template, or on a new design when `id` is nil.
    func openBuilder(_ id: String?) {
        if let b = builder, b.window?.isVisible == true, b.templateID == id, id != nil {
            b.show()
            return
        }
        builder?.close()
        builder = BuilderWindowController(engine: engine, store: store, templateID: id)
        builder?.onSaved = { [weak self] in self?.settings?.sendInit() }
        builder?.show()
    }

    @objc private func togglePause() { engine.paused.toggle() }

    @objc private func openTemplatesFolder() { NSWorkspace.shared.open(paths.userTemplates) }

    @objc private func toggleLaunchAtLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = "Couldn't change Launch at Login"
            alert.informativeText = "\(error.localizedDescription)\n\nMove the app to /Applications and try again."
            alert.runModal()
        }
    }

    @objc private func quit() { NSApp.terminate(nil) }

    /// Menu-bar apps have no main menu, which breaks ⌘C/⌘V/⌘A in text fields. Give them one.
    private func installEditMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        appMenu.addItem(withTitle: "Quit Spotify Wallpaper", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)
        NSApp.mainMenu = main
    }
}
