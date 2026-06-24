import { getCurrentWindow } from "@tauri-apps/api/window"

const DOT =
  "w-3.5 h-3.5 rounded-full flex items-center justify-center cursor-pointer border-0 outline-none p-0 opacity-90 hover:opacity-100 transition-opacity"
const GLYPH = "opacity-0 group-hover:opacity-100 transition-opacity"
const STROKE = "rgba(0,0,0,0.55)"

export function WindowControls({
  showMaximize = true,
}: {
  showMaximize?: boolean
}) {
  return (
    <div
      className="group absolute right-0 top-0 bottom-0 flex items-center justify-end gap-3 pr-4"
      style={{ width: "var(--window-controls-width)" }}
      data-tauri-drag-region=""
    >
      {showMaximize && (
        <button
          type="button"
          aria-label="Maximize"
          className={DOT}
          style={{ backgroundColor: "var(--base0B)" }}
          onClick={() => void getCurrentWindow().toggleMaximize()}
        >
          <svg
            className={GLYPH}
            width="8"
            height="8"
            viewBox="0 0 10 10"
            aria-hidden="true"
          >
            <path d="M2 3.2 3.2 2H2zM8 6.8 6.8 8H8z" fill={STROKE} />
          </svg>
        </button>
      )}
      <button
        type="button"
        aria-label="Minimize"
        className={DOT}
        style={{ backgroundColor: "var(--base0A)" }}
        onClick={() => void getCurrentWindow().minimize()}
      >
        <svg
          className={GLYPH}
          width="8"
          height="8"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path
            d="M1.5 5h7"
            stroke={STROKE}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Close"
        className={DOT}
        style={{ backgroundColor: "var(--base08)" }}
        onClick={() => void getCurrentWindow().close()}
      >
        <svg
          className={GLYPH}
          width="8"
          height="8"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path
            d="M1.5 1.5l7 7M8.5 1.5l-7 7"
            stroke={STROKE}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}
