# Email Cleaner — Module Design

**Date:** 2026-05-19
**Status:** Approved — ready for implementation planning
**Target app:** Beu MultiTool (Tauri 2 + React/Vite/Tailwind), v3.x

## Summary

A new tool module, **Email Cleaner**, that connects to a user's IMAP mailbox,
scans the INBOX over a user-chosen date range, presents the matching emails
grouped by sender, and lets the user delete the ones they select — either by
moving them to the mailbox Trash folder or by permanently expunging them.

IMAP connection details (host, port, username) are stored locally in the app's
`config.json`. The IMAP password is stored in the Windows Credential Manager,
never written to disk in plain text.

## Goals

- Let the user save one or more IMAP accounts and switch between them.
- Scan the INBOX over a date range or a "last N days" window.
- Present results grouped by sender so the user can bulk-select.
- Delete selected emails: move to Trash by default, or permanently expunge.
- Keep the IMAP password out of plain-text storage.

## Non-Goals (YAGNI)

- Reading or previewing email bodies — headers only.
- Scanning folders other than INBOX.
- OAuth / XOAUTH2 — password and app-password authentication only.
- Scheduled or automatic cleanup.
- Streaming per-email progress events (a running spinner + status text suffices for v1).

## Architecture

The IMAP work runs entirely in the Rust backend. The renderer (React) is UI
only. Each Rust command opens a fresh IMAP connection, performs its work, and
disconnects — a **stateless** model. No IMAP session is held across commands.

Rationale: IMAP login costs roughly one second; a stateless model avoids a
whole class of dropped-socket and idle-timeout bugs, needs no shared mutable
session state, and matches the existing fire-and-forget pattern used by the
Proxy Tester module.

Rejected alternatives:
- **Stateful session** (hold a live `Session` in a `Mutex` across commands):
  saves ~2 seconds per flow but adds reconnect logic for server idle timeouts.
- **Renderer-side IMAP** (IMAP from JS in the WebView): impossible — the WebView
  cannot open raw TLS sockets, and it would put the password in renderer memory.

### New dependencies (`src-tauri/Cargo.toml`)

- `imap` — IMAP client.
- `native-tls` — TLS via the Windows SChannel system provider; no new system dependency.
- `keyring` — Windows Credential Manager access.

## Components

### 1. Renderer registration

- `src/renderer/src/types.ts` — add `'email-cleaner'` to the `Route` union and
  to the `ToolMeta` `id` type.
- `src/renderer/src/App.tsx` — add `'email-cleaner'` to `TOOL_ROUTES`; add a
  case to the `renderTool` switch; import `EmailCleanerPage`.
- `src/renderer/src/pages/Tools.tsx` — add an entry to the `tools` array (accent
  color rose `#fb7185`, currently unused) and an icon to `TOOL_ICONS` (envelope).
- `src/renderer/src/pages/EmailCleaner.tsx` — new page, built on the existing
  `ToolShell` (`ToolLayout`, `Card`, `Button`, `Stat`, `Icons`) and
  `ConfirmDialog` components.

### 2. Config — `src-tauri/src/config.rs`

Extend the `Config` struct with a new optional field:

