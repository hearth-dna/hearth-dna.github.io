package com.hearth

import org.junit.Assert.assertEquals
import org.junit.Test

/** The pure half of [Cloud]: the PKCE challenge and the form encoding of the token requests. */
class CloudTest {
    @Test
    fun `derives the S256 challenge as unpadded base64url of the SHA-256`() {
        // Checked independently: base64.urlsafe_b64encode(hashlib.sha256(verifier).digest()).
        assertEquals(
            "bpQKmjXolkteYudsA6aHW_vcx_hQxkyzZwHOQUVNxmU",
            Cloud.challenge("dBjftJeZ4CVP-mJ92K9SJYlXTrb_EiNhS4ExsvT7uZE"),
        )
    }

    @Test
    fun `encodes a token request as a form`() {
        assertEquals(
            "grant_type=authorization_code&redirect_uri=db-abc%3A%2F%2F2%2Ftoken&code=a+b%26c",
            Cloud.form("grant_type" to "authorization_code", "redirect_uri" to "db-abc://2/token", "code" to "a b&c"),
        )
    }
}
