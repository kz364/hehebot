import Foundation
import PortalPolicy
import UserNotifications
import WebKit

/// The only page-to-native channel: `window.webkit.messageHandlers.hehebotNotify
/// .postMessage({title, body})` from the portal's main frame shows a local
/// macOS notification. It is one-way (nothing is returned to the page), off
/// until the owner enables it in Settings, rate limited, and ignores every
/// other origin, frame and shape (see `NotificationRequest`).
@MainActor
final class NotificationBridge: NSObject, WKScriptMessageHandler {
    static let enabledKey = "nativeNotifications"
    private let portal: Origin
    private var limiter = NotificationRateLimiter()

    init(portal: Origin) { self.portal = portal }

    /// Notifications need a real app bundle identity; a bare `swift run` binary has none.
    static var available: Bool { Bundle.main.bundleIdentifier != nil && Bundle.main.bundleURL.pathExtension == "app" }

    /// Asked only when the owner turns the setting on; never at launch.
    static func requestAuthorization(_ done: @escaping @MainActor (Bool) -> Void) {
        guard available else { done(false); return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            Task { @MainActor in done(granted) }
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == NotificationRequest.handlerName,
              UserDefaults.standard.bool(forKey: Self.enabledKey), Self.available else { return }
        let origin = message.frameInfo.securityOrigin
        guard let request = NotificationRequest(body: message.body, isMainFrame: message.frameInfo.isMainFrame,
                                                scheme: origin.protocol, host: origin.host, port: origin.port, portal: portal),
              limiter.allow() else { return }
        let content = UNMutableNotificationContent()
        content.title = request.title
        content.body = request.body
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
}
