import Foundation

public enum ConfigurationError: Error { case invalidOrigin, tooManyLoginOrigins }

/// Deliberately narrow DNS HTTPS grammar, not a browser's forgiving URL parser.
/// No IPv6 literals, IDN Unicode, trailing dot or escaped authority. Default port is 443.
public struct Origin: Hashable {
    public let value: String
    public var url: URL { URL(string: value + "/")! }

    public init(_ text: String) throws {
        guard text.utf8.count <= 2048,
              text.range(of: #"\Ahttps://[A-Za-z0-9.-]+(?::[0-9]{1,5})?/?\z"#,
                         options: .regularExpression) != nil,
              let parts = URLComponents(string: text), let host = parts.host,
              host.count <= 253,
              host.split(separator: ".", omittingEmptySubsequences: false).allSatisfy({ label in
                  !label.isEmpty && label.count <= 63 && label.first != "-" && label.last != "-"
              }), (1...65535).contains(parts.port ?? 443)
        else { throw ConfigurationError.invalidOrigin }
        let port = parts.port ?? 443
        value = "https://" + host.lowercased() + (port == 443 ? "" : ":\(port)")
    }

    public static func of(_ url: URL) -> Origin? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "https", parts.user == nil, parts.password == nil,
              let host = parts.host, !host.contains("%") else { return nil }
        return try? Origin("https://" + host + (parts.port.map { ":\($0)" } ?? ""))
    }
}

public struct PortalConfiguration {
    public let portal: Origin
    public let loginOrigins: Set<Origin>

    public init(portal: String, loginOrigins: [String]) throws {
        guard loginOrigins.count <= 16 else { throw ConfigurationError.tooManyLoginOrigins }
        self.portal = try Origin(portal)
        self.loginOrigins = try Set(loginOrigins.map(Origin.init))
    }

    public func allows(_ url: URL?) -> Bool {
        guard let url, let origin = Origin.of(url) else { return false }
        return origin == portal || loginOrigins.contains(origin)
    }

    public func allowsNavigation(_ url: URL?, hasTargetFrame: Bool, download: Bool) -> Bool {
        hasTargetFrame && !download && allows(url)
    }

    public func allowsResponse(_ url: URL?, status: Int, displayable: Bool, attachment: Bool) -> Bool {
        allows(url) && status != 401 && status != 403 && displayable && !attachment
    }
}
