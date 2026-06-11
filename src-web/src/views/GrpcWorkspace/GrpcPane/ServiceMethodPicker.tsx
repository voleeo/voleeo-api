import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Glyph } from "@/components/Glyph"
import { useGrpcStore } from "@/store/grpc"
import type { ProtoSource } from "../../../../../packages/types/bindings"
import { MethodMenu } from "./MethodMenu"
import { RPC_KIND } from "./methodKind"

interface Props {
  requestId: string
  service: string | null
  method: string | null
  protoSource: ProtoSource
  onProtoSourceChange: (next: ProtoSource) => void
  disabled?: boolean
  refreshing: boolean
  onRefresh: () => void
  onSelect: (service: string, method: string) => void
}

const TRIGGER =
  "self-stretch flex items-center gap-1.5 px-2.5 border-l border-border cursor-pointer hover:bg-subtle disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent outline-none shrink-0 transition-colors min-w-0 max-w-[45%]"

export function ServiceMethodPicker(props: Props) {
  const { requestId, service, method } = props
  const services = useGrpcStore((s) => s.services[requestId]) ?? []
  const error = useGrpcStore((s) => s.errors[requestId])

  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{
    left: number
    top: number
    width: number
  } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selectedMethod = services
    .find((s) => s.name === service)
    ?.methods.find((m) => m.name === method)
  const kindMeta = selectedMethod ? RPC_KIND[selectedMethod.kind] : null
  const shortService = service ? (service.split(".").pop() ?? service) : null

  const openMenu = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) {
      const width = Math.max(r.width, 450)
      const left = Math.max(8, r.right - width)
      setPos({ left, top: r.bottom + 4, width })
      setOpen(true)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t))
        setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openMenu}
        disabled={props.disabled}
        title="Service & method"
        className={TRIGGER}
      >
        {method ? (
          <>
            <span className="shrink-0 inline-flex">
              <Glyph
                kind={kindMeta?.icon ?? "arrows-left-right"}
                size={14}
                color={kindMeta?.color ?? "var(--base04)"}
              />
            </span>
            <span className="font-mono text-[0.857rem] truncate min-w-0">
              <span className="text-muted">{shortService}/</span>
              <span className="text-fg">{method}</span>
            </span>
            <span className="shrink-0 inline-flex">
              <Glyph kind="chevron" size={11} color="var(--base04)" />
            </span>
          </>
        ) : (
          <span className="inline-flex">
            <Glyph kind="arrows-left-right" size={15} color="var(--base0D)" />
          </span>
        )}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            // Portal events still bubble through the React tree to the URL bar's
            // onClick, which would steal focus back to the target input — contain them.
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
            }}
            className="z-50 rounded-[6px] border border-border bg-surface shadow-xl overflow-hidden"
          >
            <MethodMenu
              services={services}
              service={service}
              method={method}
              protoSource={props.protoSource}
              onProtoSourceChange={props.onProtoSourceChange}
              refreshing={props.refreshing}
              onRefresh={props.onRefresh}
              error={error}
              onSelect={(s, m) => {
                props.onSelect(s, m)
                setOpen(false)
              }}
            />
          </div>,
          document.body,
        )}
    </>
  )
}
