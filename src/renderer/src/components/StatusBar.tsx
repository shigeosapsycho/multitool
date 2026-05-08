type Props = {
  message: string
}

export function StatusBar({ message }: Props) {
  return (
    <div className="flex h-7 shrink-0 items-center border-t border-border bg-bg px-4 text-[11px] text-text-muted">
      {message}
    </div>
  )
}
