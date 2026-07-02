import { Spinner } from "@/components/ui/spinner"

export function ResponseLoading() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-muted">
      <Spinner className="size-5 text-fg" aria-hidden />
      <span className="font-mono text-[0.786rem]">Loading response…</span>
      <span className="text-[0.7rem] text-muted/60">
        Large responses can take a moment
      </span>
    </div>
  )
}
