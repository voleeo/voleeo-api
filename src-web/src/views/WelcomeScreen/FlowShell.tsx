import type { ReactNode } from "react"
import { useEffect, useRef } from "react"
import { Glyph } from "@/components/Glyph"
import { isMac } from "@/lib/platform"
import { cn } from "@/lib/utils"
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
    // Only macOS auto-fits the fixed launcher window to content; on resizable
    // platforms the flow fills and centres instead (see WelcomeScreen).
    if (!autoResizeWindow || !isMac) return
    function measure() {
      const h = shellRef.current?.offsetHeight ?? 0
      if (h > 0) applyFlowWindowHeight(h)
    }

    const observer = new ResizeObserver(measure)
    if (shellRef.current) observer.observe(shellRef.current)
    measure()
    return () => observer.disconnect()
  }, [autoResizeWindow])

  // macOS auto-fits the window to content height; elsewhere the window is a
  // fixed/resizable size, so the shell fills it (header top, footer bottom, body
  // absorbs the slack) instead of leaving empty space above and below.
  const fill = !isMac

  return (
    <div
      ref={shellRef}
      className={cn("w-full flex flex-col", fill && "h-full")}
    >
      <div className="flex items-center gap-4 px-8 py-5 border-b border-border shrink-0">
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

      <div
        className={cn(
          "flex flex-col items-center px-8",
          fill && "flex-1 min-h-0 overflow-auto",
        )}
      >
        <div
          className={`w-full ${wide ? "max-w-[820px]" : "max-w-[560px]"} py-6 flex flex-col gap-5`}
        >
          {children}
        </div>
      </div>

      <div className="border-t border-border px-8 py-4 flex items-center shrink-0">
        {footer}
      </div>
    </div>
  )
}
