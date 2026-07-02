import { cn } from "@/lib/utils"

export function ActiveIndicator({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex size-[7px] shrink-0", className)}>
      <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping bg-success" />
      <span className="relative inline-flex size-[7px] rounded-full bg-success" />
    </span>
  )
}
