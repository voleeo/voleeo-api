import type { Field } from "../engine"
import type { EntityType } from "../types"
import { connectionSpecs } from "./connection"
import { jarSpecs } from "./cookie"
import { environmentSpecs } from "./environment"
import { folderSpecs } from "./folder"
import { grpcSpecs } from "./grpc"
import { requestSpecs } from "./request"
import { workspaceSpecs } from "./workspace"

export {
  connectionSpecs,
  environmentSpecs,
  folderSpecs,
  grpcSpecs,
  jarSpecs,
  requestSpecs,
  workspaceSpecs,
}

// biome-ignore lint/suspicious/noExplicitAny: specs are keyed by entity type; the engine re-narrows per call.
export const SPECS_BY_TYPE: Record<EntityType, Field<any>[]> = {
  request: requestSpecs,
  websocket: connectionSpecs,
  grpc: grpcSpecs,
  folder: folderSpecs,
  environment: environmentSpecs,
  cookie: jarSpecs,
  workspace: workspaceSpecs,
}
