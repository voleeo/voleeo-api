import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { SectionLabel } from "./parts"

export function ProtocolsSection({
  grpcCount,
  wsCount,
  exportProto,
  exportAsyncapi,
  setExportProto,
  setExportAsyncapi,
}: {
  grpcCount: number
  wsCount: number
  exportProto: boolean
  exportAsyncapi: boolean
  setExportProto: (v: boolean) => void
  setExportAsyncapi: (v: boolean) => void
}) {
  return (
    <div>
      <SectionLabel>Protocols</SectionLabel>
      <div className="overflow-hidden rounded-xl border border-border bg-bg/40">
        {grpcCount > 0 && (
          <div
            onClick={() => setExportProto(!exportProto)}
            className={cn(
              "flex cursor-pointer items-center gap-4 p-4",
              wsCount > 0 && "border-b border-border",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm text-fg">Export gRPC as .proto</div>
              <div className="mt-0.5 text-[12.5px] leading-snug text-muted">
                {grpcCount} gRPC request{grpcCount === 1 ? "" : "s"} exported as
                their .proto file(s) next to the collection. Turn off to skip
                gRPC.
              </div>
            </div>
            <span onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={exportProto}
                onCheckedChange={setExportProto}
                size="sm"
              />
            </span>
          </div>
        )}
        {wsCount > 0 && (
          <div
            onClick={() => setExportAsyncapi(!exportAsyncapi)}
            className="flex cursor-pointer items-center gap-4 p-4"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm text-fg">
                Export WebSocket as AsyncAPI
              </div>
              <div className="mt-0.5 text-[12.5px] leading-snug text-muted">
                {wsCount} WebSocket connection{wsCount === 1 ? "" : "s"}{" "}
                exported as an AsyncAPI document. Turn off to skip WebSocket.
              </div>
            </div>
            <span onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={exportAsyncapi}
                onCheckedChange={setExportAsyncapi}
                size="sm"
              />
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
