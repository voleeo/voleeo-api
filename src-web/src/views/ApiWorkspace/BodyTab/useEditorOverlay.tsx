import { useRef } from "react"
import { createPortal } from "react-dom"
import { Autocomplete } from "@/components/TemplateInput/Autocomplete"
import { useActiveVarKeys } from "@/hooks/useActiveVarKeys"
import { useTemplateFunctions } from "@/plugins/hooks"
import { useUiStore } from "@/store/workspace"
import { useBodyOverlay } from "./useBodyOverlay"
import { useFuncChipModal } from "./useFuncChipModal"

export function useEditorOverlay(onChange: (text: string) => void) {
  const varKeys = useActiveVarKeys()
  const fns = useTemplateFunctions()
  const workspaceId = useUiStore((s) => s.activeWorkspaceId)

  const openFuncRef = useRef<
    | ((
        fnName: string,
        args: Record<string, string>,
        from: number,
        to: number,
      ) => void)
    | null
  >(null)
  const overlay = useBodyOverlay(varKeys, fns, (fnName, args, from, to) =>
    openFuncRef.current?.(fnName, args, from, to),
  )
  const funcModal = useFuncChipModal(
    overlay.editorViewRef,
    onChange,
    workspaceId,
  )
  openFuncRef.current = funcModal.openFunc

  return { overlay, funcModal }
}

export function EditorOverlayPortal({
  overlay,
}: {
  overlay: ReturnType<typeof useBodyOverlay>
}) {
  const { overlayState } = overlay
  if (!overlayState.open || !overlayState.anchorRect) return null
  if (overlayState.items.length === 0) return null
  return createPortal(
    <Autocomplete
      items={overlayState.items}
      selectedIndex={overlayState.selectedIndex}
      anchorRect={overlayState.anchorRect}
      query={overlayState.query}
      onSelect={overlay.selectItem}
      onClose={overlay.close}
    />,
    document.body,
  )
}
