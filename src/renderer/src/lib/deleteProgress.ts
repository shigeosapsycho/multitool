/** Status-banner text while a delete is running. */
export function deleteProgressBanner(permanent: boolean, done: number, total: number): string {
  return permanent
    ? `Permanently deleting ${done.toLocaleString()} of ${total.toLocaleString()}…`
    : `Moving ${done.toLocaleString()} of ${total.toLocaleString()} to Trash…`
}

/** Delete-button label while a delete is running. */
export function deleteProgressButton(done: number, total: number): string {
  return `Deleting ${done.toLocaleString()} of ${total.toLocaleString()}…`
}
