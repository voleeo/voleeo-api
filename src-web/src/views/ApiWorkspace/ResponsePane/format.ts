/** Byte counts in B / kB / MB. Decimal kB/MB intentionally — easier to read
 *  at-a-glance than KiB/MiB and matches the chrome devtools convention. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Sub-second reads as "847 ms", ≥1 s as "14.13 sec", and once past a minute it
 *  rolls into "8m 41sec" / "2h 5m 30sec" so long-running streams don't show a
 *  wall of milliseconds. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} sec`
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m ${s % 60}sec` : `${m}m ${s % 60}sec`
}
