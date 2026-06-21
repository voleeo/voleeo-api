import { ancestorChainRootFirst } from "@/lib/folderChain"
import { serialize } from "@/lib/template"
import { useRequestStore } from "@/store/requests"
import {
  rewriteAuth,
  rewriteBody,
} from "../../EnvironmentsModal/VariablesEditor/propagateRename"

/**
 * Rewrite `{{ oldKey }}` → `{{ newKey }}` everywhere a folder variable resolves:
 * the folder itself and every descendant folder (their headers + other variable
 * values) plus every descendant request (url, params, headers). Scoped to
 * descendants because folder vars only resolve there.
 */
export async function propagateFolderVariableRename(
  workspaceId: string,
  folderId: string,
  oldKey: string,
  newKey: string,
) {
  const oldToken = serialize([{ kind: "var", name: oldKey }])
  const newToken = serialize([{ kind: "var", name: newKey }])
  const sub = (s: string) => s.split(oldToken).join(newToken)
  const {
    requests,
    folders,
    updateRequest,
    updateFolder,
    updateFolderVariables,
  } = useRequestStore.getState()

  // The folder itself counts: its own chain (root→self) contains folderId.
  const inScope = (id: string | null | undefined) =>
    ancestorChainRootFirst(id, folders).some((f) => f.id === folderId)

  for (const req of requests) {
    if (req.workspaceId !== workspaceId || !inScope(req.folderId)) continue
    const newUrl = sub(req.url)
    const newParameters = (req.parameters ?? []).map((p) => {
      const next = sub(p.value)
      return next !== p.value ? { ...p, value: next } : p
    })
    const newHeaders = (req.headers ?? []).map((h) => {
      const next = sub(h.value)
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
    const changed =
      newUrl !== req.url ||
      newParameters.some((p, i) => p !== (req.parameters ?? [])[i]) ||
      newHeaders.some((h, i) => h !== (req.headers ?? [])[i]) ||
      authChanged ||
      bodyChanged
    if (changed) {
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

  // The defining folder + descendant folders: headers and other variable values
  // (a folder var can reference a nearer one). The renamed key itself is updated
  // by the Variables editor; here we only touch references in values.
  for (const f of folders) {
    if (f.workspaceId !== workspaceId || !inScope(f.id)) continue
    const newHeaders = (f.headers ?? []).map((h) => {
      const next = sub(h.value)
      return next !== h.value ? { ...h, value: next } : h
    })
    const { auth: newAuth, changed: authChanged } = rewriteAuth(
      f.auth,
      oldToken,
      newToken,
    )
    if (newHeaders.some((h, i) => h !== (f.headers ?? [])[i]) || authChanged) {
      await updateFolder(workspaceId, f.id, newHeaders, newAuth).catch(() => {})
    }
    const newVars = (f.variables ?? []).map((v) => {
      const next = sub(v.value)
      return next !== v.value ? { ...v, value: next } : v
    })
    if (newVars.some((v, i) => v !== (f.variables ?? [])[i])) {
      await updateFolderVariables(workspaceId, f.id, newVars).catch(() => {})
    }
  }
}
