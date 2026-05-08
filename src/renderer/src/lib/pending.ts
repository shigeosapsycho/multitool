// Module-scope handoff for "drop a file on a tool card -> open that tool with the file
// pre-loaded." Survives React re-mounts because it lives outside the component tree.
let pendingFilePath: string | null = null

export function setPendingFile(path: string | null): void {
  pendingFilePath = path
}

export function consumePendingFile(): string | null {
  const p = pendingFilePath
  pendingFilePath = null
  return p
}
