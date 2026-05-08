import { PageHeader } from '../components/PageHeader'

type Props = {
  title: string
  subtitle?: string
  onBack?: () => void
}

export function Placeholder({ title, subtitle, onBack }: Props) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} subtitle={subtitle} onBack={onBack} />
      <div className="px-8 pb-8">
        <div className="rounded-xl border border-dashed border-border bg-surface/50 p-10 text-center">
          <p className="text-[14px] text-text-secondary">
            Coming next. The shell is in place — this page hasn't been built yet.
          </p>
        </div>
      </div>
    </div>
  )
}
