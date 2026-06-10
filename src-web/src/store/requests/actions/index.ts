import { crudActions } from "./crud"
import { loadSelectActions } from "./loadSelect"
import { mutationActions } from "./mutations"
import type { GetState, SetState } from "./shared"

export { DEFAULT_CONNECTION_NAME, DEFAULT_REQUEST_NAME } from "./shared"

export function createActions(set: SetState, get: GetState) {
  return {
    ...loadSelectActions(set, get),
    ...crudActions(set, get),
    ...mutationActions(set, get),
  }
}
