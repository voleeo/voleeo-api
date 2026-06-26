// Tailwind class strings for the Review-changes & History screens (ported from
// the old `.sc-*`/`.hist-*` sheet). Centralized so the six components stay DRY
// and the git-only vars (--mono/--vfs/--ui/--border-strong/--border-faint/--c-*)
// have a single home. Variant bits (selected/kind/del) are composed via `cn`.
export const RV = {
  body: "flex-1 min-h-0 flex",

  // Sidebar
  side: "shrink-0 flex flex-col border-r border-border min-h-0",
  list: "flex-1 min-h-0 overflow-auto pt-2",
  empty: "p-[18px] text-[0.893rem] text-[var(--fg-faint)] text-center",
  group: "mb-2",
  groupH:
    "px-[18px] pt-2 pb-1 text-[0.75rem] font-semibold tracking-[0.05em] uppercase text-muted",
  rowWrap:
    "group relative flex items-center transition-colors hover:bg-surface",
  rowCheck: "ml-4 shrink-0",
  row: "flex-1 min-w-0 flex items-center gap-2.5 py-[7px] border-0 cursor-pointer bg-transparent text-left",
  rowMain: "flex-1 min-w-0 flex flex-col gap-px",
  rowTop: "flex items-center gap-[7px] min-w-0",
  name: "font-[var(--ui)] text-[0.857rem] font-medium text-fg truncate",
  rowDiscard:
    "absolute top-1/2 right-3 -translate-y-1/2 opacity-0 inline-flex items-center p-[3px] border-0 bg-transparent text-muted rounded cursor-pointer transition-all group-hover:opacity-100 hover:text-[var(--c-del)] hover:bg-subtle",

  // Commit box
  commit: "shrink-0 px-4 py-3.5 border-t border-border flex flex-col gap-2",
  commitH: "text-[0.75rem] font-bold tracking-[0.05em] uppercase text-muted",
  msg: "w-full min-h-[54px] resize-none rounded-[9px] border border-border bg-bg text-fg px-[11px] py-[9px] font-[var(--ui)] text-[0.929rem] leading-[1.45] outline-none transition-colors focus:border-accent placeholder:text-muted",
  author: "flex gap-2",
  in: "w-full rounded-lg border border-border bg-bg text-fg px-2.5 py-[7px] font-[var(--ui)] text-[0.893rem] outline-none transition-colors focus:border-accent placeholder:text-muted",

  // Detail pane
  detail: "flex-1 min-w-0 flex flex-col",
  detailHead:
    "shrink-0 flex items-start justify-between gap-3.5 px-[18px] pt-4 pb-3.5 border-b border-border",
  dhMain: "min-w-0 flex flex-col gap-[3px]",
  dhTop: "flex items-center gap-2.5",
  dhName:
    "font-[var(--ui)] text-[1rem] font-semibold text-fg bg-transparent border-0 p-0 cursor-pointer text-left hover:text-accent",
  detailBody: "flex-1 min-h-0 overflow-auto px-[18px] pt-2 pb-10",
  detailEmpty:
    "flex-1 grid place-items-center text-[var(--fg-faint)] text-[0.893rem]",
  methodLg:
    "font-[var(--mono)] text-[0.857rem] font-bold tracking-[0.03em] shrink-0",

  // Field groups + change cards
  fgroup: "pt-5 first:pt-3.5",
  fgroupH: "flex items-center gap-2 mb-[11px]",
  fgroupName:
    "text-[0.821rem] font-bold tracking-[0.07em] uppercase text-muted",
  fgroupN:
    "inline-flex items-center justify-center min-w-[18px] h-[17px] px-[5px] rounded-full bg-subtle text-muted text-[0.75rem] font-bold",
  change:
    "px-[13px] py-[11px] mb-2 rounded-[10px] border border-[var(--border-faint)] bg-[color-mix(in_oklch,var(--surface)_55%,transparent)]",
  changeHead: "flex items-center gap-[9px] mb-2",
  kind: "inline-flex items-center text-[0.71rem] font-bold tracking-[0.04em] uppercase",
  changeCount: "text-[0.72rem] font-semibold text-muted",
  changeLabel: "font-[var(--mono)] text-[0.893rem] font-semibold text-fg",
  changeVals: "flex flex-col gap-3",
  item: "flex flex-col gap-[5px]",
  itemHead: "flex items-center justify-between gap-2 min-h-4",
  itemDiscard:
    "inline-flex items-center p-0.5 border-0 bg-transparent text-muted rounded cursor-pointer transition-all hover:text-[var(--c-del)] hover:bg-subtle",

  // Value rows / chips / swatches
  vrow: "flex items-start gap-[9px] px-[11px] py-[7px] rounded-lg bg-surface",
  vsign:
    "shrink-0 w-[9px] font-[var(--mono)] text-[length:var(--vfs)] font-bold leading-[1.5] text-muted select-none",
  vtext:
    "flex-1 min-w-0 font-[var(--mono)] text-[length:var(--vfs)] leading-[1.5] text-fg whitespace-pre-wrap break-words [&_[data-tpl]]:!cursor-default",
  vtextDel: "line-through opacity-60",
  color: "inline-flex items-center gap-[7px]",
  swatch: "w-3 h-3 rounded-full shrink-0 border border-[var(--border-strong)]",
  inline: "flex items-center gap-2.5 flex-wrap",
  chip: "inline-flex items-center gap-1.5 px-[11px] py-1.5 rounded-lg font-[var(--mono)] text-[length:var(--vfs)] leading-[1.4] text-fg bg-surface [&_[data-tpl]]:!cursor-default",
  chipDel: "line-through opacity-65",
  arrow: "inline-flex text-[var(--fg-faint)] shrink-0",

  // History pane
  histCommits: "shrink-0 min-h-0 overflow-auto flex flex-col",
  histCommit:
    "group w-full flex flex-col gap-[3px] text-left px-4 py-2.5 border-0 border-b border-border bg-transparent cursor-pointer transition-colors hover:bg-surface",
  histCommitSel: "bg-subtle",
  histCommitTop: "flex items-center gap-2",
  histCommitSummary:
    "flex-1 min-w-0 text-[0.857rem] font-medium text-fg truncate",
  histLocal:
    "shrink-0 text-[0.62rem] font-bold tracking-[0.04em] uppercase px-1.5 py-px rounded-full text-[var(--base0A)] bg-[color-mix(in_oklch,var(--base0A)_16%,transparent)]",
  histCommitMeta: "text-[0.72rem] text-muted",
  histSha: "font-[var(--mono)]",
} as const
