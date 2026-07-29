import { ancestorChainRootFirst } from "@/lib/folderChain"
import type {
  ApiFolder,
  RequestParameter,
} from "../../../packages/types/bindings"

/** Own → nearest folder → root → workspace; first name wins (case-insensitive).
 *  Mirrors Rust `merge_inherited_metadata`; the two are pinned together by
 *  `crates/voleeo-mcp/tests/fixtures/inherited_metadata/cases.json`. */
export function mergeInheritedMetadata(
  own: RequestParameter[],
  folderId: string | null | undefined,
  folders: ApiFolder[],
  workspaceHeaders: RequestParameter[],
): RequestParameter[] {
  const out: RequestParameter[] = []
  const seen = new Set<string>()
  const add = (rows?: RequestParameter[]) => {
    for (const r of rows ?? []) {
      if (!r.enabled || !r.name.trim()) continue
      const key = r.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(r)
    }
  }
  add(own)
  const chain = ancestorChainRootFirst(folderId ?? null, folders)
  for (let i = chain.length - 1; i >= 0; i--) add(chain[i].headers)
  add(workspaceHeaders)
  return out
}
