import SwiftUI
import PortalPolicy
import WebKit

@main
@MainActor
struct HehebotPortalApp: App {
    @StateObject private var session = PortalSession()

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
        Settings { PortalSettings(session: session) }
    }
}

struct PortalView: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

struct PortalSettings: View {
    @ObservedObject var session: PortalSession
    @AppStorage("portalOrigin") private var savedPortal = ""
    @AppStorage("loginOrigins") private var savedLogins = ""
    @State private var portal = ""
    @State private var logins = ""
    @State private var result = ""

    var body: some View {
        Form {
            Text("Only enter trusted HTTPS origins. These settings contain no credentials.")
            TextField("Portal origin", text: $portal)
            Text("Login origins (one per line, at most 16)")
            TextEditor(text: $logins).frame(height: 100)
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
        }.padding().frame(width: 580)
            .onAppear { portal = savedPortal; logins = savedLogins }
            .onChange(of: portal) { oldValue, newValue in
                if oldValue != newValue && newValue != savedPortal { logins = "" }
            }
    }
}
