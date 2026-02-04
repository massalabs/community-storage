//! Args serialization for Massa smart contract call parameters.
//!
//! Provides a compact, deterministic format compatible with the AssemblyScript
//! `Args` encoding used by the Massa runtime.
//!
//! # Format
//! - Numbers are little-endian
//! - Strings are UTF-8 with u32 length prefix
//! - Arrays encode total byte length followed by elements

use std::string::FromUtf8Error;

/// Errors that can occur while decoding arguments.
#[derive(Debug)]
pub enum ArgsError {
    /// Tried to read past the end of the buffer.
    OutOfRange(&'static str),
    /// String was not valid UTF-8.
    InvalidUtf8,
}

impl std::fmt::Display for ArgsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OutOfRange(label) => write!(f, "out of range while reading {}", label),
            Self::InvalidUtf8 => write!(f, "invalid utf8 string"),
        }
    }
}

impl std::error::Error for ArgsError {}

impl From<FromUtf8Error> for ArgsError {
    fn from(_: FromUtf8Error) -> Self {
        ArgsError::InvalidUtf8
    }
}

/// Builder/reader for serialized call arguments.
#[derive(Clone, Debug, Default)]
pub struct Args {
    data: Vec<u8>,
    offset: usize,
}

impl Args {
    /// Create an empty argument buffer.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create an Args reader from serialized bytes.
    pub fn from_bytes(data: Vec<u8>) -> Self {
        Self { data, offset: 0 }
    }

    /// Consume and return the serialized bytes.
    pub fn into_bytes(self) -> Vec<u8> {
        self.data
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Serialization (add_*)
    // ─────────────────────────────────────────────────────────────────────────

    /// Append a `u32` value (little-endian).
    pub fn add_u32(&mut self, value: u32) -> &mut Self {
        self.data.extend_from_slice(&value.to_le_bytes());
        self
    }

    /// Append a `u64` value (little-endian).
    pub fn add_u64(&mut self, value: u64) -> &mut Self {
        self.data.extend_from_slice(&value.to_le_bytes());
        self
    }

    /// Append a UTF-8 string (length-prefixed).
    pub fn add_string(&mut self, value: &str) -> &mut Self {
        let bytes = value.as_bytes();
        self.add_u32(bytes.len() as u32);
        self.data.extend_from_slice(bytes);
        self
    }

    /// Append a length-prefixed byte slice.
    pub fn add_bytes(&mut self, value: &[u8]) -> &mut Self {
        self.add_u32(value.len() as u32);
        self.data.extend_from_slice(value);
        self
    }

    /// Append an array of UTF-8 strings.
    pub fn add_string_array(&mut self, values: &[String]) -> &mut Self {
        let mut content = Vec::new();
        for s in values {
            let bytes = s.as_bytes();
            content.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            content.extend_from_slice(bytes);
        }
        self.add_u32(content.len() as u32);
        self.data.extend_from_slice(&content);
        self
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deserialization (next_*)
    // ─────────────────────────────────────────────────────────────────────────

    /// Read the next `u32` value.
    pub fn next_u32(&mut self) -> Result<u32, ArgsError> {
        if self.offset + 4 > self.data.len() {
            return Err(ArgsError::OutOfRange("u32"));
        }
        let bytes: [u8; 4] = self.data[self.offset..self.offset + 4]
            .try_into()
            .unwrap();
        self.offset += 4;
        Ok(u32::from_le_bytes(bytes))
    }

    /// Read the next `u64` value.
    pub fn next_u64(&mut self) -> Result<u64, ArgsError> {
        if self.offset + 8 > self.data.len() {
            return Err(ArgsError::OutOfRange("u64"));
        }
        let bytes: [u8; 8] = self.data[self.offset..self.offset + 8]
            .try_into()
            .unwrap();
        self.offset += 8;
        Ok(u64::from_le_bytes(bytes))
    }

    /// Read the next length-prefixed byte array.
    pub fn next_bytes(&mut self) -> Result<Vec<u8>, ArgsError> {
        let len = self.next_u32()? as usize;
        if self.offset + len > self.data.len() {
            return Err(ArgsError::OutOfRange("bytes"));
        }
        let bytes = self.data[self.offset..self.offset + len].to_vec();
        self.offset += len;
        Ok(bytes)
    }

    /// Read the next UTF-8 string.
    pub fn next_string(&mut self) -> Result<String, ArgsError> {
        let bytes = self.next_bytes()?;
        Ok(String::from_utf8(bytes)?)
    }

    /// Read a length-prefixed string array.
    pub fn next_string_array(&mut self) -> Result<Vec<String>, ArgsError> {
        let total = self.next_u32()? as usize;
        if self.offset + total > self.data.len() {
            return Err(ArgsError::OutOfRange("string array"));
        }
        let end = self.offset + total;
        let mut values = Vec::new();
        while self.offset < end {
            values.push(self.next_string()?);
        }
        Ok(values)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_string_roundtrip() {
        let mut args = Args::new();
        args.add_string("hello");
        let bytes = args.into_bytes();

        let mut decoded = Args::from_bytes(bytes);
        assert_eq!(decoded.next_string().unwrap(), "hello");
    }

    #[test]
    fn test_string_array_roundtrip() {
        let mut args = Args::new();
        args.add_string_array(&["one".to_string(), "two".to_string(), "three".to_string()]);
        let bytes = args.into_bytes();

        let mut decoded = Args::from_bytes(bytes);
        let values = decoded.next_string_array().unwrap();
        assert_eq!(values, vec!["one", "two", "three"]);
    }

    #[test]
    fn test_mixed_types() {
        let mut args = Args::new();
        args.add_u64(42).add_string("test").add_u32(100);
        let bytes = args.into_bytes();

        let mut decoded = Args::from_bytes(bytes);
        assert_eq!(decoded.next_u64().unwrap(), 42);
        assert_eq!(decoded.next_string().unwrap(), "test");
        assert_eq!(decoded.next_u32().unwrap(), 100);
    }
}
