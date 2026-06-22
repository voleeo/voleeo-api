import type { RefObject } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import type {
  BodyField,
  BodyKind,
  HttpRequest,
  RequestBody,
} from "@/store/requests"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"
import {
  type BodyWorking,
  bodySig,
  composeBody,
  reconcileContentTypeHeader,
  workingFromBody,
} from "./bodyCompose"

export type { BodyKind } from "@/store/requests"

export interface UseBodyEditorResult {
  bodyKind: BodyKind
  bodyText: string
  bodyFields: BodyField[]
  binaryPath: string | null
  binaryContentType: string | null
  graphqlVariables: string
  setBodyKind: (kind: BodyKind) => void
  setBodyText: (text: string) => void
  setBodyFields: (fields: BodyField[]) => void
  setBinary: (filePath: string | null, contentType?: string | null) => void
  setGraphqlVariables: (variables: string) => void
}

export function useBodyEditor(
  request: HttpRequest | null,
  commitRef: RefObject<() => Promise<void>>,
): UseBodyEditorResult {
  const updateRequest = useRequestStore((s) => s.updateRequest)
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId)

  const [working, setWorking] = useState<BodyWorking>(() =>
    workingFromBody(request?.body),
  )
  const workingRef = useRef(working)
  workingRef.current = working

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const writtenSigRef = useRef(bodySig(request?.body))

  const cancelPendingSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  const save = useCallback(
    async (body: RequestBody | null) => {
      if (!activeWorkspaceId || !request) return
      writtenSigRef.current = bodySig(body)
      await updateRequest(
        activeWorkspaceId,
        request.id,
        request.method,
        request.url,
        request.parameters ?? [],
        request.headers ?? [],
        body,
      )
    },
    [activeWorkspaceId, request, updateRequest],
  )

  const debouncedSave = useCallback(
    (body: RequestBody | null) => {
      cancelPendingSave()
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        void save(body)
      }, 400)
    },
    [save, cancelPendingSave],
  )

  // Expose an immediate flush so RequestPane can await it before sending.
  useEffect(() => {
    commitRef.current = async () => {
      cancelPendingSave()
      await save(composeBody(workingRef.current))
    }
  })

  const prevIdRef = useRef(request?.id ?? null)
  useEffect(() => {
    const b = request?.body
    const idChanged = (request?.id ?? null) !== prevIdRef.current
    const sig = bodySig(b)
    if (!idChanged && sig === writtenSigRef.current) return
    prevIdRef.current = request?.id ?? null
    cancelPendingSave()
    writtenSigRef.current = sig
    const next = workingFromBody(b)
    workingRef.current = next
    setWorking(next)
  }, [request?.id, request?.body, cancelPendingSave])

  const patch = useCallback(
    (p: Partial<BodyWorking>) => {
      const next = { ...workingRef.current, ...p }
      workingRef.current = next
      setWorking(next)
      debouncedSave(composeBody(next))
    },
    [debouncedSave],
  )

  const setBodyText = useCallback((text: string) => patch({ text }), [patch])
  const setGraphqlVariables = useCallback(
    (graphqlVariables: string) => patch({ graphqlVariables }),
    [patch],
  )
  const setBodyFields = useCallback(
    (fields: BodyField[]) => patch({ fields }),
    [patch],
  )
  const setBinary = useCallback(
    (filePath: string | null, contentType?: string | null) =>
      patch({
        kind: "binary",
        filePath,
        contentType:
          contentType === undefined
            ? workingRef.current.contentType
            : contentType,
      }),
    [patch],
  )

  const setBodyKind = useCallback(
    (kind: BodyKind) => {
      const next = { ...workingRef.current, kind }
      workingRef.current = next
      setWorking(next)
      if (!activeWorkspaceId || !request) return

      cancelPendingSave()
      const nextHeaders = reconcileContentTypeHeader(
        request.headers ?? [],
        kind,
      )
      const body = composeBody(next)
      writtenSigRef.current = bodySig(body)
      // GraphQL over HTTP is sent as POST (our only GraphQL send path), so the
      // method is forced and the picker locks while this body kind is active.
      const nextMethod = kind === "graphql" ? "POST" : request.method
      void updateRequest(
        activeWorkspaceId,
        request.id,
        nextMethod,
        request.url,
        request.parameters ?? [],
        nextHeaders,
        body,
      )
    },
    [activeWorkspaceId, request, updateRequest, cancelPendingSave],
  )

  return {
    bodyKind: working.kind,
    bodyText: working.text,
    bodyFields: working.fields,
    binaryPath: working.filePath,
    binaryContentType: working.contentType,
    graphqlVariables: working.graphqlVariables,
    setBodyKind,
    setBodyText,
    setBodyFields,
    setBinary,
    setGraphqlVariables,
  }
}
