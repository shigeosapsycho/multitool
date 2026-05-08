// Mirror the Python "extract content" behavior:
//   - tab-split if the line contains a tab; otherwise split on the first whitespace
//   - take the trailing field as the content (strips a leading numeric/index column)
export function extractContent(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.includes('\t')) {
      const parts = line.split('\t')
      out.push(parts.length > 1 ? parts[1]! : parts[0]!)
    } else {
      const idx = line.search(/\s/)
      if (idx > -1) {
        out.push(line.slice(idx + 1).trimStart())
      } else {
        out.push(line)
      }
    }
  }
  return out
}

export function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.length > 0)
}

export function basenameNoExt(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}
