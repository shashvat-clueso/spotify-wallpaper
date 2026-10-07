import Carbon.HIToolbox
import Foundation

/// System-wide shortcuts through Carbon's RegisterEventHotKey: works from any app and needs no
/// Accessibility permission (unlike an NSEvent global monitor).
@MainActor
final class HotKeys {
    static let shared = HotKeys()
    private var handlers: [UInt32: () -> Void] = [:]
    private var refs: [EventHotKeyRef] = []
    private var nextID: UInt32 = 1
    private var installed = false

    /// ⌃⌥⌘ + key, e.g. `register(kVK_ANSI_L) { … }`.
    func register(_ keyCode: Int, modifiers: Int = controlKey | optionKey | cmdKey, _ handler: @escaping () -> Void) {
        installHandler()
        let id = nextID
        nextID += 1
        var ref: EventHotKeyRef?
        let status = RegisterEventHotKey(UInt32(keyCode), UInt32(modifiers), EventHotKeyID(signature: OSType(0x5357_484B) /* SWHK */, id: id),
                                         GetEventDispatcherTarget(), 0, &ref)
        guard status == noErr, let ref else {
            NSLog("SpotifyWallpaper: couldn't register hotkey \(keyCode): \(status)")
            return
        }
        refs.append(ref)
        handlers[id] = handler
    }

    fileprivate func fire(_ id: UInt32) { handlers[id]?() }

    private func installHandler() {
        guard !installed else { return }
        installed = true
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetEventDispatcherTarget(), { _, event, _ in
            var hk = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                              MemoryLayout<EventHotKeyID>.size, nil, &hk)
            let id = hk.id
            DispatchQueue.main.async { MainActor.assumeIsolated { HotKeys.shared.fire(id) } }
            return noErr
        }, 1, &spec, nil, nil)
    }
}
