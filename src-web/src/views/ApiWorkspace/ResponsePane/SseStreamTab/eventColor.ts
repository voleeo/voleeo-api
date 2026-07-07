const MAP: Record<string, string> = {
  message: "var(--base0E)", // keyword / purple
  ping: "var(--base0C)", // info / cyan
  error: "var(--base08)", // error / red
  done: "var(--base0B)", // success / green
}

export function eventColor(event: string | null | undefined): string {
  return MAP[event ?? "message"] ?? "var(--base0D)" // accent fallback
}
