import type { ApiFolder } from "../../../../../packages/types/bindings"
import { type Field, scalar } from "../engine"
import { authBlob, headerList, varList } from "./shared"

export const folderSpecs: Field<ApiFolder>[] = [
  scalar(
    "name",
    "General",
    (e) => e.name,
    (e, v) => {
      e.name = v
    },
    { label: "Name" },
  ),
  scalar(
    "color",
    "General",
    (e) => e.color ?? "",
    (e, v) => {
      e.color = v || null
    },
    { label: "Color" },
  ),
  headerList<ApiFolder>(),
  varList<ApiFolder>(),
  authBlob<ApiFolder>(),
]
