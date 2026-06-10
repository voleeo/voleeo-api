import type {
  CookieJar,
  StoredCookie,
} from "../../../../../packages/types/bindings"
import { type Field, listField, scalar } from "../engine"

const cookieId = (c: StoredCookie) => `${c.domain}\t${c.path}\t${c.name}`
const cookieEqual = (a: StoredCookie, b: StoredCookie) =>
  a.value === b.value &&
  a.expires === b.expires &&
  a.secure === b.secure &&
  a.httpOnly === b.httpOnly &&
  a.sameSite === b.sameSite &&
  a.hostOnly === b.hostOnly

export const jarSpecs: Field<CookieJar>[] = [
  scalar(
    "name",
    "General",
    (e) => e.name,
    (e, v) => {
      e.name = v
    },
    { label: "Name" },
  ),
  listField<CookieJar, StoredCookie>({
    id: "cookie",
    group: "Value",
    get: (e) => e.cookies ?? [],
    set: (e, items) => {
      e.cookies = items
    },
    idOf: cookieId,
    equal: cookieEqual,
    labelOf: (c) => c.name,
    valueOf: (c) =>
      c.expires ? `${c.value}  ·  expires ${c.expires}` : c.value,
    secretOf: (c) => c.valueEncrypted ?? false,
  }),
]
