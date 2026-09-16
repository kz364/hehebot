// swift-tools-version: 5.9
import PackageDescription

var targets: [Target] = [
    .target(name: "PortalPolicy"),
    .testTarget(name: "PortalPolicyTests", dependencies: ["PortalPolicy"])
]
var products: [Product] = []
#if os(macOS)
targets.append(.executableTarget(name: "HehebotPortal", dependencies: ["PortalPolicy"],
                                 resources: [.copy("Permissions.js")]))
products.append(.executable(name: "HehebotPortal", targets: ["HehebotPortal"]))
#endif

let package = Package(
    name: "HehebotPortal",
    platforms: [.macOS(.v14)],
    products: products,
    targets: targets
)
