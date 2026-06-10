import { useShallow } from "zustand/react/shallow"
import { useToastStore } from "@/store/toast"

export function Toast() {
  const { message, kind, _clear } = useToastStore(
    useShallow((s) => ({ message: s.message, kind: s.kind, _clear: s._clear })),
  )

  if (!message) return null

  const accent =
    kind === "success"
      ? "var(--base0B)"
      : kind === "error"
        ? "var(--base08)"
        : kind === "warning"
          ? "var(--base0A)"
          : null

  const style = accent
    ? {
        color: accent,
        borderColor: `color-mix(in srgb, ${accent} 50%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${accent} 12%, var(--base01))`,
      }
    : undefined

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-3 px-4 py-2.5 rounded-[6px] shadow-[0_8px_24px_rgba(0,0,0,0.5)] font-sans text-[0.929rem] border"
      style={
        style ?? {
          color: "var(--base05)",
          borderColor: "var(--base03)",
          backgroundColor: "var(--base01)",
        }
      }
      onClick={_clear}
    >
      {message}
    </div>
  )
}
