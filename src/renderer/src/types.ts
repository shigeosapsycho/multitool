export type Route =
  | 'tools'
  | 'add-passwords'
  | 'combine-profiles'
  | 'csv-email-pass'
  | 'csv-filter'
  | 'email-cleaner'
  | 'email-filter'
  | 'email-unsubscribe'
  | 'find-duplicates'
  | 'find-non-duplicates'
  | 'listify'
  | 'match-email-pass'
  | 'multiply-lines'
  | 'numbered-list-generator'
  | 'order-email-by'
  | 'order-tracker'
  | 'profile-filter'
  | 'proxy-cleaner'
  | 'proxy-tester'
  | 'randomize'
  | 'randomize-proxy-list'
  | 'remove-duplicates'
  | 'remove-passwords'
  | 'remove-profile-duplicates'
  | 'reverse-list'
  | 'search-master'
  | 'sort-list'
  | 'split-by-n'
  | 'target-sku'
  | 'results'
  | 'settings'
  | 'logs'

export type ToolMeta = {
  id: Exclude<Route, 'tools' | 'results' | 'settings' | 'logs'>
  title: string
  description: string
  accent: string
}

export type LogEntry = { time: number; message: string; kind: 'info' | 'success' | 'error' }
