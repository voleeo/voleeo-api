import { formatKeyCombo, SHORTCUT_HELP } from "@/config/shortcuts"

export function KeyboardPanel() {
  return (
    <section>
      <h2 className="text-[1.286rem] font-semibold mb-1 text-fg">
        Keyboard Shortcuts
      </h2>
      <p className="text-[0.929rem] text-muted mb-6">
        Quick reference for all available shortcuts.
      </p>

      <div className="border border-border rounded-md overflow-hidden">
        {SHORTCUT_HELP.map((s, i) => (
          <div
            key={s.description}
            className={
              "flex items-center justify-between gap-4 px-3 py-2.5 bg-bg" +
              (i > 0 ? " border-t border-border" : "")
            }
          >
            <span className="text-[0.929rem] text-fg">{s.description}</span>
            <kbd className="shrink-0 font-mono text-[0.786rem] tracking-[0.2em] px-2 py-0.5 rounded-[4px] border border-border bg-surface text-muted">
              {formatKeyCombo(s.combo)}
            </kbd>
          </div>
        ))}
      </div>
    </section>
  )
}
