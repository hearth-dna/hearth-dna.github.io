import XCTest
@testable import Hearth

/// The pure half of NativeFiles: which names the page may send, and how iCloud's placeholders read.
/// The picker and the coordinated file calls need a device and a provider.
final class NativeFilesTests: XCTestCase {
    func testAcceptsTheNamesTheWebAppUses() throws {
        for name in ["hearth-backup.hearth", "hearth-backup.hearth.1", "README.txt", "attachments"] {
            XCTAssertEqual(try NativeFiles.checkedName(name), name)
        }
    }

    func testRefusesAnythingThatLooksLikeAPath() {
        for name in ["", ".", "..", "a/b", "../x", "nul\0l"] {
            XCTAssertThrowsError(try NativeFiles.checkedName(name), name)
        }
    }

    func testListsAnEvictedICloudFileUnderItsOwnName() {
        XCTAssertEqual(NativeFiles.visibleName(".hearth-backup.hearth.icloud"), "hearth-backup.hearth")
        XCTAssertEqual(NativeFiles.visibleName("hearth-backup.hearth"), "hearth-backup.hearth")
        XCTAssertEqual(NativeFiles.visibleName(".icloud"), ".icloud")
        XCTAssertEqual(NativeFiles.visibleName(".DS_Store"), ".DS_Store")
    }
}

/// The pure half of Cloud: PKCE, the token request body and reading who signed in.
final class CloudTests: XCTestCase {
    func testDerivesTheS256ChallengeAsUnpaddedBase64url() {
        // Checked independently: base64.urlsafe_b64encode(hashlib.sha256(verifier).digest()).
        XCTAssertEqual(
            Cloud.challenge("dBjftJeZ4CVP-mJ92K9SJYlXTrb_EiNhS4ExsvT7uZE"),
            "bpQKmjXolkteYudsA6aHW_vcx_hQxkyzZwHOQUVNxmU"
        )
    }

    func testEncodesATokenRequestAsAForm() {
        XCTAssertEqual(
            Cloud.formBody(["code": "a b&c", "redirect_uri": "db-abc://2/token"]),
            "code=a%20b%26c&redirect_uri=db-abc%3A%2F%2F2%2Ftoken"
        )
    }

    func testReadsTheGoogleAccountFromTheIdToken() {
        // Header and signature are irrelevant: only the claims are read, for display.
        let claims = #"{"sub":"42","email":"someone@hearth.example"}"#
        let payload = Cloud.base64url(Data(claims.utf8))
        let identity = Cloud.identity("google", ["id_token": "e30.\(payload).sig"])
        XCTAssertEqual(identity.account, "someone@hearth.example")
        XCTAssertEqual(identity.label, "someone@hearth.example")
    }

    func testIsNotOfferedWithoutABuildSetting() {
        // The test bundle carries neither key, exactly like a build without the .env values.
        XCTAssertNil(Cloud.provider("google", bundle: Bundle(for: CloudTests.self)))
        XCTAssertNil(Cloud.provider("dropbox", bundle: Bundle(for: CloudTests.self)))
    }
}
