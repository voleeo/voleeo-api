import type { Environment } from "../../../../../packages/types/bindings"
import { type Field, scalar } from "../engine"
import { varList } from "./shared"

export const environmentSpecs: Field<Environment>[] = [
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
      e.color = v
    },
    { label: "Color" },
  ),
  varList<Environment>(),
]
