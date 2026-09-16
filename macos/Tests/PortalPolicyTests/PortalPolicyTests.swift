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
}
