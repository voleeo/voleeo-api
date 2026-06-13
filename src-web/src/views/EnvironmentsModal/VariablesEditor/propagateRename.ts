import { serialize } from "@/lib/template"
import { useEnvironmentStore } from "@/store/environment"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import type {
  AuthConfig,
  RequestBody,
} from "../../../../../packages/types/bindings"

/** Rewrite every `oldToken` occurrence in `value` to `newToken`. */
function rewrite(value: string, oldToken: string, newToken: string): string {
  return value.split(oldToken).join(newToken)
}

/** Rewrite tokens in every string field of an auth config. Discriminant/enum
 *  strings (`kind`, `signature_method`, …) never match a `{{ token }}`, and
 *  ciphertext secret values don't either, so a blanket string rewrite is safe. */
function rewriteAuth(
  auth: AuthConfig | null | undefined,
  oldToken: string,
  newToken: string,
): { auth: AuthConfig; changed: boolean } {
  const base: AuthConfig = auth ?? { kind: "none" }
  let changed = false
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(base)) {
    if (typeof v === "string" && k !== "kind") {
      const next = rewrite(v, oldToken, newToken)
      if (next !== v) changed = true
      out[k] = next
    } else {
      out[k] = v
    }
  }
  return { auth: changed ? (out as AuthConfig) : base, changed }
}

/** Rewrite tokens in a request body's text, non-file field values, and GraphQL
 *  variables. File paths and content types are left untouched. */
function rewriteBody(
  body: RequestBody | null | undefined,
  oldToken: string,
  newToken: string,
): { body: RequestBody | null; changed: boolean } {
  if (!body) return { body: body ?? null, changed: false }
  let changed = false
  const text = rewrite(body.text ?? "", oldToken, newToken)
  if (text !== (body.text ?? "")) changed = true
  const fields = body.fields?.map((f) => {
    if (f.isFile) return f
    const next = rewrite(f.value, oldToken, newToken)
    if (next !== f.value) changed = true
    return next !== f.value ? { ...f, value: next } : f
  })
  const graphqlVariables =
    body.graphqlVariables != null
      ? rewrite(body.graphqlVariables, oldToken, newToken)
      : body.graphqlVariables
  if (graphqlVariables !== body.graphqlVariables) changed = true
  return changed
    ? { body: { ...body, text, fields, graphqlVariables }, changed }
    : { body, changed }
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
    const { auth: newAuth, changed: authChanged } = rewriteAuth(
      req.auth,
      oldToken,
      newToken,
    )
    const { body: newBody, changed: bodyChanged } = rewriteBody(
      req.body,
      oldToken,
      newToken,
    )
    const urlChanged = newUrl !== req.url
    const paramsChanged = newParameters.some(
      (p, i) => p !== (req.parameters ?? [])[i],
    )
    const headersChanged = newHeaders.some(
      (h, i) => h !== (req.headers ?? [])[i],
    )
    if (
      urlChanged ||
      paramsChanged ||
      headersChanged ||
      authChanged ||
      bodyChanged
    ) {
      await updateRequest(
        workspaceId,
        req.id,
        req.method,
        newUrl,
        newParameters,
        newHeaders,
        newBody,
        newAuth,
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
    const { auth: newAuth, changed: authChanged } = rewriteAuth(
      conn.auth,
      oldToken,
      newToken,
    )
    const changed =
      newUrl !== conn.url ||
      newParameters.some((p, i) => p !== (conn.parameters ?? [])[i]) ||
      newHeaders.some((h, i) => h !== (conn.headers ?? [])[i]) ||
      authChanged
    if (changed) {
      await updateConnection(workspaceId, conn.id, {
        url: newUrl,
        parameters: newParameters,
        headers: newHeaders,
        auth: newAuth,
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
    const { auth: newAuth, changed: authChanged } = rewriteAuth(
      g.auth,
      oldToken,
      newToken,
    )
    const changed =
      newTarget !== g.target ||
      newMessage !== (g.message ?? "") ||
      newMetadata.some((m, i) => m !== (g.metadata ?? [])[i]) ||
      authChanged
    if (changed) {
      await updateGrpc(workspaceId, g.id, {
        target: newTarget,
        tls: g.tls ?? false,
        protoSource: g.protoSource ?? { kind: "reflection" },
        service: g.service ?? null,
        method: g.method ?? null,
        metadata: newMetadata,
        message: newMessage,
        auth: newAuth,
      }).catch(() => {})
    }
  }

  const { folders, updateFolder } = useRequestStore.getState()
  for (const f of folders) {
    if (f.workspaceId !== workspaceId) continue
    const newHeaders = (f.headers ?? []).map((h) => {
      const next = rewrite(h.value, oldToken, newToken)
      return next !== h.value ? { ...h, value: next } : h
    })
    const { auth: newAuth, changed: authChanged } = rewriteAuth(
      f.auth,
      oldToken,
      newToken,
    )
    const headersChanged = newHeaders.some((h, i) => h !== (f.headers ?? [])[i])
    if (headersChanged || authChanged) {
      await updateFolder(workspaceId, f.id, newHeaders, newAuth).catch(() => {})
    }
  }

  const { workspaces, updateWorkspaceAuth } = useUiStore.getState()
  const ws = workspaces.find((w) => w.id === workspaceId)
  if (ws?.auth) {
    const { auth: newAuth, changed } = rewriteAuth(ws.auth, oldToken, newToken)
    if (changed) await updateWorkspaceAuth(workspaceId, newAuth).catch(() => {})
  }
}
