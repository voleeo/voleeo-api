import { connectionCrudActions } from "./crud.connection"
import { folderCrudActions } from "./crud.folder"
import { grpcCrudActions } from "./crud.grpc"
import { requestCrudActions } from "./crud.request"
import type { GetState, SetState } from "./shared"

/** Create / duplicate / rename / delete for requests, folders, connections, gRPC. */
export function crudActions(set: SetState, get: GetState) {
  return {
    ...requestCrudActions(set, get),
    ...folderCrudActions(set, get),
    ...connectionCrudActions(set, get),
    ...grpcCrudActions(set, get),
  }
}
