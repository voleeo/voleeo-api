import type { ReactNode } from "react"
import { useEffect, useRef } from "react"
import { Glyph } from "@/components/Glyph"
import { applyFlowWindowHeight } from "./flowUtils"

interface FlowShellProps {
  icon: string
  title: string
  description: ReactNode
  footer: ReactNode
  children: ReactNode
  wide?: boolean
  autoResizeWindow?: boolean
}

export function FlowShell({
  icon,
  title,
  description,
  footer,
  children,
  wide = false,
  autoResizeWindow = true,
}: FlowShellProps) {
  const shellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Fit the window to the flow's content height on every platform — the window
    // is sized to fit (macOS fixed, Windows/Linux resizable but still fit).
    if (!autoResizeWindow) return
    function measure() {
      const h = shellRef.current?.offsetHeight ?? 0
      if (h > 0) applyFlowWindowHeight(h)
    }

    const observer = new ResizeObserver(measure)
    if (shellRef.current) observer.observe(shellRef.current)
    measure()
    return () => observer.disconnect()
  }, [autoResizeWindow])

  return (
    <div ref={shellRef} className="w-full flex flex-col">
      <div className="flex items-center gap-4 px-8 py-5 border-b border-border">
        <div className="w-[38px] h-[38px] rounded-[8px] border border-border bg-surface grid place-items-center shrink-0">
          <Glyph kind={icon} size={20} color="var(--base05)" />
        </div>
        <div>
          <div className="font-sans font-semibold leading-tight tracking-[-0.2px] text-[1.143rem] text-fg">
            {title}
          </div>
          <div className="font-sans leading-relaxed text-[0.857rem] text-muted mt-0.5">
            {description}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center px-8">
        <div
          className={`w-full ${wide ? "max-w-[820px]" : "max-w-[560px]"} py-6 flex flex-col gap-5`}
        >
          {children}
        </div>
      </div>

      <div className="border-t border-border px-8 py-4 flex items-center">
        {footer}
      </div>
    </div>
  )
}
