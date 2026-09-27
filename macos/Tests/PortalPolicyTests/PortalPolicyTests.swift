import Foundation
import XCTest
@testable import PortalPolicy

final class PortalPolicyTests: XCTestCase {
    func testCanonicalOriginsAndIsolationInputs() throws {
        XCTAssertEqual(try Origin("https://Portal.example:443/"), try Origin("https://portal.example"))
        XCTAssertNotEqual(try Origin("https://portal.example:8443"), try Origin("https://portal.example"))
        XCTAssertNotEqual(try Origin("https://other.example"), try Origin("https://portal.example"))
    }

    func testRejectsAmbiguousAndNonHTTPSConfiguration() {
        for value in ["", " https://portal.example", "http://localhost", "https://a/b", "https://a?", "https://a#",
                      "https://u:p@a", "https://a@evil.example", "https://a\\@evil.example", "https://a.",
                      "https://a..b", "https://-a.test", "https://a:0", "https://a:65536", "https://%61.test",
                      "https://*.test", "https://a\n", "https://é.test", "https://[::1]"] {
            XCTAssertThrowsError(try Origin(value), value)
        }
    }

    func testExactNavigationAndLoginAllowlist() throws {
        let config = try PortalConfiguration(portal: "https://portal.example", loginOrigins: ["https://login.example"])
        for value in ["https://portal.example/tasks?id=3#receipt", "https://login.example/callback?code=synthetic"] {
            XCTAssertTrue(config.allows(URL(string: value)), value)
        }
        for value in ["https://portal.example.evil.test", "https://sub.portal.example", "https://portal.example:8443",
                      "https://portal.example@evil.test", "https://u@portal.example", "http://portal.example",
                      "https://login.example.evil.test", "https://unconfigured.example", "file:///tmp/test", "about:blank",
                      "javascript:alert(1)", "data:text/html,test", "mailto:a@example.com"] {
            XCTAssertFalse(config.allows(URL(string: value)), value)
        }
        XCTAssertFalse(config.allows(nil))
        XCTAssertThrowsError(try PortalConfiguration(portal: "https://p.test", loginOrigins: ["http://login.test"]))
        XCTAssertThrowsError(try PortalConfiguration(portal: "https://p.test", loginOrigins: Array(repeating: "https://l.test", count: 17)))
        XCTAssertFalse(try PortalConfiguration(portal: "https://p.test", loginOrigins: []).allows(URL(string: "https://login.example")))
    }

    func testPopupDownloadAndRevocationBoundaries() throws {
        let config = try PortalConfiguration(portal: "https://p.test", loginOrigins: [])
        let url = URL(string: "https://p.test/task")!
        XCTAssertTrue(config.allowsNavigation(url, hasTargetFrame: true, download: false))
        XCTAssertFalse(config.allowsNavigation(url, hasTargetFrame: false, download: false))
        XCTAssertFalse(config.allowsNavigation(url, hasTargetFrame: true, download: true))
        XCTAssertTrue(config.allowsResponse(url, status: 200, displayable: true, attachment: false))
        for status in [401, 403] {
            XCTAssertFalse(config.allowsResponse(url, status: status, displayable: true, attachment: false))
        }
        XCTAssertFalse(config.allowsResponse(url, status: 200, displayable: false, attachment: false))
        XCTAssertFalse(config.allowsResponse(url, status: 200, displayable: true, attachment: true))
        XCTAssertFalse(config.allowsResponse(URL(string: "https://evil.test"), status: 200, displayable: true, attachment: false))
    }

