// Generate a sequential numbered list. For each i in [start, end] inclusive,
// pushes `${prefix} #${i}`; when `duplicate` is set, pushes each entry twice.
// Pure params -> string[], mirroring the multiplyLines style. A start greater
// than end yields an empty array (the loop never runs).
export function generateNumberedList(
  prefix: string,
  start: number,
  end: number,
  duplicate: boolean
): string[] {
  const out: string[] = []
  for (let i = start; i <= end; i++) {
    out.push(`${prefix} #${i}`)
    if (duplicate) out.push(`${prefix} #${i}`)
  }
  return out
}
