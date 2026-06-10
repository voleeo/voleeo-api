import type {
  GitEntity,
  GitEntityConflict,
} from "../../../../packages/types/bindings"
import { buildConflicts } from "./engine"
import { type FolderRef, innerOf, locationOf, wrap } from "./entity"
import { mergeEntity } from "./merge"
import { SPECS_BY_TYPE } from "./specs"
import { type Choice, type ConflictEntity, nodeKindToType } from "./types"

export function buildConflictEntities(
  conflicts: GitEntityConflict[],
  folders: FolderRef[] = [],
): ConflictEntity[] {
  const fmap = new Map(folders.map((f) => [f.id, f.name]))
  const out: ConflictEntity[] = []
  for (const c of conflicts) {
    const type = nodeKindToType(c.nodeKind)
    if (!type) continue
    const oursInner = innerOf(c.ours, type)
    const theirsInner = innerOf(c.theirs, type)
    const baseInner = innerOf(c.base, type)
    const ref = oursInner ?? theirsInner
    if (!ref) continue
    const wholeEntity = !oursInner || !theirsInner
    const fields = wholeEntity
      ? [
          {
            id: "__entity",
            group: "General" as const,
            label: "This item",
            yours: oursInner ? "Keep your version" : "Deleted on your side",
            theirs: theirsInner
              ? "Keep their version"
              : "Deleted on their side",
          },
        ]
      : buildConflicts(SPECS_BY_TYPE[type], baseInner, oursInner, theirsInner)
    out.push({
      path: c.path,
      nodeId: c.nodeId,
      type,
      method: type === "request" ? ref.method : undefined,
      name: ref.name ?? "(unnamed)",
      location: locationOf(type, ref, fmap),
      conflicts: fields,
      wholeEntity,
      base: c.base,
      ours: c.ours,
      theirs: c.theirs,
    })
  }
  return out
}

/** Assemble the merged entity to write back, given the user's per-field picks.
 * Returns `null` when the choice is to accept a deletion (delete/modify
 * conflict where the kept side removed the entity) — the caller deletes it. */
export function mergeChoice(
  entity: ConflictEntity,
  choice: Record<string, Choice>,
): GitEntity | null {
  const { type } = entity
  const oursInner = innerOf(entity.ours, type)
  const theirsInner = innerOf(entity.theirs, type)
  if (entity.wholeEntity) {
    const keepTheirs = choice.__entity === "theirs"
    // Pick the chosen side strictly: if it's the deleted side, signal deletion
    // (no ??-fallback — that's what silently resurrected deleted entities).
    const inner = keepTheirs ? theirsInner : oursInner
    return inner ? wrap(type, inner) : null
  }
  const merged = mergeEntity(
    SPECS_BY_TYPE[type],
    innerOf(entity.base, type),
    oursInner,
    theirsInner,
    choice,
  )
  return wrap(type, merged)
}
