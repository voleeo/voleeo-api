import type {
  GrpcRequest,
  RequestParameter,
} from "../../../../../packages/types/bindings"
import { type Field, listField, scalar } from "../engine"
import { paramEqual, paramId, paramValue } from "../helpers"
import { authBlob } from "./shared"

export const grpcSpecs: Field<GrpcRequest>[] = [
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
    "target",
    "URL",
    (e) => e.target,
    (e, v) => {
      e.target = v
    },
    { label: "Target" },
  ),
  scalar(
    "transport",
    "General",
    (e) => (e.tls ? "TLS" : "Plaintext"),
    (e, v) => {
      e.tls = v === "TLS"
    },
    { label: "Transport" },
  ),
  scalar(
    "service",
    "General",
    (e) => e.service ?? "",
    (e, v) => {
      e.service = v || null
    },
    { label: "Service" },
  ),
  scalar(
    "method",
    "General",
    (e) => e.method ?? "",
    (e, v) => {
      e.method = v || null
    },
    { label: "Method" },
  ),
  scalar(
    "message",
    "Message",
    (e) => e.message ?? "",
    (e, v) => {
      e.message = v
    },
    { label: "Message" },
  ),
  listField<GrpcRequest, RequestParameter>({
    id: "metadata",
    group: "Metadata",
    canBoth: true,
    get: (e) => e.metadata ?? [],
    set: (e, items) => {
      e.metadata = items
    },
    idOf: paramId,
    equal: paramEqual,
    labelOf: (p) => p.name,
    valueOf: paramValue,
  }),
  authBlob<GrpcRequest>(),
]
