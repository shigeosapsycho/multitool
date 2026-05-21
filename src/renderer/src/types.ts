export type Route =
  | 'tools'
  | 'csv-email-pass'
  | 'email-cleaner'
  | 'email-filter'
  | 'find-duplicates'
  | 'find-non-duplicates'
  | 'proxy-tester'
  | 'randomize'
  | 'remove-passwords'
  | 'resi-cleaner'
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
