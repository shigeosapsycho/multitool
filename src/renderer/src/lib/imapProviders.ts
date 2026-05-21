// Known IMAP providers keyed by email-address domain. Shared by the account
// picker so that typing an email auto-fills the IMAP host and port.

export const IMAP_PROVIDERS: Record<string, { host: string; port: number }> = {
  'gmail.com': { host: 'imap.gmail.com', port: 993 },
  'googlemail.com': { host: 'imap.gmail.com', port: 993 },
  'outlook.com': { host: 'outlook.office365.com', port: 993 },
  'hotmail.com': { host: 'outlook.office365.com', port: 993 },
  'live.com': { host: 'outlook.office365.com', port: 993 },
  'msn.com': { host: 'outlook.office365.com', port: 993 },
  'icloud.com': { host: 'imap.mail.me.com', port: 993 },
  'me.com': { host: 'imap.mail.me.com', port: 993 },
  'mac.com': { host: 'imap.mail.me.com', port: 993 },
  'yahoo.com': { host: 'imap.mail.yahoo.com', port: 993 },
  'aol.com': { host: 'imap.aol.com', port: 993 }
}

/** Look up the IMAP host/port for an email address's domain, if known. */
export function providerFor(email: string): { host: string; port: number } | undefined {
  const domain = email.split('@')[1]?.toLowerCase().trim()
  return domain ? IMAP_PROVIDERS[domain] : undefined
}
