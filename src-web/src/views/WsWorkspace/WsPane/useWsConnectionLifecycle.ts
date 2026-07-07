import { useCallback, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import type { WsConnection } from "@/store/requests"
import { useWebsocketStore } from "@/store/websocket"

/** Owns connect/disconnect/send wiring for the WS pane: a toggle that commits
 *  pending URL/headers/auth edits before connecting, and refs so the
 *  keyboard-shortcut handler and the URL bar's send button always call the
 *  latest closures without re-subscribing on every render. */
export function useWsConnectionLifecycle({
  workspaceId,
  connection,
  status,
  messageDraft,
  urlDraft,
  commitUrl,
  headersCommitRef,
  authCommitRef,
}: {
  workspaceId: string
  connection: WsConnection | null
  status: string
  messageDraft: string
  urlDraft: string
  commitUrl: (url: string) => void
  headersCommitRef: React.RefObject<() => Promise<void>>
  authCommitRef: React.RefObject<() => Promise<void>>
}) {
  const { connect, disconnect, sendMessage } = useWebsocketStore(
    useShallow((s) => ({
      connect: s.connect,
      disconnect: s.disconnect,
      sendMessage: s.sendMessage,
    })),
  )

  const live = status === "open" || status === "connecting"

  const onToggleRef = useRef<() => void>(() => {})
  const sendShortcutRef = useRef<() => void>(() => {})

  const handleUrlSend = useCallback(() => {
    if (!live) onToggleRef.current()
  }, [live])

  function handleSendMessage() {
    if (!connection || status !== "open" || !messageDraft.trim()) return
    void sendMessage(workspaceId, connection.id, "text", messageDraft)
  }

  async function onToggle() {
    if (!connection) return
    if (live) {
      void disconnect(workspaceId, connection.id)
      return
    }

    commitUrl(urlDraft)
    await Promise.all([headersCommitRef.current(), authCommitRef.current()])
    void connect(workspaceId, connection.id)
  }
  onToggleRef.current = () => {
    void onToggle()
  }
  sendShortcutRef.current = () => {
    if (status === "open") handleSendMessage()
    else handleUrlSend()
  }

  const fireSend = useCallback(() => sendShortcutRef.current(), [])

  return { live, handleUrlSend, handleSendMessage, onToggle, fireSend }
}
