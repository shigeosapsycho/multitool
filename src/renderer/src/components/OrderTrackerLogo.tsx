// The Iroth's Order Tracker logo (box-logo.svg from the live site), inlined so
// it works offline and ships in the bundle. Used as the tool's grid icon and
// the hero on its launcher page.
export function OrderTrackerLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#16181d" />
      <rect x="11" y="22" width="42" height="33" rx="6" fill="#E2B377" />
      <path d="M11 28a6 6 0 0 1 6-6h30a6 6 0 0 1 6 6v1H11z" fill="#C9974F" />
      <rect x="29" y="22" width="6" height="33" fill="#CFA262" opacity="0.55" />
      <ellipse cx="25" cy="39" rx="2.6" ry="3.6" fill="#3A2A17" />
      <ellipse cx="39" cy="39" rx="2.6" ry="3.6" fill="#3A2A17" />
      <path d="M25 46q7 6 14 0" stroke="#3A2A17" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <circle cx="20" cy="45" r="2.4" fill="#F2A0A0" opacity="0.7" />
      <circle cx="44" cy="45" r="2.4" fill="#F2A0A0" opacity="0.7" />
    </svg>
  )
}
