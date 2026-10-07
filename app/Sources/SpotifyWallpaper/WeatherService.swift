import CoreLocation
import Foundation

/// Current weather where the Mac is, from Open-Meteo (keyless). The location is looked up at most every 3 hours
/// (one-shot CoreLocation fix), the weather every 20 minutes. Nothing is requested while "Use Weather" is off.
@MainActor
final class WeatherService: NSObject, CLLocationManagerDelegate {
    struct Weather: Equatable {
        var condition: String  // clear | clouds | fog | rain | snow | storm
        var temperature: Double  // °C
        var isDay: Bool
        var sunrise: Double?  // ms since 1970
        var sunset: Double?

        /// What templates show; a change here is worth redrawing for.
        var key: String { "\(condition)|\(isDay)|\(Int(temperature.rounded()))" }

        var json: [String: Any] {
            var d: [String: Any] = ["condition": condition, "temperature": temperature, "isDay": isDay]
            if let sunrise { d["sunrise"] = sunrise }
            if let sunset { d["sunset"] = sunset }
            return d
        }
    }

    /// Called when the weather changed in a way templates would show.
    var onChange: (() -> Void)?

    var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "useWeather") as? Bool ?? true }
        set {
            UserDefaults.standard.set(newValue, forKey: "useWeather")
            if newValue { refresh() } else if fetched != nil { fetched = nil; lastKey = ""; onChange?() }
        }
    }

    /// The latest weather, with day/night following today's sunrise and sunset between fetches.
    var current: Weather? {
        guard enabled, var w = fetched else { return nil }
        if let rise = w.sunrise, let set = w.sunset {
            let now = Date().timeIntervalSince1970 * 1000
            w.isDay = now >= rise && now < set
        }
        return w
    }

    private let manager = CLLocationManager()
    private var location: CLLocation?
    private var locatedAt: Date?
    private var locating = false
    private var fetched: Weather?
    private var fetchedAt: Date?
    private var fetching = false
    private var lastKey = ""
    private var timer: Timer?

    func start() {
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        refresh()
    }

    /// Cheap; runs every minute and only does work when something is due.
    func refresh() {
        guard enabled else { return }
        if location == nil || locatedAt.map({ Date().timeIntervalSince($0) > 3 * 3600 }) ?? true { locate() }
        if let location, !fetching, fetchedAt.map({ Date().timeIntervalSince($0) > 20 * 60 }) ?? true {
            fetching = true
            Task {
                let w = await Self.fetch(location.coordinate)
                fetching = false
                guard let w else { return }  // offline: try again next minute
                fetched = w
                fetchedAt = Date()
                announce()
            }
        }
        announce()  // day/night may have flipped at sunrise/sunset
    }

    private func announce() {
        let key = current?.key ?? ""
        if key != lastKey { lastKey = key; onChange?() }
    }

    // MARK: location

    private func locate() {
        guard !locating else { return }
        switch manager.authorizationStatus {
        case .notDetermined:
            // macOS has no separate "when in use"; this asks once and grants .authorizedAlways
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            locating = true
            manager.requestLocation()
        default: break  // denied or restricted: no weather
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in self.refresh() }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        Task { @MainActor in
            self.locating = false
            let moved = self.location.map { $0.distance(from: last) > 5000 } ?? true
            self.location = last
            self.locatedAt = Date()
            if moved { self.fetchedAt = nil }  // somewhere else: fetch its weather now
            self.refresh()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.locating = false
            self.locatedAt = Date().addingTimeInterval(-3 * 3600 + 600)  // retry in 10 minutes, not every minute
        }
    }

    // MARK: Open-Meteo

    nonisolated static func fetch(_ c: CLLocationCoordinate2D) async -> Weather? {
        var url = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        url.queryItems = [.init(name: "latitude", value: String(format: "%.3f", c.latitude)),
                          .init(name: "longitude", value: String(format: "%.3f", c.longitude)),
                          .init(name: "current", value: "temperature_2m,weather_code,is_day"),
                          .init(name: "daily", value: "sunrise,sunset"),
                          .init(name: "timezone", value: "auto"), .init(name: "forecast_days", value: "1")]
        guard let (data, response) = try? await URLSession.shared.data(for: URLRequest(url: url.url!, timeoutInterval: 10)),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return parse(data)
    }

    nonisolated static func parse(_ data: Data) -> Weather? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cur = json["current"] as? [String: Any],
              let temp = (cur["temperature_2m"] as? NSNumber)?.doubleValue,
              let code = (cur["weather_code"] as? NSNumber)?.intValue else { return nil }
        let offset = (json["utc_offset_seconds"] as? NSNumber)?.doubleValue ?? 0
        let daily = json["daily"] as? [String: Any]
        func ms(_ key: String) -> Double? {
            (daily?[key] as? [Any])?.first.flatMap { $0 as? String }.flatMap { localTime($0, utcOffset: offset) }
        }
        return Weather(condition: condition(code), temperature: temp, isDay: (cur["is_day"] as? NSNumber)?.intValue != 0,
                       sunrise: ms("sunrise"), sunset: ms("sunset"))
    }

    /// WMO weather interpretation codes.
    nonisolated static func condition(_ code: Int) -> String {
        switch code {
        case 0...1: return "clear"
        case 2...3: return "clouds"
        case 45, 48: return "fog"
        case 51...67, 80...82: return "rain"
        case 71...77, 85...86: return "snow"
        case 95...99: return "storm"
        default: return "clouds"
        }
    }

    /// "2026-10-07T06:09" in the location's time (timezone=auto) → ms since 1970.
    nonisolated static func localTime(_ s: String, utcOffset: Double) -> Double? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = s.count > 16 ? "yyyy-MM-dd'T'HH:mm:ss" : "yyyy-MM-dd'T'HH:mm"
        guard let d = f.date(from: s) else { return nil }
        return (d.timeIntervalSince1970 - utcOffset) * 1000
    }
}
