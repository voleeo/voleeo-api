// @ts-expect-error — bun:test lacks TS types in this workspace
import { describe, expect, test } from "bun:test"
import { folderSelectionsFor, sameFolderSelections } from "./exportSelection"

describe("export folder selections", () => {
  test("keeps every unique root selected in included workspaces", () => {
    expect(
      folderSelectionsFor(["ws-a"], {
        "ws-a": ["root-a", "root-b", "root-a"],
        "ws-b": ["root-c"],
      }),
    ).toEqual([
      { workspaceId: "ws-a", folderId: "root-a" },
      { workspaceId: "ws-a", folderId: "root-b" },
    ])
  })

  test("treats selection order as equivalent for preview guards", () => {
    expect(
      sameFolderSelections(
        [
          { workspaceId: "ws-a", folderId: "root-a" },
          { workspaceId: "ws-a", folderId: "root-b" },
        ],
        [
          { workspaceId: "ws-a", folderId: "root-b" },
          { workspaceId: "ws-a", folderId: "root-a" },
        ],
      ),
    ).toBe(true)
  })
})
