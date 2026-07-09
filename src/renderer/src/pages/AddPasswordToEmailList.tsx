import { useState } from 'react'
import { SingleFileTool } from './SingleFileTool'
import {
  addPasswordToEmailList,
  type CharSets,
  type PasswordMode
} from '../lib/addPasswordToEmailList'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

const CHARSET_LABELS: { key: keyof CharSets; label: string }[] = [
  { key: 'upper', label: 'A-Z' },
  { key: 'lower', label: 'a-z' },
  { key: 'numbers', label: '0-9' },
  { key: 'symbols', label: '!@#' }
]

export function AddPasswordToEmailListPage({ onBack, onSetStatus, active }: Props) {
  const [mode, setMode] = useState<'fixed' | 'random'>('fixed')
  const [password, setPassword] = useState('Password123')
  const [lengthInput, setLengthInput] = useState('12')
  const [charsets, setCharsets] = useState<CharSets>({
    upper: true,
    lower: true,
    numbers: true,
    symbols: true
  })

  // Clamp to a sane range; empty/invalid input falls back to 12.
  const length = Math.max(1, Math.min(128, Math.floor(Number(lengthInput)) || 12))

  const passwordMode: PasswordMode =
    mode === 'fixed'
      ? { kind: 'fixed', password }
      : { kind: 'random', length, sets: charsets }

  // Toggle a character set, but never let the user turn off the last one, an
  // empty alphabet can't generate a password.
  function toggleCharset(key: keyof CharSets) {
    setCharsets((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      if (!next.upper && !next.lower && !next.numbers && !next.symbols) return prev
      return next
    })
  }

  const toolbar = (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
          Password
        </span>
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
          {(
            [
              ['fixed', 'Same for all'],
              ['random', 'Random per email']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`inline-flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium transition ${
                mode === id
                  ? 'bg-accent-soft text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'fixed' ? (
        <label className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
            Password text
          </span>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password123"
            spellCheck={false}
            className="h-10 w-56 rounded-lg border border-border bg-surface-2 px-3 font-mono text-[14px] text-text-primary outline-none transition focus:border-accent"
          />
        </label>
      ) : (
        <>
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
              Length
            </span>
            <input
              type="number"
              min={1}
              max={128}
              value={lengthInput}
              onChange={(e) => setLengthInput(e.target.value)}
              className="h-10 w-24 rounded-lg border border-border bg-surface-2 px-3 font-mono text-[14px] text-text-primary outline-none transition focus:border-accent"
            />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
              Characters
            </span>
            <div className="flex h-10 items-center gap-4">
              {CHARSET_LABELS.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-text-secondary"
                >
                  <input
                    type="checkbox"
                    checked={charsets[key]}
                    onChange={() => toggleCharset(key)}
                    className="h-4 w-4 accent-accent"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )

  return (
    <SingleFileTool
      title="Add Passwords"
      hint="Pick a file of emails (one per line) to append a password to each as email:password."
      taskName="email-password"
      resultLabel="Email:Password"
      resultUnit="pairs"
      emptyResultMessage="No emails to process."
      runLabel="Add Passwords"
      transform={(text) => addPasswordToEmailList(text, passwordMode)}
      toolbar={toolbar}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
