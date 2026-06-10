import type { Field } from "../engine"
import type { EntityType } from "../types"
import { connectionSpecs } from "./connection"
import { jarSpecs } from "./cookie"
import { environmentSpecs } from "./environment"
import { folderSpecs } from "./folder"
import { requestSpecs } from "./request"
import { workspaceSpecs } from "./workspace"

export {
  connectionSpecs,
  environmentSpecs,
  folderSpecs,
  jarSpecs,
  requestSpecs,
  workspaceSpecs,
}

// biome-ignore lint/suspicious/noExplicitAny: specs are keyed by entity type; the engine re-narrows per call.
export const SPECS_BY_TYPE: Record<EntityType, Field<any>[]> = {
  request: requestSpecs,
  websocket: connectionSpecs,
  folder: folderSpecs,
  environment: environmentSpecs,
  cookie: jarSpecs,
  workspace: workspaceSpecs,
}
