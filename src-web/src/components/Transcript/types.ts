import type {
  WsDirection,
  WsMessageKind,
} from "../../../../packages/types/bindings"

export interface TranscriptMessage {
  id: string
  direction: WsDirection
  data: string
  size: number
  at?: string
  kind?: WsMessageKind | null
}
