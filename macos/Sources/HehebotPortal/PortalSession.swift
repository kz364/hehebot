import AppKit
import Combine
import CryptoKit
import PortalPolicy
import WebKit

/// This class has no command submission or retry queue. Its only page-to-native
/// channel is the one-way NotificationBridge registered in connect().
@MainActor
final class PortalSession: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    @Published private(set) var webView: WKWebView?
    @Published private(set) var message = "Configure a portal in Settings, then connect."
    private(set) var configuration: PortalConfiguration?

    override init() {
        super.init()
        let defaults = UserDefaults.standard
        if let portal = defaults.string(forKey: "portalOrigin") {
            configuration = try? PortalConfiguration(portal: portal, loginOrigins:
                (defaults.string(forKey: "loginOrigins") ?? "").split(separator: "\n").map(String.init))
            message = configuration == nil ? "Stored settings are invalid. Review Settings." : "Ready. Connect explicitly to load the portal."
        }
    }

    func configure(_ configuration: PortalConfiguration) {
        suspend("Configuration saved. Connect to load the portal root.")
        self.configuration = configuration
    }

    func suspend(_ reason: String) {
        webView?.stopLoading()
        // Keep weak denial delegates until SwiftUI releases the old NSView.
        webView = nil
        message = reason
    }

    // Stable UUID derived from the full canonical origin. Never share the default store.
    static func storeID(_ origin: Origin) -> UUID {
        let bytes = Array(SHA256.hash(data: Data(origin.value.utf8)).prefix(16))
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5],
                           bytes[6], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11],
                           bytes[12], bytes[13], bytes[14], bytes[15]))
    }

    func connect() {
        guard let configuration else { return }
        suspend("Connecting. Authentication is enforced by the remote portal.")
        let settings = WKWebViewConfiguration()
        settings.websiteDataStore = WKWebsiteDataStore(forIdentifier: Self.storeID(configuration.portal))
        settings.preferences.javaScriptCanOpenWindowsAutomatically = false
        settings.mediaTypesRequiringUserActionForPlayback = .all
        guard let scriptURL = Bundle.module.url(forResource: "Permissions", withExtension: "js"),
              let script = try? String(contentsOf: scriptURL, encoding: .utf8) else {
            message = "Permission policy resource missing. Connection refused."
            return
        }
        // Defense in depth, not a substitute for the App Sandbox entitlement boundary.
        // This script can only remove web APIs; it adds no capability.
        settings.userContentController.addUserScript(WKUserScript(source: script,
            injectionTime: .atDocumentStart, forMainFrameOnly: false))
        // The single, one-way notification bridge (origin/frame/shape checked natively).
        settings.userContentController.add(NotificationBridge(portal: configuration.portal),
            contentWorld: .page, name: NotificationRequest.handlerName)
        let view = RestrictedWebView(frame: .zero, configuration: settings)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = false
        view.isInspectable = false
        webView = view
        // Always a fresh GET of the configured root, never reload/back/resubmit POST.
        view.load(URLRequest(url: configuration.portal.url))
    }

    func openPortalInBrowser() {
        guard let configuration else { return }
        // Called only by native SwiftUI controls; never uses a page-supplied URL.
        NSWorkspace.shared.open(configuration.portal.url)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard webView === self.webView else { decisionHandler(.cancel); return }
        let allowed = configuration?.allowsNavigation(action.request.url,
            hasTargetFrame: action.targetFrame != nil, download: action.shouldPerformDownload) == true
        decisionHandler(allowed ? .allow : .cancel)
        if !allowed { message = "Navigation blocked. Use the native browser action for the portal." }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard webView === self.webView else { decisionHandler(.cancel); return }
        let http = response.response as? HTTPURLResponse
        let attachment = http?.value(forHTTPHeaderField: "Content-Disposition")?
            .lowercased().contains("attachment") == true
        let allowed = configuration?.allowsResponse(response.response.url,
            status: http?.statusCode ?? 0, displayable: response.canShowMIMEType, attachment: attachment) == true
        decisionHandler(allowed ? .allow : .cancel)
        if http?.statusCode == 401 || http?.statusCode == 403 {
            suspend("Session rejected. Remote work may still be active. Reconnect explicitly; do not resend tasks.")
        }
    }

    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                 completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard webView === self.webView else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        // Preserve system TLS verification. Never accept invalid certificates or supply credentials.
        completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust
                          ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard webView === self.webView else { return }
        failed(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard webView === self.webView else { return }
        failed(error)
    }

    private func failed(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        suspend("Connection failed. Nothing was replayed. Reconnect explicitly and inspect remote task status.")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === self.webView else { return }
        suspend("Web content stopped. Nothing was replayed. Reconnect explicitly.")
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        completionHandler(nil)
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.deny) }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { completionHandler() }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) { completionHandler(false) }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) { completionHandler(nil) }
}

/// Remove WebKit's default context menu (open/download/share) and local file drag/drop.
final class RestrictedWebView: WKWebView {
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) { menu.removeAllItems() }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { [] }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { [] }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool { false }
}