```rust
pub imap_accounts: Option<Vec<ImapAccount>>,
```

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImapAccount {
    pub id: String,        // stable key, also the Credential Manager key
    pub label: String,     // user-facing name
    pub host: String,
    pub port: u16,
    pub username: String,
    pub use_ssl: bool,     // implicit TLS (port 993); default true
}
```

The password is **not** a field — it lives only in the Credential Manager.
The field is `Option` so existing `config.json` files still deserialize.

### 3. Credentials — Windows Credential Manager

- Crate: `keyring`.
- Service name: `com.beu.multitool.imap`.
- Entry key: the `ImapAccount.id`.
- Save account → write host/port/username/label/useSsl to `config.json`,
  write the password to the keyring under `id`.
- Delete account → remove the config entry **and** the keyring entry.
- Scan / delete / test → load the password from the keyring by `id`.
- A missing keyring entry for an existing account is treated as
  "password needs to be re-entered" rather than a hard error.

### 4. Rust commands — `src-tauri/src/commands.rs`

| Command | Behavior |
|---|---|
| `imap_list_accounts() -> Vec<ImapAccount>` | Read accounts from `config.json`. |
| `imap_save_account(account, password) -> ImapAccount` | If the account has no `id`, generate one (a random hex string via the already-present `rand` crate); write config + keyring; return the saved account. Editing an existing account keeps its `id`. |
| `imap_delete_account(id)` | Remove the config entry and the keyring entry. |
| `imap_test(id) -> Result<()>` | Connect → login → `SELECT INBOX` → logout. Verifies credentials. |
| `imap_scan(id, range) -> Vec<EmailHeader>` | Connect, `SELECT INBOX`, `UID SEARCH` by date, `UID FETCH` ENVELOPE + RFC822.SIZE + INTERNALDATE, disconnect. |
| `imap_delete(id, uids, permanent) -> DeleteResult` | Connect, `SELECT INBOX`, delete the given UIDs. |
| `imap_cancel()` | Set an `AtomicBool` so an in-progress `imap_scan` aborts (mirrors the Proxy Tester cancel pattern). |

#### Data types

```
ScanRange  = { mode: "dateRange", from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
           | { mode: "lastDays",  days: u32 }

EmailHeader = { uid: u32, fromName: String, fromAddr: String,
                subject: String, dateMs: i64, sizeBytes: u32 }

DeleteResult = { deleted: u32, failed: Vec<u32> }
```

#### Range → IMAP search

- `dateRange` → `SINCE <from>` and `BEFORE <to+1day>` (IMAP `BEFORE` is
  exclusive; add one day so the `to` date is inclusive).
- `lastDays` → `SINCE <today − days>`.
- IMAP search dates use the `DD-Mon-YYYY` format (e.g. `19-May-2026`).

#### Delete behavior

- `permanent == false` → `UID MOVE` the UIDs to the Trash folder. If the server
  does not advertise the `MOVE` capability, fall back to
  `UID COPY` to Trash + `UID STORE \Deleted` + `UID EXPUNGE`.
- `permanent == true` → `UID STORE \Deleted` + `UID EXPUNGE`. The emails are
  permanently removed and cannot be recovered.

#### Trash folder detection

1. `LIST` the mailbox and pick the folder whose SPECIAL-USE attribute is `\Trash`.
2. If none, try common names in order: `Trash`, `[Gmail]/Trash`,
   `Deleted Items`, `Bin`.
3. If none match, `imap_delete` with `permanent == false` returns an error
   asking the user to permanently delete instead — it never silently expunges.

### 5. API bridge — `src/renderer/src/lib/api.ts`

Add an `imap` namespace mirroring the commands, with matching TypeScript types
(`ImapAccount`, `EmailHeader`, `ScanRange`, `DeleteResult`), following the
existing `net` namespace pattern.

### 6. Page UI — `EmailCleaner.tsx`

Single page with three stacked regions inside `ToolLayout`:

**Account bar (top).** A dropdown of saved accounts plus Add / Edit / Remove
controls. Add and Edit open an inline form: label, host, port, username,
password, SSL toggle. The form has a **Test** button (`imap_test`) and a
**Save** button (`imap_save_account`). A note in the form states that Gmail and
Outlook accounts with 2FA require an **app password**, not the main account
password, because basic-auth IMAP is otherwise disabled.

**Range picker.** A toggle between `Date range` and `Last N days`. Date range
shows two `<input type="date">` fields; Last N days shows a number input. The
`Scan Inbox` action is wired to `ToolLayout`'s `onRun`. While a scan runs, the
layout shows the running state; a `Stop` button calls `imap_cancel`.

**Results — grouped by sender.** After a scan, emails are grouped by `fromAddr`.
Each group row shows: a checkbox, the sender, the email count, the combined
size, and an expand caret. Expanding a group reveals one row per email
(checkbox, subject, date, size). Checking a group selects all of its emails;
individual emails can also be checked. A select-all control and a live
"N selected" count are shown.

**Footer.** A `Delete Permanently` checkbox and a `Delete N emails` button.
Clicking Delete opens `ConfirmDialog`. When `Delete Permanently` is checked the
dialog uses stern wording: *"These emails will be permanently removed and
cannot be recovered."* After a successful delete, the deleted UIDs are removed
from the list and the status line is updated. Any UIDs in `DeleteResult.failed`
are reported in the status line.

## Data Flow

1. Page mounts → `imap_list_accounts` → populate the account dropdown.
2. User adds/edits an account → `imap_save_account` → config + keyring updated.
3. User selects an account, picks a range, clicks **Scan Inbox** →
   `imap_scan(id, range)` → `EmailHeader[]` → grouped by sender in the renderer.
4. User checks senders / individual emails → renderer tracks selected UIDs.
5. User clicks **Delete** → `ConfirmDialog` → `imap_delete(id, uids, permanent)`
   → `DeleteResult` → deleted UIDs removed from the list, status updated.

## Error Handling

- Connection or login failure → an error string is returned to the renderer and
  shown in the form (for Test) or the status line (for Scan/Delete). Examples:
  `Authentication failed`, `Connection refused`, `Connection timed out`.
- Missing keyring entry for a saved account → the account is flagged as needing
  the password re-entered; scan/delete are blocked until it is.
- Scan returns zero emails → the results region shows an empty state.
- Partial delete failure → the failed UIDs from `DeleteResult.failed` are shown
  in the status line; succeeded UIDs are still removed from the list.
- No Trash folder found on a non-permanent delete → `imap_delete` returns an
  error; it never silently expunges.
- Scan cancelled via `imap_cancel` → `imap_scan` returns whatever it has, or an
  empty result, with a "cancelled" status.

## Testing

- **Rust unit tests** for the pure helpers:
  - range → IMAP search-criteria builder (`dateRange` and `lastDays`,
    including the `BEFORE` off-by-one).
  - Trash-folder picker (SPECIAL-USE attribute, then fallback names).
  - IMAP `ENVELOPE` → `EmailHeader` parsing.
- Live IMAP behavior is **not** unit-tested — it needs a real server. It is
  verified manually against a real account.
- **Renderer**: manual verification — the repo has no JS test runner. Manual
  path: add account → Test → Scan → expand groups → select by sender → delete
  to Trash → delete permanently → confirm UIDs leave the list.

## Build Note

This adds three Rust crates, so the first `npm run build:win` after the change
recompiles the dependency tree — allow extra time on that first build.
