export type Route =
  | 'tools'
  | 'find-duplicates'
  | 'remove-passwords'
  | 'find-non-duplicates'
  | 'split-by-n'
  | 'randomize'
  | 'search-master'
  | 'email-filter'
  | 'csv-email-pass'
  | 'proxy-tester'
  | 'reverse-list'
  | 'email-cleaner'
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
