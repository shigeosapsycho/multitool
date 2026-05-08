export type Route =
  | 'tools'
  | 'find-duplicates'
  | 'find-duplicates-2'
  | 'remove-passwords'
  | 'find-non-duplicates'
  | 'find-non-duplicates-2'
  | 'split-evenly'
  | 'split-by-n'
  | 'randomize'
  | 'results'
  | 'settings'

export type ToolMeta = {
  id: Exclude<Route, 'tools' | 'results' | 'settings'>
  title: string
  description: string
  accent: string
}
