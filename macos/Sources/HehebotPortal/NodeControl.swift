import Foundation
import PortalPolicy

/// Start/stop the Hehebot Mac node LaunchAgent (V10) with fixed
/// `/bin/launchctl` argument vectors. The agent must first be installed and
/// paired with `mac-node/install-launchd.sh` (docs/MAC_NODE.md). This works in
/// the unsigned, unsandboxed build; an App Sandbox release cannot manage
/// launchd jobs and would need a separately reviewed helper.
@MainActor
final class NodeControl: ObservableObject {
    @Published private(set) var status = "Unknown"

    var installed: Bool { FileManager.default.fileExists(atPath: MacNodeAgent.plistPath(home: NSHomeDirectory())) }

    func refresh() {
        guard installed else { status = "Not installed"; return }
        status = run(.status) == 0 ? "Running" : "Stopped"
    }

    func start() { guard installed else { refresh(); return }; _ = run(.start); refresh() }
    func stop() { _ = run(.stop); refresh() }

    private func run(_ action: MacNodeAgent.Action) -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: MacNodeAgent.launchctl)
        process.arguments = MacNodeAgent.arguments(action, uid: getuid(), home: NSHomeDirectory())
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return -1 }
        process.waitUntilExit()
        return process.terminationStatus
    }
}
