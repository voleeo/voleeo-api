import type {
  DnsOverride,
  Workspace,
} from "../../../../../packages/types/bindings"
import { type Field, listField, scalar } from "../engine"
import { authBlob, headerList } from "./shared"

export const workspaceSpecs: Field<Workspace>[] = [
  scalar(
    "name",
    "General",
    (e) => e.name,
    (e, v) => {
      e.name = v
    },
    { label: "Name" },
  ),
  headerList<Workspace>(),
  authBlob<Workspace>(),
  listField<Workspace, DnsOverride>({
    id: "dns",
    group: "DNS Overrides",
    canBoth: true,
    get: (e) => e.dnsOverrides ?? [],
    set: (e, items) => {
      e.dnsOverrides = items
    },
    idOf: (o) => o.id,
    equal: (a, b) =>
      a.hostname === b.hostname &&
      a.address === b.address &&
      a.enabled === b.enabled,
    labelOf: (o) => o.hostname || "(unnamed)",
    valueOf: (o) => `${o.enabled ? "" : "# "}${o.address}`,
  }),
]