    func testAccessTeamOriginIsExact() throws {
        XCTAssertEqual(try PortalConfiguration.accessTeamOrigin("ancient-waterfall-b4eb").value, "https://ancient-waterfall-b4eb.cloudflareaccess.com")
        for team in ["", "Team", "a.b", "-a", "a-", "evil.example/", "a b", String(repeating: "a", count: 64)] {
            XCTAssertThrowsError(try PortalConfiguration.accessTeamOrigin(team), team)
        }
        let access = try PortalConfiguration.accessTeamOrigin("team")
        let config = try PortalConfiguration(portal: "https://p.test", loginOrigins: [access.value])
        XCTAssertTrue(config.allows(URL(string: "https://team.cloudflareaccess.com/cdn-cgi/access/login/p.test?kid=x")))
        XCTAssertFalse(config.allows(URL(string: "https://other.cloudflareaccess.com/cdn-cgi/access/login")))
    }

    func testNotificationBridgeAcceptsOnlyPortalMainFrameShapes() throws {
        let portal = try Origin("https://p.test")
        let good = NotificationRequest(body: ["title": "Chief of Staff", "body": "Dentist Tue\u{0007} 10:00"], isMainFrame: true,
                                       scheme: "https", host: "p.test", port: 0, portal: portal)
        XCTAssertEqual(good, NotificationRequest(body: ["title": "Chief of Staff", "body": "Dentist Tue 10:00"], isMainFrame: true,
                                                 scheme: "https", host: "p.test", port: 443, portal: portal))
        XCTAssertEqual(good?.body, "Dentist Tue 10:00")
        XCTAssertNil(NotificationRequest(body: ["title": "x", "body": "y"], isMainFrame: false, scheme: "https", host: "p.test", port: 0, portal: portal))
        XCTAssertNil(NotificationRequest(body: ["title": "x", "body": "y"], isMainFrame: true, scheme: "https", host: "team.cloudflareaccess.com", port: 0, portal: portal))
        XCTAssertNil(NotificationRequest(body: ["title": "x", "body": "y"], isMainFrame: true, scheme: "https", host: "p.test", port: 8443, portal: portal))
        XCTAssertNil(NotificationRequest(body: ["title": "x", "body": "y", "url": "file:///etc"], isMainFrame: true, scheme: "https", host: "p.test", port: 0, portal: portal))
        XCTAssertNil(NotificationRequest(body: "text", isMainFrame: true, scheme: "https", host: "p.test", port: 0, portal: portal))
        XCTAssertNil(NotificationRequest(body: ["title": "x", "body": "   "], isMainFrame: true, scheme: "https", host: "p.test", port: 0, portal: portal))
        let long = NotificationRequest(body: ["title": String(repeating: "t", count: 500), "body": String(repeating: "b", count: 500)],
                                       isMainFrame: true, scheme: "https", host: "p.test", port: 0, portal: portal)
        XCTAssertEqual(long?.title.count, NotificationRequest.maxTitle)
        XCTAssertEqual(long?.body.count, NotificationRequest.maxBody)
        var limiter = NotificationRateLimiter(burst: 2, window: 10)
        let start = Date(timeIntervalSince1970: 0)
        XCTAssertTrue(limiter.allow(now: start)); XCTAssertTrue(limiter.allow(now: start.addingTimeInterval(1)))
        XCTAssertFalse(limiter.allow(now: start.addingTimeInterval(2)))
        XCTAssertTrue(limiter.allow(now: start.addingTimeInterval(10.5)))
    }

    func testMacNodeLaunchctlVectorsAreFixed() {
        XCTAssertEqual(MacNodeAgent.arguments(.start, uid: 501, home: "/Users/o"),
                       ["bootstrap", "gui/501", "/Users/o/Library/LaunchAgents/com.hehebot.mac-node.plist"])
        XCTAssertEqual(MacNodeAgent.arguments(.stop, uid: 501, home: "/Users/o"), ["bootout", "gui/501/com.hehebot.mac-node"])
        XCTAssertEqual(MacNodeAgent.arguments(.status, uid: 501, home: "/Users/o"), ["print", "gui/501/com.hehebot.mac-node"])
        XCTAssertEqual(MacNodeAgent.launchctl, "/bin/launchctl")
    }
}
