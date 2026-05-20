//! Stores the IMAP password in the Windows Credential Manager via the
//! `keyring` crate. The host/port/username live in `config.json`; only the
//! password is kept here so it is never written to disk in plain text.

/// Credential Manager "service" namespace. The entry "user" is the
/// `ImapAccount.id`.
const SERVICE: &str = "com.beu.multitool.imap";

fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, id).map_err(|e| format!("Credential store error: {e}"))
}

/// Write (or overwrite) the password for the given account id.
pub fn save_password(id: &str, password: &str) -> Result<(), String> {
    entry(id)?
        .set_password(password)
        .map_err(|e| format!("Could not save password: {e}"))
}

/// Read the password for the given account id.
/// Returns `Ok(None)` when no entry exists (account needs the password re-entered).
pub fn load_password(id: &str) -> Result<Option<String>, String> {
    match entry(id)?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read password: {e}")),
    }
}

/// Delete the password for the given account id. A missing entry is not an error.
pub fn delete_password(id: &str) -> Result<(), String> {
    match entry(id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not delete password: {e}")),
    }
}
