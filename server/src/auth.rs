//! Upload authentication: verify Massa signature (Blake3 hash of body + Ed25519).
//! Compatible with @massalabs/massa-web3 Account.sign(message): message is hashed with Blake3 then signed.

use blake3::Hasher;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use std::fmt;

/// Error during signature verification or header parsing.
#[derive(Debug)]
pub enum AuthError {
    InvalidBase58(&'static str),
    InvalidPublicKey,
    InvalidSignature,
    VerificationFailed,
}

impl fmt::Display for AuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AuthError::InvalidBase58(which) => write!(f, "invalid base58 {}", which),
            AuthError::InvalidPublicKey => write!(f, "invalid public key"),
            AuthError::InvalidSignature => write!(f, "invalid signature"),
            AuthError::VerificationFailed => write!(f, "signature verification failed"),
        }
    }
}

impl std::error::Error for AuthError {}

/// Extract versioned bytes: first byte is varint version (0 = one byte), rest is payload.
fn strip_version_prefix(bytes: &[u8]) -> Option<&[u8]> {
    if bytes.is_empty() {
        return None;
    }
    let version_byte = bytes[0];
    if version_byte < 0x80 {
        Some(&bytes[1..])
    } else {
        // Multi-byte varint: for Massa V0 we only use single byte
        None
    }
}

/// Hash data with Blake3 (same as massa-web3 PrivateKey.sign: hasher.hash(message)).
fn blake3_hash(data: &[u8]) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(data);
    *hasher.finalize().as_bytes()
}

/// Decode Base58 and strip Massa version byte to get raw key/signature.
/// Public keys from massa-web3 use Base58Check (P + bs58check(version||32 bytes)); plain
/// bs58 decode yields version + 32 bytes + 4-byte checksum = 37 bytes. We strip version and
/// ignore the checksum, taking the first 32 bytes as the key.
fn base58_decode_versioned(encoded: &str, expected_tail_len: usize) -> Result<Vec<u8>, AuthError> {
    let bytes = bs58::decode(encoded)
        .into_vec()
        .map_err(|_| AuthError::InvalidBase58("decode"))?;
    let payload = strip_version_prefix(&bytes).ok_or(AuthError::InvalidPublicKey)?;
    let raw = if payload.len() == expected_tail_len {
        payload.to_vec()
    } else if expected_tail_len == 32 && payload.len() == 36 {
        // Base58Check: payload is 32-byte key + 4-byte checksum; use key only.
        payload[..32].to_vec()
    } else if expected_tail_len == 64 && payload.len() == 68 {
        // Base58Check: payload is 64-byte signature + 4-byte checksum; use signature only.
        payload[..64].to_vec()
    } else {
        return Err(if expected_tail_len == 32 {
            AuthError::InvalidPublicKey
        } else {
            AuthError::InvalidSignature
        });
    };
    Ok(raw)
}

