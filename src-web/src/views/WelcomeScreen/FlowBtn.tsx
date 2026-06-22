import type { ReactNode } from "react"

export function FlowBtn({
  children,
  cta = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode
  cta?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "inline-flex items-center gap-2 px-4 py-2 rounded-[6px] font-sans font-medium text-[0.929rem] border transition-colors cursor-pointer outline-none disabled:opacity-40 disabled:cursor-default",
        cta
          ? "bg-[var(--base0D)] border-[var(--base0D)] text-[var(--base00)] enabled:hover:opacity-90"
          : "bg-transparent border-border text-fg enabled:hover:bg-subtle",
      ].join(" ")}
    >
      {children}
    </button>
  )
}
