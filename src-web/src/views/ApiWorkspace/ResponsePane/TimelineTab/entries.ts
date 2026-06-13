import type { HttpResponse } from "../../../../../../packages/types/bindings"

export type EntryKind =
  | "info"
  | "send"
  | "recv"
  | "config"
  | "dns"
  | "chunk"
  | "done"
  | "redirect"
  | "error"
  | "resolve"
  | "auth"

export interface Entry {
  elapsedMs: number
  kind: EntryKind
  text: string
}

export function fmtElapsed(ms: number): string {
  if (ms === 0) return "0 ms"
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)} ns`
  if (ms < 1) return `${(ms * 1000).toFixed(2)} µs`
  if (ms < 60_000) return `${ms.toFixed(3)} ms`
  const mins = Math.floor(ms / 60_000)
  const secs = ((ms % 60_000) / 1000).toFixed(0)
  return `${mins}m ${secs}s`
}

function toEntryKind(kind: string): EntryKind {
  switch (kind) {
    case "info":
    case "send":
    case "recv":
    case "config":
    case "dns":
    case "chunk":
    case "done":
    case "redirect":
    case "error":
    case "resolve":
    case "auth":
      return kind
    default:
      return "info"
  }
}

/**
 * Build display entries from the Rust event log. The executor emits an ordered
 * `events` array (config / send / dns / info / recv / chunk / done) with an
 * `atMs` per row, so the frontend just maps each event into an Entry — no
 * timing reconstruction needed.
 */
export function buildEntries(response: HttpResponse): Entry[] {
  return (response.events ?? []).map((e) => ({
    elapsedMs: e.atMs ?? 0,
    kind: toEntryKind(e.kind),
    text: e.text,
  }))
}

export const PREFIX: Record<EntryKind, string> = {
  info: "*",
  send: ">",
  recv: "<",
  config: "⚙",
  dns: "@",
  chunk: "·",
  done: "✓",
  redirect: "↻",
  error: "✗",
  resolve: "≈",
  auth: "⚷",
}

export const TEXT_COLOR: Record<EntryKind, string> = {
  info: "var(--base04)",
  send: "var(--base0C)",
  recv: "var(--base0B)",
  config: "var(--base04)",
  dns: "var(--base0C)",
  chunk: "var(--base04)",
  done: "var(--base0B)",
  redirect: "var(--base0A)",
  error: "var(--base08)",
  resolve: "var(--base04)",
  auth: "var(--base0E)",
}

/**
 * Filter groups for the pill bar. Each pill maps to a set of EntryKinds, so
 * "Sent" collapses {send, config, resolve} into one toggle and "Received"
 * collapses {recv, redirect}. The user usually wants to drill into one phase,
 * not micromanage individual kinds.
 */
export type FilterId = "all" | "sent" | "received" | "body" | "errors"

export const FILTER_GROUPS: Record<FilterId, ReadonlyArray<EntryKind> | "all"> =
  {
    all: "all",
    sent: ["send", "config", "resolve", "dns", "info", "auth"],
    received: ["recv", "redirect"],
    body: ["chunk", "done"],
    errors: ["error"],
  }

export function matchesFilter(kind: EntryKind, filter: FilterId): boolean {
  const group = FILTER_GROUPS[filter]
  return group === "all" || group.includes(kind)
}

/**
 * Gap-indicator thresholds. Below MIN we don't annotate (would be noise from
 * microsecond-level iteration overhead between same-phase rows). Above SLOW we
 * switch to a warning color so slow phases (typically TTFB) pop visually.
 */
export const GAP_MIN_MS = 5
export const GAP_SLOW_MS = 100
