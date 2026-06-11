import { useShallow } from "zustand/react/shallow"
import { SHORTCUTS } from "@/config/shortcuts"
import { useKeydown } from "@/hooks/useKeydown"
import { resolveTemplate } from "@/lib/template"
import { useTemplateFunctions } from "@/plugins/hooks"
import { useGrpcStore } from "@/store/grpc"
import type { useGrpcDraft } from "./useGrpcDraft"

type Draft = ReturnType<typeof useGrpcDraft>

/** Send/stream actions plus the ⌘/Ctrl-Enter shortcut for the active request. */
export function useGrpcSend(
  workspaceId: string,
  requestId: string,
  draft: Draft,
) {
  const status = useGrpcStore((s) => s.status[requestId]) ?? "idle"
  const grpc = useGrpcStore(
    useShallow((s) => ({
      call: s.call,
      startStream: s.startStream,
      sendStreamMessage: s.sendStreamMessage,
      closeSend: s.closeSend,
      cancelStream: s.cancelStream,
    })),
  )
  const kind = draft.schema?.kind ?? null
  const canSend = !!(
    draft.schema &&
    draft.service &&
    draft.method &&
    draft.target
  )

  const fns = useTemplateFunctions()
  const resolvedPayload = () =>
    resolveTemplate(JSON.stringify(draft.message), [], fns)

  const handlers = {
    onSend: async () => {
      draft.commit()
      void grpc.call(workspaceId, requestId, await resolvedPayload())
    },
    onStart: async () => {
      draft.commit()
      void grpc.startStream(workspaceId, requestId, await resolvedPayload())
    },
    onStreamSend: async () =>
      void grpc.sendStreamMessage(
        workspaceId,
        requestId,
        await resolvedPayload(),
      ),
    onCloseSend: () => void grpc.closeSend(requestId),
    onCancel: () => void grpc.cancelStream(workspaceId, requestId),
  }

  const live = status === "connecting" || status === "streaming"
  const onSendShortcut = () => {
    if (!canSend || live) return
    if (kind && kind !== "unary") handlers.onStart()
    else handlers.onSend()
  }
  useKeydown(SHORTCUTS.SEND_REQUEST, onSendShortcut)
  useKeydown(SHORTCUTS.SEND_REQUEST_CTRL, onSendShortcut)

  return { status, kind, canSend, handlers, onSendShortcut }
}
