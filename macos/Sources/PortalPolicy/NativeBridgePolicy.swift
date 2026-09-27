import Foundation

// Pure, Foundation-only policy for the three native additions (E12): the
// Cloudflare Access login origin, the one-way notification bridge, and the
// Mac node LaunchAgent control. Kept here so XCTest covers it without WebKit.

public extension PortalConfiguration {
    /// Cloudflare Access redirects an unauthenticated portal visit to
    /// `https://<team>.cloudflareaccess.com` (login page, one-time PIN and the
    /// hand-back to `<portal>/cdn-cgi/access/authorized`). Only that exact team
    /// origin is derived; an external identity provider (for example Google)
    /// must still be added explicitly as its own login origin.
    static func accessTeamOrigin(_ team: String) throws -> Origin {
        guard team.range(of: #"\A[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\z"#, options: .regularExpression) != nil
        else { throw ConfigurationError.invalidOrigin }
        return try Origin("https://\(team).cloudflareaccess.com")
    }
}

/// A notification request posted by the portal page through the single
/// `hehebotNotify` script message handler. The bridge is one-way: it returns
/// nothing to the page and grants no other capability.
public struct NotificationRequest: Equatable {
    public static let handlerName = "hehebotNotify"
    public static let maxTitle = 80, maxBody = 240
    public let title: String
    public let body: String

    /// Accepts only `{title: String, body: String}` (no other keys), from the
    /// main frame of the exact configured portal origin. Text is stripped of
    /// control characters and truncated.
    public init?(body message: Any, isMainFrame: Bool, scheme: String, host: String, port: Int, portal: Origin) {
        guard isMainFrame, scheme == "https",
              let origin = try? Origin("https://\(host)" + (port == 0 || port == 443 ? "" : ":\(port)")),
              origin == portal,
              let dict = message as? [String: Any], Set(dict.keys).isSubset(of: ["title", "body"]),
              let title = dict["title"] as? String, let text = dict["body"] as? String
        else { return nil }
        func clean(_ value: String, _ limit: Int) -> String {
            String(String(value.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }).prefix(limit))
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        self.title = clean(title, Self.maxTitle).isEmpty ? "Hehebot" : clean(title, Self.maxTitle)
        self.body = clean(text, Self.maxBody)
        if self.body.isEmpty { return nil }
    }
}

/// At most `burst` notifications per `window` seconds; excess is dropped, never queued.
public struct NotificationRateLimiter {
    public let burst: Int
    public let window: TimeInterval
    private var sent: [Date] = []
    public init(burst: Int = 3, window: TimeInterval = 10) { self.burst = burst; self.window = window }
    public mutating func allow(now: Date = Date()) -> Bool {
        sent.removeAll { now.timeIntervalSince($0) >= window }
        guard sent.count < burst else { return false }
        sent.append(now)
        return true
    }
}

/// The node LaunchAgent rendered by `mac-node/install-launchd.sh`. Only these
/// fixed `/bin/launchctl` argument vectors are ever run; nothing comes from the page.
public enum MacNodeAgent {
    public static let label = "com.hehebot.mac-node"
    public static let launchctl = "/bin/launchctl"
    public enum Action { case start, stop, status }

    public static func plistPath(home: String) -> String { "\(home)/Library/LaunchAgents/\(label).plist" }

    public static func arguments(_ action: Action, uid: UInt32, home: String) -> [String] {
        switch action {
        case .start: return ["bootstrap", "gui/\(uid)", plistPath(home: home)]
        case .stop: return ["bootout", "gui/\(uid)/\(label)"]
        case .status: return ["print", "gui/\(uid)/\(label)"]
        }
    }
}
