import { getCurrentWindow } from "@tauri-apps/api/window"
import { cn } from "@/lib/utils"

// Linux window controls, drawn on the right of the custom title bar. macOS uses
// the native overlay traffic lights and Windows keeps its native title bar, so
// this only renders on Linux. The container is a drag region; the buttons opt
// out so clicks land.
const BTN =
  "h-full w-[3.5rem] flex items-center justify-center bg-transparent border-0 outline-none cursor-pointer text-muted hover:text-fg hover:bg-subtle transition-colors"

export function WindowControls() {
  return (
    <div
      className="absolute right-0 top-0 bottom-0 flex items-stretch"
      style={{ width: "var(--window-controls-width)" }}
      data-tauri-drag-region=""
    >
      <button
        type="button"
        aria-label="Minimize"
        className={BTN}
        onClick={() => void getCurrentWindow().minimize()}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <path fill="currentColor" d="M0 5h11v1H0z" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Maximize"
        className={BTN}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 11 11"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <rect x="0.5" y="0.5" width="10" height="10" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Close"
        className={cn(BTN, "hover:bg-error hover:text-fg")}
        onClick={() => void getCurrentWindow().close()}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <path
            fill="currentColor"
            d="M6.279 5.5 11 10.221l-.779.779L5.5 6.279.779 11 0 10.221 4.721 5.5 0 .779.779 0 5.5 4.721 10.221 0 11 .779z"
          />
        </svg>
      </button>
    </div>
  )
}
