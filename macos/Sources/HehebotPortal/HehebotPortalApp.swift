import SwiftUI
import PortalPolicy
import WebKit

/// `--self-test` loads the policy and bundled resources, prints one JSON line
/// and exits without creating any window, web view, notification or launchd
/// call (a headless smoke check for build-app.sh / CI).
@main
enum HehebotPortalEntry {
    static func main() {
        if CommandLine.arguments.contains("--self-test") { exit(SelfTest.run()) }
        HehebotPortalApp.main()
    }
}

enum SelfTest {
    static func run() -> Int32 {
        var checks: [String: Bool] = [:]
        let config = try? PortalConfiguration(portal: "https://portal.example",
            loginOrigins: [(try? PortalConfiguration.accessTeamOrigin("team"))?.value ?? ""])
        checks["policy"] = config?.allows(URL(string: "https://portal.example/v1/state")) == true
            && config?.allows(URL(string: "https://team.cloudflareaccess.com/cdn-cgi/access/login")) == true
            && config?.allows(URL(string: "https://evil.example")) == false
        let script = Bundle.module.url(forResource: "Permissions", withExtension: "js")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
        checks["permissions_script"] = script?.contains("'Notification'") == true
        checks["notification_policy"] = config.map { NotificationRequest(body: ["title": "t", "body": "b"], isMainFrame: true,
            scheme: "https", host: "portal.example", port: 0, portal: $0.portal) != nil } == true
        checks["node_control"] = MacNodeAgent.arguments(.stop, uid: 0, home: "/").first == "bootout"
        let ok = checks.values.allSatisfy { $0 }
        let body = checks.keys.sorted().map { "\"\($0)\":\(checks[$0]!)" }.joined(separator: ",")
        print("{\"self_test\":\(ok ? "\"passed\"" : "\"failed\""),\(body),\"bundle\":\"\(Bundle.main.bundleIdentifier ?? "none")\"}")
        return ok ? 0 : 1
    }
}

@MainActor
struct HehebotPortalApp: App {
    @StateObject private var session = PortalSession()
    @StateObject private var node = NodeControl()

    var body: some Scene {
        Window("Hehebot Portal", id: "portal") {
            VStack(spacing: 0) {
                HStack {
                    Text(session.configuration?.portal.value ?? "No portal configured")
                    Spacer()
                    Button("Connect to Portal") { session.connect() }
                        .disabled(session.configuration == nil)
                    Button("Lock Session") { session.suspend("Session locked locally. Remote work is unchanged.") }
                }.padding()
                Text(session.message).font(.caption).padding(.horizontal)
                if let webView = session.webView {
                    PortalView(webView: webView)
                        .id(ObjectIdentifier(webView))
                } else {
                    Spacer()
                    Text("Remote-only client. Closing or locking this window does not cancel tasks.")
                    SettingsLink { Text("Portal Settings…") }
                    Spacer()
                }
            }
            .frame(minWidth: 760, minHeight: 540)
            .onDisappear { session.suspend("Window closed. Reconnect explicitly; remote work is unchanged.") }
        }
        .commands {
            CommandMenu("Portal") {
                Button("Connect to Portal Root") { session.connect() }
                    .disabled(session.configuration == nil)
                Button("Lock Session") { session.suspend("Session locked locally. Remote work is unchanged.") }
                Button("Open Portal in Default Browser") { session.openPortalInBrowser() }
                    .disabled(session.configuration == nil)
            }
        }
        MenuBarExtra("Hehebot", systemImage: "bubble.left.and.bubble.right") {
            StatusMenu(session: session, node: node)
        }
        Settings { PortalSettings(session: session, node: node) }
    }
}

/// Menu bar basics: open/connect/lock the portal window and start/stop the Mac node.
struct StatusMenu: View {
    @ObservedObject var session: PortalSession
    @ObservedObject var node: NodeControl
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("Open Portal Window") { openWindow(id: "portal"); NSApp.activate() }
        Button("Connect to Portal") { openWindow(id: "portal"); session.connect() }
            .disabled(session.configuration == nil)
        Button("Lock Session") { session.suspend("Session locked locally. Remote work is unchanged.") }
        Divider()
        Text("Mac node: \(node.status)")
        Button("Start Mac Node") { node.start() }.disabled(!node.installed)
        Button("Stop Mac Node") { node.stop() }.disabled(!node.installed)
        Button("Refresh Node Status") { node.refresh() }
        Divider()
        Button("Quit Hehebot") { NSApp.terminate(nil) }
    }
}

struct PortalView: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

struct PortalSettings: View {
    @ObservedObject var session: PortalSession
    @ObservedObject var node: NodeControl
    @AppStorage("portalOrigin") private var savedPortal = ""
    @AppStorage("loginOrigins") private var savedLogins = ""
    @AppStorage(NotificationBridge.enabledKey) private var notifications = false
    @State private var portal = ""
    @State private var logins = ""
    @State private var team = ""
    @State private var result = ""

    var body: some View {
        Form {
            Text("Only enter trusted HTTPS origins. These settings contain no credentials.")
            TextField("Portal origin", text: $portal)
            Text("Login origins (one per line, at most 16)")
            TextEditor(text: $logins).frame(height: 100)
            HStack {
                TextField("Cloudflare Access team (e.g. my-team)", text: $team)
                Button("Add Access login origin") {
                    do {
                        let origin = try PortalConfiguration.accessTeamOrigin(team).value
                        if !logins.split(separator: "\n").contains(Substring(origin)) { logins += (logins.isEmpty ? "" : "\n") + origin }
                        result = "Added \(origin). Add your identity provider's origin too if Access uses one (not needed for one-time PIN)."
                    } catch { result = "Rejected: the team name is the lowercase label before .cloudflareaccess.com." }
                }
            }
            Text("Saving locks the current view. Cookies remain isolated by portal. A different portal does not inherit these login origins automatically.")
                .font(.caption)
            Button("Validate and Save") {
                do {
                    let config = try PortalConfiguration(portal: portal, loginOrigins: logins
                        .split(separator: "\n").map(String.init))
                    savedPortal = config.portal.value
                    savedLogins = config.loginOrigins.map(\.value).sorted().joined(separator: "\n")
                    session.configure(config)
                    result = "Saved. Use Connect to Portal to begin."
                } catch { result = "Rejected: use complete HTTPS origins, without paths, credentials, query or fragment." }
            }
            Text(result).accessibilityLabel(result)
            Divider()
            Toggle("Show a macOS notification when a bot posts while this window is in the background", isOn: $notifications)
                .disabled(!NotificationBridge.available)
                .onChange(of: notifications) { _, enabled in
                    if enabled { NotificationBridge.requestAuthorization { granted in if !granted { notifications = false } } }
                }
            if !NotificationBridge.available { Text("Notifications need the bundled app (macos/scripts/build-app.sh).").font(.caption) }
            Divider()
            HStack {
                Text("Mac node: \(node.status)")
                Spacer()
                Button("Start") { node.start() }.disabled(!node.installed)
                Button("Stop") { node.stop() }.disabled(!node.installed)
            }
            Text("Install and pair the node first: mac-node/install-launchd.sh (see docs/MAC_NODE.md).").font(.caption)
        }.padding().frame(width: 620)
            .onAppear { portal = savedPortal; logins = savedLogins; node.refresh() }
            .onChange(of: portal) { oldValue, newValue in
                if oldValue != newValue && newValue != savedPortal { logins = "" }
            }
    }
}
