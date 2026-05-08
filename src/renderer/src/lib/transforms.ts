import { extractContent } from './parse'
import { findDuplicates, findNonDuplicates } from './dedupe'

export function duplicatesFromText(text: string): string[] {
  return findDuplicates(extractContent(text))
}

export function nonDuplicatesFromText(text: string): string[] {
  return findNonDuplicates(extractContent(text))
}

export function duplicatesFromTwoTexts(t1: string, t2: string): string[] {
  return findDuplicates([...extractContent(t1), ...extractContent(t2)])
}

export function nonDuplicatesFromTwoTexts(t1: string, t2: string): string[] {
  return findNonDuplicates([...extractContent(t1), ...extractContent(t2)])
}

export function stripPasswordsFromText(text: string): string[] {
  const items = extractContent(text)
  const out: string[] = []
  for (const item of items) {
    const colon = item.indexOf(':')
    out.push(colon === -1 ? item : item.slice(0, colon))
  }
  return out
}

export function shuffleLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
  // Fisher-Yates
  for (let i = lines.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[lines[i], lines[j]] = [lines[j]!, lines[i]!]
  }
  return lines
}
