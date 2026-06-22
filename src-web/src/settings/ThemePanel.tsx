import type { Theme } from "@voleeo/plugin-api"
import { useShallow } from "zustand/react/shallow"
import { cn } from "@/lib/utils"
import { useThemes } from "@/plugins/hooks"
import { useThemeStore } from "@/store/theme"

export function ThemePanel() {
  const { activeTheme, colorMode, activateTheme, setColorMode } = useThemeStore(
    useShallow((s) => ({
      activeTheme: s.activeTheme,
      colorMode: s.colorMode,
      activateTheme: s.activateTheme,
      setColorMode: s.setColorMode,
    })),
  )
  const allThemes = useThemes()
  const visibleThemes = allThemes.filter((t) => t.kind === colorMode)

  return (
    <section>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-[1.286rem] font-semibold mb-1 text-fg">Theme</h2>
          <p className="text-[0.929rem] text-muted">
            Choose a color scheme for your workspace.
          </p>
        </div>
        <ModeToggle mode={colorMode} onChange={setColorMode} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibleThemes.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            selected={activeTheme?.id === theme.id}
            onSelect={() => activateTheme(theme.id)}
          />
        ))}
        {visibleThemes.length === 0 && (
          <div className="col-span-2 text-center text-[0.929rem] text-muted py-10">
            No {colorMode} themes installed.
          </div>
        )}
      </div>
    </section>
  )
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "dark" | "light"
  onChange: (m: "dark" | "light") => void
}) {
  return (
    <div className="inline-flex shrink-0 border border-border rounded-md overflow-hidden bg-bg shadow-sm">
      {(["dark", "light"] as const).map((m, i) => {
        const active = mode === m
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={cn(
              "px-3.5 h-8 cursor-pointer transition-colors text-[0.857rem] font-medium capitalize outline-none bg-transparent border-0",
              i > 0 && "border-l border-border",
              active
                ? "bg-accent/10 text-accent"
                : "text-muted hover:text-fg hover:bg-subtle",
            )}
          >
            {m}
          </button>
        )
      })}
    </div>
  )
}

function ThemeCard({
  theme,
  selected,
  onSelect,
}: {
  theme: Theme
  selected: boolean
  onSelect: () => void
}) {
  const p = theme.palette
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex flex-col text-left rounded-[13px] overflow-hidden cursor-pointer transition-all duration-150 outline-none bg-transparent p-0",
        selected
          ? "ring-2 ring-accent shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
          : "ring-1 ring-border hover:ring-border/80 hover:-translate-y-0.5",
      )}
    >
      <PaintedScene palette={p} />
      <CardFooter theme={theme} selected={selected} />
    </button>
  )
}

function PaintedScene({ palette }: { palette: Theme["palette"] }) {
  const accents = [
    palette.base08,
    palette.base09,
    palette.base0A,
    palette.base0B,
    palette.base0C,
    palette.base0D,
    palette.base0E,
    palette.base0F,
  ]
  return (
    <div
      className="flex flex-col gap-3 p-4"
      style={{ background: palette.base00 }}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-[30px] h-2 rounded-[4px]"
          style={{ background: palette.base0E }}
        />
        <div
          className="w-[54px] h-2 rounded-[4px]"
          style={{ background: palette.base0D }}
        />
        <div className="flex-1" />
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: palette.base0C }}
        />
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: palette.base08 }}
        />
      </div>

      {/* accent ramp — 8 colors, slightly taller for visual punch */}
      <div className="flex gap-[5px]">
        {accents.map((c, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: palette ramp is fixed-length
            key={i}
            className="flex-1 h-[30px] rounded-[5px]"
            style={{ background: c }}
          />
        ))}
      </div>

      <div className="flex flex-col gap-[5px]">
        <div
          className="h-[6px] w-[70%] rounded-[3px]"
          style={{ background: palette.base0D }}
        />
        <div
          className="h-[6px] w-[52%] rounded-[3px]"
          style={{ background: palette.base0B }}
        />
      </div>
    </div>
  )
}

function CardFooter({ theme, selected }: { theme: Theme; selected: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2.5 px-3.5 py-3 bg-surface">
      <div className="min-w-0">
        <div className="text-[1rem] font-semibold text-fg truncate">
          {theme.name}
        </div>
        <div className="font-mono text-[0.75rem] text-muted mt-0.5 truncate">
          {theme.author}
        </div>
      </div>
      <div
        className={cn(
          "w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 transition-colors border-[1.5px]",
          selected
            ? "bg-accent border-accent text-bg"
            : "border-border text-transparent",
        )}
      >
        {selected && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3.5 8.5l3 3 6-7"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  )
}
