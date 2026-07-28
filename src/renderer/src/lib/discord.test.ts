import { describe, expect, it } from 'vitest'
import { isDiscordWebhookUrl } from './discord'

describe('isDiscordWebhookUrl', () => {
  it('accepts canonical and variant webhook URLs', () => {
    for (const url of [
      'https://discord.com/api/webhooks/123456789/abcDEF_-123',
      'https://discordapp.com/api/webhooks/1/t',
      'https://ptb.discord.com/api/webhooks/42/token',
      'https://canary.discord.com/api/webhooks/42/token',
      'https://discord.com/api/v10/webhooks/123/token'
    ]) {
      expect(isDiscordWebhookUrl(url), url).toBe(true)
    }
  })

  it('accepts a valid URL padded with whitespace', () => {
    expect(isDiscordWebhookUrl('  https://discord.com/api/webhooks/1/t \n')).toBe(true)
  })

  it('rejects non-webhook URLs and empty input', () => {
    for (const url of [
      '',
      'not a url',
      'http://discord.com/api/webhooks/123/token',
      'https://example.com/api/webhooks/123/token',
      'https://evil-discord.com/api/webhooks/123/token',
      'https://discord.com/api/webhooks/123',
      'https://discord.com/api/webhooks/abc/token',
      'https://discord.com/api/webhooks/123/token/extra',
      'https://discord.com/api/webhooks/123/token?wait=true',
      'https://discord.com/webhooks/123/token'
    ]) {
      expect(isDiscordWebhookUrl(url), url).toBe(false)
    }
  })
})