/// Verify upload auth: body was signed by the given public key (Blake3(body) then Ed25519).
/// Headers must contain X-Massa-Address, X-Massa-Signature, X-Massa-Public-Key.
pub fn verify_upload_signature(
    body: &[u8],
    massa_address: &str,
    signature_b58: &str,
    public_key_b58: &str,
) -> Result<(), AuthError> {
    let _ = massa_address; // used for SC check; consistency with pubkey could be added later

    // Public key strings from massa-web3 have a leading "P" prefix (e.g. "P12...").
    // Strip it before base58-decoding the versioned key bytes.
    let pk_str = public_key_b58.strip_prefix('P').unwrap_or(public_key_b58);

    let pubkey_bytes =
        base58_decode_versioned(pk_str, 32).map_err(|_| AuthError::InvalidPublicKey)?;
    let sig_bytes = base58_decode_versioned(signature_b58, 64).map_err(|_| AuthError::InvalidSignature)?;

    let verifying_key = VerifyingKey::from_bytes(
        pubkey_bytes.as_slice().try_into().map_err(|_| AuthError::InvalidPublicKey)?,
    )
    .map_err(|_| AuthError::InvalidPublicKey)?;
    let signature = Signature::from_bytes(sig_bytes.as_slice().try_into().map_err(|_| AuthError::InvalidSignature)?);

    let message_hash = blake3_hash(body);
    verifying_key
        .verify(&message_hash, &signature)
        .map_err(|_| AuthError::VerificationFailed)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// Helper: encode payload with a single-byte version prefix (0) then base58.
    fn encode_versioned_base58(payload: &[u8]) -> String {
        let mut bytes = Vec::with_capacity(1 + payload.len());
        bytes.push(0u8); // version byte
        bytes.extend_from_slice(payload);
        bs58::encode(bytes).into_string()
    }

    #[test]
    fn blake3_hash_deterministic() {
        let h1 = blake3_hash(b"hello");
        let h2 = blake3_hash(b"hello");
        assert_eq!(h1, h2);
    }

    #[test]
    fn verify_upload_signature_accepts_valid_signature() {
        let body = b"test-body";

        // Deterministic signing key from fixed bytes (for reproducible tests).
        let secret = [7u8; 32];
        let signing_key = SigningKey::from_bytes(&secret);
        let verifying_key = signing_key.verifying_key();

        // Sign the same Blake3 hash that verify_upload_signature will verify.
        let message_hash = blake3_hash(body);
        let signature = signing_key.sign(&message_hash);

        let public_key_b58 = encode_versioned_base58(&verifying_key.to_bytes());
        let signature_b58 = encode_versioned_base58(&signature.to_bytes());

        let res = verify_upload_signature(
            body,
            "AU1dummyAddressForTest",
            &signature_b58,
            &public_key_b58,
        );
        assert!(res.is_ok(), "expected Ok(()), got {:?}", res);
    }

    #[test]
    fn verify_upload_signature_rejects_tampered_signature() {
        let body = b"test-body";

        let secret = [3u8; 32];
        let signing_key = SigningKey::from_bytes(&secret);
        let verifying_key = signing_key.verifying_key();

        let message_hash = blake3_hash(body);
        let signature = signing_key.sign(&message_hash);

        let public_key_b58 = encode_versioned_base58(&verifying_key.to_bytes());

        // Corrupt one byte of the signature so verification must fail.
        let mut sig_bytes = signature.to_bytes();
        sig_bytes[0] ^= 0x01;
        let bad_signature_b58 = encode_versioned_base58(&sig_bytes);

        let res = verify_upload_signature(
            body,
            "AU1dummyAddressForTest",
            &bad_signature_b58,
            &public_key_b58,
        );

        match res {
            Err(AuthError::VerificationFailed) => {}
            other => panic!("expected VerificationFailed, got {:?}", other),
        }
    }

    /// Hardcoded real upload: asconfig.json body signed by AU1JnimoipKyiUrowSLP93Q2Ugq43fbz9VJw9TczFFxxGcvj4ZYD.
    /// Signature and public key from massa-web3 Account.sign(body) + toString().
    #[test]
    fn verify_upload_signature_hardcoded_asconfig_json() {
        // Exact contents of smartContract/asconfig.json (body that was signed by upload-file.ts).
        let body = br#"{
    "targets": {
        "release": {
            "sourceMap": true,
            "optimizeLevel": 3,
            "shrinkLevel": 3,
            "converge": true,
            "noAssert": false,
            "exportRuntime": true,
            "bindings": false
        }
    }
}
"#;
        let massa_address = "AU1JnimoipKyiUrowSLP93Q2Ugq43fbz9VJw9TczFFxxGcvj4ZYD";
        let signature_b58 = "1GSs7y6o3Hyhs7UP31aMY9maVxP8QGYkehBvtf8Cch82VWHsWRjdqHSbP4vSDj845EsAUbX4cS8nTQyi7Yd2cUn2pP8MCP";
        let public_key_b58 = "P12Wia8YFNbvGXYKk9aSSEaLJAJka4NnMjtJNPBDeKhvjGf9nzVN";

        let res = verify_upload_signature(body, massa_address, signature_b58, public_key_b58);
        assert!(
            res.is_ok(),
            "verify_upload_signature should accept hardcoded asconfig.json signature, got {:?}",
            res
        );
    }
}
