// Target-URL helpers for tools that take a URL from free-form text input.

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Prepend `https://` when the URL has no scheme, so bare hosts like
 * `google.com` are accepted wherever a full URL is expected.
 */
export function normalizeTargetUrl(url: string): string {
  return SCHEME_RE.test(url) ? url : `https://${url}`
}
