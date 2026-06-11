import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEnvironmentStore } from "@/store/environment"
import { useGrpcStore } from "@/store/grpc"
import { type GrpcRequest, useRequestStore } from "@/store/requests"
import type {
  AuthConfig,
  ProtoMethodInfo,
  ProtoSource,
  RequestParameter,
} from "../../../../../packages/types/bindings"
import { commands } from "../../../../../packages/types/bindings"
import {
  type DescribeMessage,
  emptyMessage,
  type FormValue,
  parseMessage,
} from "../ProtoMessageForm"

interface SavePayload {
  target: string
  tls: boolean
  protoSource: ProtoSource
  service: string | null
  method: string | null
  metadata: RequestParameter[]
  message: FormValue
  auth: AuthConfig
}

export interface GrpcDraft {
  target: string
  setTarget: (v: string) => void
  tls: boolean
  setTls: (v: boolean) => void
  protoSource: ProtoSource
  setProtoSource: (v: ProtoSource) => void
  service: string | null
  method: string | null
  selectMethod: (service: string, method: string) => void
  clearMethod: () => void
  schema: ProtoMethodInfo | null
  message: FormValue
  setMessage: (v: FormValue) => void
  metadata: RequestParameter[]
  setMetadata: (v: RequestParameter[]) => void
  describeMessage: DescribeMessage
  refreshing: boolean
  commit: () => void
  commitWith: (over: Partial<SavePayload>) => void
  commitConn: (over: Partial<SavePayload>) => void
  refresh: () => void
}

export function useGrpcDraft(
  workspaceId: string,
  request: GrpcRequest,
  authRef: { current: AuthConfig },
): GrpcDraft {
  const id = request.id
  const [tls, setTls] = useState(request.tls ?? false)
  const [protoSource, setProtoSource] = useState<ProtoSource>(
    request.protoSource ?? { kind: "reflection" },
  )
  const [service, setService] = useState<string | null>(request.service ?? null)
  const [method, setMethod] = useState<string | null>(request.method ?? null)
  const [schema, setSchema] = useState<ProtoMethodInfo | null>(null)

  const [targetOverride, setTargetOverride] = useState<string | null>(null)
  const target = targetOverride ?? request.target
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on external target change
  useEffect(() => setTargetOverride(null), [request.target])

  const storeMessage = useMemo(
    () => parseMessage(request.message ?? "", { name: "", fields: [] }),
    [request.message],
  )
  const [messageOverride, setMessageOverride] = useState<FormValue | null>(null)
  const message = messageOverride ?? storeMessage
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on external message change
  useEffect(() => setMessageOverride(null), [request.message])

  const [metadataOverride, setMetadataOverride] = useState<
    RequestParameter[] | null
  >(null)
  const metadata = metadataOverride ?? request.metadata ?? []
  const metaKey = JSON.stringify(request.metadata ?? [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: metaKey is a stable content hash of request.metadata
  useEffect(() => setMetadataOverride(null), [metaKey])

  const setTarget = setTargetOverride
  const setMessage = setMessageOverride
  const setMetadata = setMetadataOverride
  const loadServices = useGrpcStore((s) => s.loadServices)
  const refreshServices = useGrpcStore((s) => s.refreshServices)
  const describeMethod = useGrpcStore((s) => s.describeMethod)
  const refreshing = useGrpcStore((s) => s.refreshing[id] ?? false)
  const blankMessage = useRef(!(request.message ?? "").trim())

  const save = useCallback(
    (over: Partial<SavePayload>): Promise<void> =>
      useRequestStore.getState().updateGrpc(workspaceId, id, {
        target: over.target ?? target,
        tls: over.tls ?? tls,
        protoSource: over.protoSource ?? protoSource,
        // `!== undefined` (not `??`) so an explicit null clears the selection.
        service: over.service !== undefined ? over.service : service,
        method: over.method !== undefined ? over.method : method,
        metadata: over.metadata ?? metadata,
        message: JSON.stringify(over.message ?? message),
        auth: over.auth ?? authRef.current,
      }),
    [
      workspaceId,
      id,
      target,
      tls,
      protoSource,
      service,
      method,
      metadata,
      message,
      authRef,
    ],
  )

  // Discover services once per request (best-effort; errors surface in the store).
  useEffect(() => {
    void loadServices(workspaceId, id)
  }, [workspaceId, id, loadServices])

  // Resolve the selected method's schema; seed an empty message when blank.
  useEffect(() => {
    if (!service || !method) {
      setSchema(null)
      return
    }
    let alive = true
    void describeMethod(workspaceId, id, service, method).then((info) => {
      if (!alive || !info) return
      setSchema(info)
      if (blankMessage.current) {
        blankMessage.current = false
        setMessage(emptyMessage(info.input))
      }
    })
    return () => {
      alive = false
    }
  }, [workspaceId, id, service, method, describeMethod])

  const describeMessage = useCallback<DescribeMessage>(
    async (name) => {
      const envId = useEnvironmentStore.getState().activeEnvId
      const res = await commands.grpcDescribeMessage(
        workspaceId,
        id,
        name,
        envId,
      )
      return res.status === "ok" ? res.data : null
    },
    [workspaceId, id],
  )

  // Rebuild AFTER the save lands on disk so reflection re-reads the new target.
  const commitConn = useCallback(
    (over: Partial<SavePayload>) => {
      void save(over).then(() => refreshServices(workspaceId, id))
    },
    [save, refreshServices, workspaceId, id],
  )

  return {
    target,
    setTarget,
    tls,
    setTls,
    protoSource,
    setProtoSource,
    service,
    method,
    selectMethod: (svc, m) => {
      setService(svc)
      setMethod(m)
      blankMessage.current = true
    },
    clearMethod: () => {
      setService(null)
      setMethod(null)
    },
    schema,
    message,
    setMessage,
    metadata,
    setMetadata,
    describeMessage,
    refreshing,
    commit: () => void save({}),
    commitWith: (over) => void save(over),
    commitConn,
    refresh: () => void refreshServices(workspaceId, id),
  }
}
