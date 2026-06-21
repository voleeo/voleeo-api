import { createPortal } from "react-dom"
import { useUiStore } from "@/store/workspace"
import { ImportRequestsFlow } from "@/views/WelcomeScreen/import/ImportRequestsFlow"

interface Props {
  onClose: () => void
}

export function ImportRequestsModal({ onClose }: Props) {
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId)

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/50 border-0 cursor-default"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      />
      <div className="relative w-[880px] max-w-[92vw] max-h-[88vh] overflow-y-auto rounded-[12px] border border-border bg-bg shadow-2xl">
        <ImportRequestsFlow
          embedded
          defaultDestId={activeWorkspaceId ?? "new"}
          onCancel={onClose}
        />
      </div>
    </div>,
    document.body,
  )
}
