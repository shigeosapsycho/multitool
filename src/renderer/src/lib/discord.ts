// "Send to Discord" helpers: webhook URL validation plus a tiny module-level
// store so deeply nested panels (ResultPanel, Results page) can react to the
// Settings value without threading a prop through every tool page.

import { useSyncExternalStore } from 'react'

// Mirrors discord::is_webhook_url in src-tauri (the enforcing copy):
// https:// + discord.com | discordapp.com | ptb./canary. host + /api[/vN]/webhooks/<id>/<token>
const WEBHOOK_RE =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+$/

/** True when `url` (trimmed) is a full Discord webhook URL. Empty ⇒ false. */
export function isDiscordWebhookUrl(url: string): boolean {
  return WEBHOOK_RE.test(url.trim())
}

let current = ''
const listeners = new Set<() => void>()

export function getDiscordWebhookUrl(): string {
  return current
}

/** Update the stored URL and notify every mounted subscriber. */
export function setDiscordWebhookUrl(url: string): void {
  const next = url.trim()
  if (next === current) return
  current = next
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reactive view of the stored webhook URL ('' when unset). */
export function useDiscordWebhookUrl(): string {
  return useSyncExternalStore(subscribe, getDiscordWebhookUrl)
}
