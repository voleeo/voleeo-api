// @ts-expect-error — bun:test lacks TS types in this workspace
import { describe, expect, test } from "bun:test"
import type { ApiFolder, GitFileChange } from "../../../packages/types/bindings"
import { buildChangeMap, changedPathsUnderFolder } from "./gitChangeMap"

// buildChangeMap only reads `id`/`folderId` off folders.
const folder = (id: string, folderId: string | null = null): ApiFolder =>
  ({ id, folderId }) as unknown as ApiFolder

const deleted = (
  nodeId: string,
  parentId: string,
  kind: "request" | "folder" = "request",
): GitFileChange => ({
  path: kind === "folder" ? `folder_${nodeId}.yaml` : `req_${nodeId}.yaml`,
  nodeId,
  nodeKind: kind === "folder" ? "folder" : "request",
  change: "deleted",
  staged: false,
  parentId,
})

describe("buildChangeMap — deleted node parent fallback", () => {
  test("a deletion under a folder marks that folder changed", () => {
    const maps = buildChangeMap([deleted("r1", "f1")], [], [folder("f1")])
    expect(maps.byNode.f1).toBe("deleted")
    expect(maps.folderDescendantChanged.has("f1")).toBe(true)
  })

  test("changedPathsUnderFolder finds the deleted child's path", () => {
    const paths = changedPathsUnderFolder(
      "f1",
      [deleted("r1", "f1")],
      [],
      [folder("f1")],
    )
    expect(paths).toEqual(["req_r1.yaml"])
  })

  test("nested: deleted subfolder + its child bubble to the surviving ancestor", () => {
    // 'sub' is deleted (not in live folders); only 'top' survives.
    const files = [deleted("sub", "top", "folder"), deleted("r1", "sub")]
    const maps = buildChangeMap(files, [], [folder("top")])
    expect(maps.folderDescendantChanged.has("top")).toBe(true)
    const paths = changedPathsUnderFolder("top", files, [], [folder("top")])
    expect(paths.sort()).toEqual(["folder_sub.yaml", "req_r1.yaml"])
  })
})
