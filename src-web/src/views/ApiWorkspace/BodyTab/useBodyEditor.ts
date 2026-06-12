import type { RefObject } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { MANAGED_CONTENT_TYPE } from "@/lib/contentTypes"
import { randomId } from "@/lib/ids"
import type {
  BodyField,
  BodyKind,
  HttpRequest,
  RequestBody,
  RequestParameter,
} from "@/store/requests"
import { useRequestStore } from "@/store/requests"
import { useUiStore } from "@/store/workspace"

export type { BodyKind } from "@/store/requests"

const MANAGED_VALUES = new Set(Object.values(MANAGED_CONTENT_TYPE))

/** Build the persisted RequestBody for a given kind + working state. */
function composeBody(
  kind: BodyKind,
  text: string,
  fields: BodyField[],
  filePath: string | null,
  contentType: string | null,
  graphqlVariables: string,
): RequestBody | null {
  switch (kind) {
    case "none":
      return null
    case "form_url_encoded":
    case "multipart":
      return { kind, text: "", fields }
    case "binary":
      return {
        kind,
        text: "",
        filePath: filePath ?? undefined,
        contentType: contentType ?? undefined,
      }
    case "graphql":
      return {
        kind,
        text,
        graphqlVariables: graphqlVariables || undefined,
      }
    default:
      return { kind, text }
  }
}

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

  const stored = request?.body
  const [bodyKind, setBodyKindState] = useState<BodyKind>(
    stored?.kind ?? "none",
  )
  const [bodyText, setBodyTextState] = useState(stored?.text ?? "")
  const [bodyFields, setBodyFieldsState] = useState<BodyField[]>(
    stored?.fields ?? [],
  )
  const [binaryPath, setBinaryPath] = useState<string | null>(
    stored?.filePath ?? null,
  )
  const [binaryContentType, setBinaryContentType] = useState<string | null>(
    stored?.contentType ?? null,
  )
  const [graphqlVariables, setGraphqlVariablesState] = useState(
    stored?.graphqlVariables ?? "",
  )

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = useCallback(
    async (body: RequestBody | null) => {
      if (!activeWorkspaceId || !request) return
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

  // Expose an immediate flush so RequestPane can await it before sending.
  useEffect(() => {
    commitRef.current = async () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      await save(
        composeBody(
          bodyKind,
          bodyText,
          bodyFields,
          binaryPath,
          binaryContentType,
          graphqlVariables,
        ),
      )
    }
  })

  // Reset working state when the active request changes.
  const prevIdRef = useRef(request?.id ?? null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — fires on id change only
  useEffect(() => {
    const id = request?.id ?? null
    if (id === prevIdRef.current) return
    prevIdRef.current = id
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const b = request?.body
    setBodyKindState(b?.kind ?? "none")
    setBodyTextState(b?.text ?? "")
    setBodyFieldsState(b?.fields ?? [])
    setBinaryPath(b?.filePath ?? null)
    setBinaryContentType(b?.contentType ?? null)
    setGraphqlVariablesState(b?.graphqlVariables ?? "")
  }, [request?.id])

  const debouncedSave = useCallback(
    (body: RequestBody | null) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        void save(body)
      }, 400)
    },
    [save],
  )

  const setBodyText = useCallback(
    (text: string) => {
      setBodyTextState(text)
      debouncedSave(
        composeBody(
          bodyKind,
          text,
          bodyFields,
          binaryPath,
          binaryContentType,
          graphqlVariables,
        ),
      )
    },
    [
      bodyKind,
      bodyFields,
      binaryPath,
      binaryContentType,
      graphqlVariables,
      debouncedSave,
    ],
  )

  const setGraphqlVariables = useCallback(
    (variables: string) => {
      setGraphqlVariablesState(variables)
      debouncedSave(
        composeBody(
          bodyKind,
          bodyText,
          bodyFields,
          binaryPath,
          binaryContentType,
          variables,
        ),
      )
    },
    [
      bodyKind,
      bodyText,
      bodyFields,
      binaryPath,
      binaryContentType,
      debouncedSave,
    ],
  )

  const setBodyFields = useCallback(
    (fields: BodyField[]) => {
      setBodyFieldsState(fields)
      debouncedSave(
        composeBody(
          bodyKind,
          bodyText,
          fields,
          binaryPath,
          binaryContentType,
          graphqlVariables,
        ),
      )
    },
    [
      bodyKind,
      bodyText,
      binaryPath,
      binaryContentType,
      graphqlVariables,
      debouncedSave,
    ],
  )

  const setBinary = useCallback(
    (filePath: string | null, contentType?: string | null) => {
      const ct = contentType === undefined ? binaryContentType : contentType
      setBinaryPath(filePath)
      setBinaryContentType(ct)
      debouncedSave(
        composeBody("binary", bodyText, bodyFields, filePath, ct, ""),
      )
    },
    [bodyText, bodyFields, binaryContentType, debouncedSave],
  )

  const setBodyKind = useCallback(
    (kind: BodyKind) => {
      setBodyKindState(kind)
      if (!activeWorkspaceId || !request) return

      // Reconcile the auto-managed Content-Type header.
      const current = request.headers ?? []
      const ct = MANAGED_CONTENT_TYPE[kind]
      const idx = current.findIndex(
        (h) => h.name.toLowerCase() === "content-type",
      )
      let nextHeaders: RequestParameter[]
      if (ct) {
        nextHeaders =
          idx === -1
            ? [
                ...current,
                {
                  id: randomId(),
                  name: "Content-Type",
                  value: ct,
                  enabled: true,
                },
              ]
            : current.map((h, i) => (i === idx ? { ...h, value: ct } : h))
      } else {
        // Drop only headers whose value we previously auto-injected.
        nextHeaders = current.filter(
          (h) =>
            !(
              h.name.toLowerCase() === "content-type" &&
              MANAGED_VALUES.has(h.value)
            ),
        )
      }

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      const body = composeBody(
        kind,
        bodyText,
        bodyFields,
        binaryPath,
        binaryContentType,
        graphqlVariables,
      )
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
    [
      activeWorkspaceId,
      request,
      bodyText,
      bodyFields,
      binaryPath,
      binaryContentType,
      graphqlVariables,
      updateRequest,
    ],
  )

  return {
    bodyKind,
    bodyText,
    bodyFields,
    binaryPath,
    binaryContentType,
    graphqlVariables,
    setBodyKind,
    setBodyText,
    setBodyFields,
    setBinary,
    setGraphqlVariables,
  }
}
