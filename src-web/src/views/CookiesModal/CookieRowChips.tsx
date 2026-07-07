import { useMemo } from "react"
import { Glyph } from "@/components/Glyph"
import { tokenize } from "@/lib/template"

export type ChipTone = "neutral" | "secure" | "http" | "scope" | "expired"

export function Chip({
  children,
  icon,
  tone = "neutral",
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  tone?: ChipTone
}) {
  // Tones map to base16 slots so chips track the active theme. Inline `style`
  // is used because the bg/fg pair is a tone-specific mix Tailwind utilities
  // don't expose directly.
  const style =
    tone === "secure"
      ? {
          background: "color-mix(in oklch, var(--base0B) 22%, transparent)",
          color: "var(--base0B)",
          borderColor: "color-mix(in oklch, var(--base0B) 38%, transparent)",
        }
      : tone === "expired"
        ? {
            background: "color-mix(in oklch, var(--base08) 22%, transparent)",
            color: "var(--base08)",
            borderColor: "color-mix(in oklch, var(--base08) 38%, transparent)",
          }
        : tone === "http"
          ? {
              background: "color-mix(in oklch, var(--base0D) 22%, transparent)",
              color: "var(--base0D)",
              borderColor:
                "color-mix(in oklch, var(--base0D) 38%, transparent)",
            }
          : tone === "scope"
            ? {
                background:
                  "color-mix(in oklch, var(--base0C) 22%, transparent)",
                color: "var(--base0C)",
                borderColor:
                  "color-mix(in oklch, var(--base0C) 38%, transparent)",
              }
            : {
                // Translucent neutral so the chip stays readable over both the
                // default surface and the selected row's `bg-accent/10` tint —
                // matches the mixing pattern used by the secure/http chips.
                background:
                  "color-mix(in oklch, var(--base04) 18%, transparent)",
                color: "var(--base05)",
                borderColor:
                  "color-mix(in oklch, var(--base04) 38%, transparent)",
              }
  return (
    <span
      style={style}
      className="inline-flex items-center gap-1 h-[19px] px-[7px] rounded-[5px] border text-[0.714rem] font-medium whitespace-nowrap"
    >
      {icon}
      {children}
    </span>
  )
}

/**
 * Inline renderer for cookie field text that may contain `{{ env_var }}` or
 * `{{ fn() }}` tokens. Plain segments render as-is. Env-var tokens render the
 * resolved value (from the active env) inside a globe-prefixed chip; functions
 * render `fn()` inside a wand-prefixed chip. A missing env var falls back to
 * an error-tinted chip so a stale reference is visible.
 */
export function TemplatedText({
  text,
  vars,
}: {
  text: string
  vars: Map<string, string>
}) {
  const tokens = useMemo(() => tokenize(text), [text])
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.kind === "plain") {
          // biome-ignore lint/suspicious/noArrayIndexKey: token list is stable per `text` and never reordered
          return <span key={i}>{tok.text}</span>
        }
        if (tok.kind === "var") {
          const val = vars.get(tok.name)
          const found = val !== undefined
          const style = found
            ? {
                background:
                  "color-mix(in oklch, var(--base0E) 22%, transparent)",
                color: "var(--base0E)",
              }
            : {
                background:
                  "color-mix(in oklch, var(--base08) 22%, transparent)",
                color: "var(--base08)",
              }
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: tokens are stable across renders
              key={i}
              style={style}
              title={
                found
                  ? `{{ ${tok.name} }} → ${val}`
                  : `{{ ${tok.name} }} — not in active env`
              }
              className="inline-flex items-center px-1.5 py-px rounded-[3px] text-[0.786rem] align-baseline"
            >
              {found ? val : tok.name}
            </span>
          )
        }
        const hasArgs = Object.keys(tok.args).length > 0
        const display = hasArgs ? `${tok.name}(…)` : `${tok.name}()`
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens are stable across renders
            key={i}
            title={`{{ ${display} }}`}
            style={{
              background: "color-mix(in oklch, var(--base0D) 22%, transparent)",
              color: "var(--base0D)",
            }}
            className="inline-flex items-center gap-1 px-1.5 py-px rounded-[3px] text-[0.786rem] align-baseline"
          >
            <Glyph kind="wand" size={10} color="currentColor" />
            {display}
          </span>
        )
      })}
    </>
  )
}
