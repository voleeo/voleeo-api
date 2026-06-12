/** Row id for RequestParameter/BodyField entries — 8 lowercase alphanumerics,
 *  the format the backend stores in YAML. One home; don't reach for UUIDs. */
export function randomId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  return Array.from(
    { length: 8 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("")
}
