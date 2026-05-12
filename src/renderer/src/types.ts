export type Route =
  | 'tools'
  | 'find-duplicates'
  | 'find-duplicates-2'
  | 'remove-passwords'
  | 'find-non-duplicates'
  | 'find-non-duplicates-2'
  | 'split-by-n'
  | 'randomize'
  | 'search-master'
  | 'email-filter'
  | 'csv-email-pass'
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
