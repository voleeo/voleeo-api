import type {
  RequestParameter,
  WsConnection,
} from "../../../../../packages/types/bindings"
import { type Field, listField, scalar } from "../engine"
import { paramEqual, paramId, paramValue } from "../helpers"
import { authBlob, headerList } from "./shared"

export const connectionSpecs: Field<WsConnection>[] = [
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
    "url",
    "URL",
    (e) => e.url,
    (e, v) => {
      e.url = v
    },
  ),
  listField<WsConnection, RequestParameter>({
    id: "param",
    group: "Query Parameters",
    canBoth: true,
    get: (e) => e.parameters ?? [],
    set: (e, items) => {
      e.parameters = items
    },
    idOf: paramId,
    equal: paramEqual,
    labelOf: (p) => p.name,
    valueOf: paramValue,
  }),
  headerList<WsConnection>(),
  authBlob<WsConnection>(),
]
