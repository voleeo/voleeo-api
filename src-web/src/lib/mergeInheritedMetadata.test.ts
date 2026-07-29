// @ts-expect-error — bun:test lacks TS types in this workspace
import { describe, expect, test } from "bun:test"
import cases from "../../../crates/voleeo-mcp/tests/fixtures/inherited_metadata/cases.json"
import type {
  ApiFolder,
  RequestParameter,
} from "../../../packages/types/bindings"
import { mergeInheritedMetadata } from "./mergeInheritedMetadata"

// Same fixture the Rust send path asserts against
// (crates/voleeo-mcp/tests/inherited_metadata.rs) — a divergence here means a
// copied grpcurl command no longer reproduces the request it came from.

interface Row {
  name: string
  value: string
  enabled: boolean
}

const params = (rows: Row[]): RequestParameter[] =>
  rows.map((r, i) => ({ id: `p${i}`, ...r }))

const folder = (f: { id: string; parentId: string | null; headers: Row[] }) =>
  ({
    id: f.id,
    folderId: f.parentId,
    name: f.id,
    headers: params(f.headers),
  }) as unknown as ApiFolder

describe("mergeInheritedMetadata — Rust parity", () => {
  for (const c of cases) {
    test(c.name, () => {
      const got = mergeInheritedMetadata(
        params(c.own),
        c.folderId,
        c.folders.map(folder),
        params(c.workspaceHeaders),
      ).map((p) => ({ name: p.name, value: p.value }))

      expect(got).toEqual(c.expected)
    })
  }
})
