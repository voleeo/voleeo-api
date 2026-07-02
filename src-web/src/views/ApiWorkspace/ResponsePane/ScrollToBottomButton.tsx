import { Glyph } from "@/components/Glyph"

export function ScrollToBottomButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title="Scroll to newest"
      aria-label="Scroll to newest"
      onClick={onClick}
      className="absolute bottom-3 right-3 z-10 flex size-8 items-center justify-center rounded-[3px] border border-border bg-bg text-muted cursor-pointer transition-colors hover:text-fg hover:border-fg/30"
    >
      <Glyph kind="arrow-down" size={16} color="currentColor" />
    </button>
  )
}
