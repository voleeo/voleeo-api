// The design mocks use neutral CSS vars (--bg/--surface/--accent/--ok…). This
// bridges them onto the active base16 palette so the git screens re-theme with
// the rest of the app. Both screens wrap their content in `.git-root`.
export function GitVars() {
  return (
    <style>{`
  .git-root {
    --bg: var(--base00); --bg-2: var(--base01);
    --surface: var(--base01); --surface-2: var(--base02);
    --border: var(--base02); --border-strong: var(--base03); --border-faint: var(--base01);
    --fg: var(--base05); --fg-muted: var(--base04); --fg-faint: var(--base03);
    --accent: var(--base0D); --ok: var(--base0B);
    --c-add: var(--base0B); --c-del: var(--base08); --c-chg: var(--base0A);
    --c-yours: var(--base0C); --c-theirs: var(--base0D);
    --mono: var(--editor-font-family, var(--mono-font, 'Geist Mono', ui-monospace, monospace));
    --ui: var(--interface-font, Inter, system-ui, sans-serif);
    --vfs: var(--editor-font-size, 12.5px);
    display: flex; flex-direction: column; height: 100%;
    background: var(--bg); color: var(--fg); font-family: var(--ui);
    /* Divider under the native title bar (the old toolbar used to provide it). */
    border-top: 1px solid var(--border);
  }
  `}</style>
  )
}
