type Props = {
  message: string
}

const UpdateIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
)

export function StatusBar({ message }: Props) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-t border-accent/30 bg-accent-soft px-4 text-[12px] font-medium text-accent">
      <UpdateIcon />
      {message}
    </div>
  )
}
