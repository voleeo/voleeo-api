import type {
  ProtoFieldSchema,
  ProtoFieldType,
  ProtoMessageSchema,
} from "../../../../../packages/types/bindings"

/** A protobuf-JSON value tree the form reads/writes. Objects are messages/maps,
 *  arrays are repeated fields, primitives are scalars/enums. */
export type FormValue = Record<string, unknown>

const SIXTY_FOUR_BIT = new Set([
  "int64",
  "uint64",
  "sint64",
  "fixed64",
  "sfixed64",
])

/** The empty value for one element of `ty` (ignoring repetition). 64-bit ints
 *  are JSON strings per the proto3 JSON spec; bytes are base64 strings. */
export function emptyForType(ty: ProtoFieldType): unknown {
  switch (ty.kind) {
    case "scalar":
      if (ty.name === "bool") return false
      if (ty.name === "string" || ty.name === "bytes") return ""
      if (SIXTY_FOUR_BIT.has(ty.name)) return "0"
      return 0
    case "enum":
      return ty.values[0]?.name ?? 0
    case "message":
      return emptyMessage(ty.schema)
    case "message_ref":
      return {}
    case "map":
      return {}
  }
}

/** The empty value for a whole field (applies repetition/map). */
export function emptyForField(field: ProtoFieldSchema): unknown {
  if (field.repeated) return []
  return emptyForType(field.ty)
}

export function emptyMessage(schema: ProtoMessageSchema): FormValue {
  const out: FormValue = {}
  for (const field of schema.fields) {
    // Skip oneof members — only the chosen one is materialized on demand.
    if (field.oneofGroup) continue
    out[field.name] = emptyForField(field)
  }
  return out
}

/** Parse a stored protobuf-JSON message, falling back to an empty message. */
export function parseMessage(
  json: string,
  schema: ProtoMessageSchema,
): FormValue {
  if (!json.trim()) return emptyMessage(schema)
  try {
    const parsed = JSON.parse(json)
    return typeof parsed === "object" && parsed !== null
      ? (parsed as FormValue)
      : emptyMessage(schema)
  } catch {
    return emptyMessage(schema)
  }
}

/** Immutably set `value[key] = next`, returning a new object. */
export function setKey(
  value: FormValue,
  key: string,
  next: unknown,
): FormValue {
  return { ...value, [key]: next }
}
