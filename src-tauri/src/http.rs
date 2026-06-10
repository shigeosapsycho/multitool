//! Shared HTTP/TLS plumbing for every ureq agent in the crate.
//!
//! ureq is built with `default-features = false` (see Cargo.toml), which drops
//! its bundled rustls stack so the binary doesn't ship a second TLS engine
//! next to the native-tls/schannel one the IMAP modules already require. The
//! flip side: with rustls off, ureq has **no default TLS backend** — an agent
//! built with a bare `ureq::AgentBuilder::new()` (or the `ureq::get`/`ureq::post`
//! shortcuts) fails at runtime on any https URL with "cannot make HTTPS
//! request because no TLS backend is configured".
//!
//! Therefore every agent in this crate must be constructed through
//! [`agent_builder`], which wires in the process-wide native-tls connector.

use std::sync::{Arc, OnceLock};

/// The process-wide `native_tls::TlsConnector`, created once and shared by
/// every agent (the connector is just configuration + an OS handle; sharing
/// avoids re-initialising schannel/SecureTransport per request batch).
fn tls_connector() -> Arc<native_tls::TlsConnector> {
    static CONNECTOR: OnceLock<Arc<native_tls::TlsConnector>> = OnceLock::new();
    CONNECTOR
        .get_or_init(|| {
            // Construction only fails when the OS TLS stack itself is broken,
            // in which case no https (and no IMAP-over-TLS) is possible anyway.
            Arc::new(
                native_tls::TlsConnector::new()
                    .expect("initialize the OS-native TLS backend"),
            )
        })
        .clone()
}

/// Start a `ureq::AgentBuilder` pre-wired with the shared native-tls
/// connector. Always build ureq agents through this — see the module docs.
pub fn agent_builder() -> ureq::AgentBuilder {
    ureq::AgentBuilder::new().tls_connector(tls_connector())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_tls_agent_constructs() {
        // Exercises native-tls connector init + the ureq tls_connector wiring.
        // No network I/O happens until a request is made.
        let agent = agent_builder().build();
        let _ = &agent;
    }

    #[test]
    fn tls_connector_is_shared_across_calls() {
        assert!(Arc::ptr_eq(&tls_connector(), &tls_connector()));
    }
}
