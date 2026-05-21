export type Route =
  | 'tools'
  | 'csv-email-pass'
  | 'email-cleaner'
  | 'email-filter'
  | 'email-unsubscribe'
  | 'find-duplicates'
  | 'find-non-duplicates'
  | 'proxy-cleaner'
  | 'proxy-tester'
  | 'randomize'
  | 'remove-passwords'
  | 'reverse-list'
  | 'search-master'
  | 'split-by-n'
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
