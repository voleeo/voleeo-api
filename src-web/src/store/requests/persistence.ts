const LAST_REQUEST_KEY_PREFIX = "voleeo:lastRequest:"
const RECENT_REQUESTS_KEY_PREFIX = "voleeo:recentRequests:"
const MAX_RECENT = 6

function lastRequestStorageKey(workspaceId: string) {
  return `${LAST_REQUEST_KEY_PREFIX}${workspaceId}`
}

function recentRequestsStorageKey(workspaceId: string) {
  return `${RECENT_REQUESTS_KEY_PREFIX}${workspaceId}`
}

export function loadLastRequestId(workspaceId: string): string | null {
  try {
    const raw = localStorage.getItem(lastRequestStorageKey(workspaceId))
    if (raw == null || raw === "") return null
    return raw
  } catch {
    return null
  }
}

export function saveLastRequestId(
  workspaceId: string,
  requestId: string | null,
) {
  try {
    if (requestId == null)
      localStorage.removeItem(lastRequestStorageKey(workspaceId))
    else localStorage.setItem(lastRequestStorageKey(workspaceId), requestId)
  } catch {}
}

export function loadRecentRequestIds(workspaceId: string): string[] {
  try {
    const raw = localStorage.getItem(recentRequestsStorageKey(workspaceId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((v) => typeof v === "string")
      : []
  } catch {
    return []
  }
}

export function saveRecentRequestIds(workspaceId: string, ids: string[]) {
  try {
    localStorage.setItem(
      recentRequestsStorageKey(workspaceId),
      JSON.stringify(ids),
    )
  } catch {}
}

export function pushRecent(current: string[], id: string): string[] {
  const deduped = current.filter((i) => i !== id)
  return [id, ...deduped].slice(0, MAX_RECENT)
}
