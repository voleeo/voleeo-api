import { serialize } from "@/lib/template"
import { useEnvironmentStore } from "@/store/environment"
import { useRequestStore } from "@/store/requests"

/** Rewrite every `oldToken` occurrence in `value` to `newToken`. */
function rewrite(value: string, oldToken: string, newToken: string): string {
  return value.split(oldToken).join(newToken)
}

/**
 * When a variable key is renamed, update every stored `{{ oldKey }}` token to
 * `{{ newKey }}` across all environments in the workspace and across HTTP
 * requests, WebSocket connections, and gRPC requests.
 *
 * Pass `skipEnvId` to exclude the env being actively edited — its local state
 * is handled by VariablesEditor directly, avoiding a race between the debounced
 * Tauri save and this update.
 */
export async function propagateVariableRename(
  workspaceId: string,
  oldKey: string,
  newKey: string,
  skipEnvId: string,
) {
  const oldToken = serialize([{ kind: "var", name: oldKey }])
  const newToken = serialize([{ kind: "var", name: newKey }])

  const { environments, update: updateEnv } = useEnvironmentStore.getState()
  for (const env of environments) {
    if (env.workspaceId !== workspaceId || env.id === skipEnvId) continue
    let changed = false
    const updatedVars = env.variables.map((v) => {
      if (v.encrypted) return v
      const next = v.value.split(oldToken).join(newToken)
      if (next !== v.value) {
        changed = true
        return { ...v, value: next }
      }
      return v
    })
    if (changed) {
      await updateEnv({ ...env, variables: updatedVars }).catch(() => {})
    }
  }

  const { requests, updateRequest } = useRequestStore.getState()
  for (const req of requests) {
    if (req.workspaceId !== workspaceId) continue
    const newUrl = req.url.split(oldToken).join(newToken)
    const newParameters = (req.parameters ?? []).map((p) => {
      const next = p.value.split(oldToken).join(newToken)
      return next !== p.value ? { ...p, value: next } : p
    })
    const newHeaders = (req.headers ?? []).map((h) => {
      const next = h.value.split(oldToken).join(newToken)
      return next !== h.value ? { ...h, value: next } : h
    })
    const urlChanged = newUrl !== req.url
    const paramsChanged = newParameters.some(
      (p, i) => p !== (req.parameters ?? [])[i],
    )
    const headersChanged = newHeaders.some(
      (h, i) => h !== (req.headers ?? [])[i],
    )
    if (urlChanged || paramsChanged || headersChanged) {
      await updateRequest(
        workspaceId,
        req.id,
        req.method,
        newUrl,
        newParameters,
        newHeaders,
      ).catch(() => {})
    }
  }

  const { connections, updateConnection } = useRequestStore.getState()
  for (const conn of connections) {
    if (conn.workspaceId !== workspaceId) continue
    const newUrl = rewrite(conn.url, oldToken, newToken)
    const newParameters = (conn.parameters ?? []).map((p) => {
      const next = rewrite(p.value, oldToken, newToken)
      return next !== p.value ? { ...p, value: next } : p
    })
    const newHeaders = (conn.headers ?? []).map((h) => {
      const next = rewrite(h.value, oldToken, newToken)
      return next !== h.value ? { ...h, value: next } : h
    })
    const changed =
      newUrl !== conn.url ||
      newParameters.some((p, i) => p !== (conn.parameters ?? [])[i]) ||
      newHeaders.some((h, i) => h !== (conn.headers ?? [])[i])
    if (changed) {
      await updateConnection(workspaceId, conn.id, {
        url: newUrl,
        parameters: newParameters,
        headers: newHeaders,
        auth: conn.auth ?? { kind: "none" },
      }).catch(() => {})
    }
  }

  const { grpcRequests, updateGrpc } = useRequestStore.getState()
  for (const g of grpcRequests) {
    if (g.workspaceId !== workspaceId) continue
    const newTarget = rewrite(g.target, oldToken, newToken)
    const newMessage = rewrite(g.message ?? "", oldToken, newToken)
    const newMetadata = (g.metadata ?? []).map((m) => {
      const next = rewrite(m.value, oldToken, newToken)
      return next !== m.value ? { ...m, value: next } : m
    })
    const changed =
      newTarget !== g.target ||
      newMessage !== (g.message ?? "") ||
      newMetadata.some((m, i) => m !== (g.metadata ?? [])[i])
    if (changed) {
      await updateGrpc(workspaceId, g.id, {
        target: newTarget,
        tls: g.tls ?? false,
        protoSource: g.protoSource ?? { kind: "reflection" },
        service: g.service ?? null,
        method: g.method ?? null,
        metadata: newMetadata,
        message: newMessage,
        auth: g.auth ?? { kind: "none" },
      }).catch(() => {})
    }
  }
}
