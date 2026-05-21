/**
 * Trim an absolute output path to its last two segments — e.g.
 * `C:\BeuMultiTool\output\list.txt` becomes `output\list.txt` — so a long
 * path fits on screen. The full path is still used for reveal/open actions.
 */
export function shortOutputPath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.slice(-2).join('\\')
}
