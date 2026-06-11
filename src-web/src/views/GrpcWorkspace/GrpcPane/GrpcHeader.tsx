import { useRef } from "react"
import { Glyph } from "@/components/Glyph"
import type { GrpcStatus } from "@/store/grpc"
import { UrlInput } from "@/views/ApiWorkspace/UrlInput"
import type {
  GrpcRpcKind,
  ProtoSource,
} from "../../../../../packages/types/bindings"
import { ServiceMethodPicker } from "./ServiceMethodPicker"
import { TransportSelect } from "./TransportSelect"

interface Props {
  requestId: string
  target: string
  onTargetChange: (v: string) => void
  onTargetCommit: () => void
  onVarClick: (varName: string) => void
  tls: boolean
  onTlsChange: (tls: boolean) => void
  refreshing: boolean
  onRefresh: () => void
  service: string | null
  method: string | null
  onSelectMethod: (service: string, method: string) => void
  protoSource: ProtoSource
  onProtoSourceChange: (next: ProtoSource) => void
  kind: GrpcRpcKind | null
  status: GrpcStatus
  onSend: () => void
  onStart: () => void
  onStreamSend: () => void
  onCloseSend: () => void
  onCancel: () => void
  canSend: boolean
}

// Matches the HTTP/WS URL-bar send button.
const ICON =
  "self-stretch px-2.5 border-l border-border flex items-center justify-center cursor-pointer bg-transparent hover:bg-subtle disabled:opacity-40 disabled:cursor-not-allowed outline-none shrink-0 transition-colors"

export function GrpcHeader(props: Props) {
  const { kind, status } = props
  const barRef = useRef<HTMLDivElement>(null)
  const live = status === "connecting" || status === "streaming"
  const streaming = !!kind && kind !== "unary"
  const writable = kind === "client_streaming" || kind === "bidi"

  // Enter in the URL field fires the primary action for the current state.
  const onPrimary = () => {
    if (!props.canSend) return
    if (!streaming) props.onSend()
    else if (!live) props.onStart()
    else props.onCancel()
  }

  function focusUrlInput() {
    barRef.current?.querySelector<HTMLElement>("[contenteditable]")?.focus()
  }

  return (
    <div className="px-3.5 py-2.5 shrink-0">
      <div
        ref={barRef}
        onClick={(e) => {
          const t = e.target as HTMLElement
          if (!live && !t.closest("[contenteditable]") && !t.closest("button"))
            focusUrlInput()
        }}
        className="group flex items-center border border-border rounded-[5px] bg-surface overflow-hidden cursor-text"
      >
        <TransportSelect
          tls={props.tls}
          disabled={live}
          onChange={props.onTlsChange}
        />
        <UrlInput
          value={props.target}
          disabled={live}
          onChange={props.onTargetChange}
          onCommit={props.onTargetCommit}
          onSend={onPrimary}
          onVarClick={props.onVarClick}
        />
        <ServiceMethodPicker
          requestId={props.requestId}
          service={props.service}
          method={props.method}
          protoSource={props.protoSource}
          onProtoSourceChange={props.onProtoSourceChange}
          disabled={live || !props.target.trim()}
          refreshing={props.refreshing}
          onRefresh={props.onRefresh}
          onSelect={props.onSelectMethod}
        />
        {renderAction(props, { live, streaming, writable, onPrimary })}
      </div>
    </div>
  )
}

function renderAction(
  p: Props,
  s: {
    live: boolean
    streaming: boolean
    writable: boolean
    onPrimary: () => void
  },
) {
  if (!p.kind) return null
  // Idle: the URL-bar send button (paper plane) — Send (unary) / Start (stream).
  if (!s.live) {
    return (
      <button
        type="button"
        className={ICON}
        disabled={!p.canSend}
        onClick={s.onPrimary}
        title={s.streaming ? "Start stream" : "Send"}
        aria-label={s.streaming ? "Start stream" : "Send"}
      >
        <Glyph kind="send-right" size={14} color="var(--base0D)" />
      </button>
    )
  }
  // Live streaming: optional Send/Half-close (client/bidi) + Cancel.
  return (
    <>
      {s.writable && (
        <>
          <button
            type="button"
            className={ICON}
            onClick={p.onStreamSend}
            title="Send message"
            aria-label="Send message"
          >
            <Glyph kind="send-right" size={14} color="var(--base0D)" />
          </button>
          <button
            type="button"
            className={ICON}
            onClick={p.onCloseSend}
            title="Half-close (finish sending, await response)"
            aria-label="Half-close"
          >
            <Glyph kind="checks" size={15} color="var(--base0B)" />
          </button>
        </>
      )}
      <button
        type="button"
        className={ICON}
        onClick={p.onCancel}
        title="Cancel"
        aria-label="Cancel"
      >
        <Glyph kind="x" size={14} color="var(--base08)" />
      </button>
    </>
  )
}
