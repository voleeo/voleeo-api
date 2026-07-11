import type { RefObject } from "react"
import { useState } from "react"
import { ensureTrailingTextNode, extractStoredValue } from "@/lib/caret"
import { serialize } from "@/lib/template"
import type { BoundTemplateFunction } from "@/plugins/types"
import { commands } from "../../../../packages/types/bindings"

export interface FuncModalState {
  fnName: string
  initialArgs: Record<string, string>
  oldToken: string
  insertStart: number
  insertEnd: number
}

interface UseFuncModalOptions {
  fns: BoundTemplateFunction[]
  isEncryptionEnabled: boolean
  activeWorkspaceId: string | null
  onEncryptInsert?: (plaintext: string) => void
  buildHtml: (text: string) => string
  onChange: (v: string) => void
  divRef: RefObject<HTMLDivElement | null>
  skipSyncRef: RefObject<boolean>
  insertToken: (
    storedToken: string,
    fromDisplay: number,
    toDisplay: number,
  ) => void
}

export function useFuncModal({
  fns,
  isEncryptionEnabled,
  activeWorkspaceId,
  onEncryptInsert,
  buildHtml,
  onChange,
  divRef,
  skipSyncRef,
  insertToken,
}: UseFuncModalOptions) {
  const [funcModal, setFuncModal] = useState<FuncModalState | null>(null)
  const [showEncryptionDialog, setShowEncryptionDialog] = useState(false)
  const [pendingFuncModal, setPendingFuncModal] = useState<{
    insertStart: number
    insertEnd: number
  } | null>(null)

  /**
   * Called by useAutocomplete when the user selects a function item.
   * Shows the encryption-enable dialog first if workspace encryption is off
   * and the chosen function is `encrypt`.
   */
  function onFuncSelected(
    fn: BoundTemplateFunction,
    insertStart: number,
    insertEnd: number,
  ) {
    if (fn.name === "encrypt" && !isEncryptionEnabled) {
      setPendingFuncModal({ insertStart, insertEnd })
      setShowEncryptionDialog(true)
      return
    }
    setFuncModal({
      fnName: fn.name,
      initialArgs: {},
      oldToken: "",
      insertStart,
      insertEnd,
    })
  }

  /**
   * Called when the user clicks an existing `{{ func() }}` chip.
   * Handles the error-state chip (encryption not enabled) separately.
   * For encrypted values, opens the modal empty and fills in the plaintext
   * asynchronously after decryption so the raw ciphertext never flashes.
   */
  function handleChipClick(target: HTMLElement) {
    const fnName = target.dataset.func
    if (!fnName) return

    if (target.dataset.funcError === "true") {
      setShowEncryptionDialog(true)
      return
    }

    let originalArgs: Record<string, string> = {}
    try {
      originalArgs = target.dataset.args ? JSON.parse(target.dataset.args) : {}
    } catch {}

    const oldToken = serialize([
      { kind: "func", name: fnName, args: originalArgs },
    ])

    let initialArgs = originalArgs
    const encryptedValue = originalArgs.value
    if (encryptedValue?.startsWith("enc:v1:") && activeWorkspaceId) {
      initialArgs = { ...originalArgs, value: "" }
      commands
        .workspaceDecryptValue(activeWorkspaceId, encryptedValue)
        .then((res) => {
          if (res.status === "ok") {
            setFuncModal((prev) =>
              prev
                ? {
                    ...prev,
                    initialArgs: { ...prev.initialArgs, value: res.data },
                  }
                : prev,
            )
          }
        })
    }

    // insertStart/insertEnd are unused for chip-edit path (replaced by oldToken match).
    setFuncModal({
      fnName,
      initialArgs,
      oldToken,
      insertStart: 0,
      insertEnd: 0,
    })
  }

  async function handleFuncModalInsert(args: Record<string, string>) {
    const modal = funcModal
    setFuncModal(null)
    if (!modal) return

    // Row context (VariablesEditor): delegate to the row — it encrypts and
    // switches the row to encrypted mode instead of inserting a chip.
    // onEncryptInsert being present is the discriminator between the two paths;
    // the non-row branch below is intentionally unreachable when it is set.
    if (modal.fnName === "encrypt" && onEncryptInsert) {
      onEncryptInsert(args.value ?? "")
      return
    }

    // Non-row context (TemplateInput in query params, headers, etc.): pre-encrypt
    // the plaintext so the chip stores ciphertext in data-args, never plaintext.
    // onRender sees "enc:v1:..." and returns it directly — no double-encryption.
    // NOTE: this branch and the one above are mutually exclusive (onEncryptInsert
    // present ↔ row context). Do not merge them without preserving that invariant.
    let resolvedArgs = args
    if (modal.fnName === "encrypt" && activeWorkspaceId) {
      const res = await commands.workspaceEncryptValue(
        activeWorkspaceId,
        args.value ?? "",
      )
      if (res.status !== "ok") return
      resolvedArgs = { ...args, value: res.data }
    }

    const token = serialize([
      { kind: "func", name: modal.fnName, args: resolvedArgs },
    ])

    if (modal.oldToken) {
      // Editing an existing chip — locate by string match and replace in-place.
      const el = divRef.current
      if (!el) return
      const stored = extractStoredValue(el)
      const idx = stored.indexOf(modal.oldToken)
      const newStored =
        idx === -1
          ? stored + token
          : stored.slice(0, idx) +
            token +
            stored.slice(idx + modal.oldToken.length)
      el.innerHTML = buildHtml(newStored)
      ensureTrailingTextNode(el)
      skipSyncRef.current = true
      onChange(newStored)
      return
    }

    // Fresh insertion — use positions captured when the modal was opened so the
    // partial expression typed by the user is fully replaced.
    insertToken(token, modal.insertStart, modal.insertEnd)
  }

  function onEncryptionEnabled() {
    setShowEncryptionDialog(false)
    const pending = pendingFuncModal
    setPendingFuncModal(null)
    if (!pending) return
    const encryptFn = fns.find((f) => f.name === "encrypt")
    if (encryptFn) {
      setFuncModal({
        fnName: "encrypt",
        initialArgs: {},
        oldToken: "",
        insertStart: pending.insertStart,
        insertEnd: pending.insertEnd,
      })
    }
  }

  function onEncryptionCancelled() {
    setShowEncryptionDialog(false)
    setPendingFuncModal(null)
  }

  return {
    funcModal,
    setFuncModal,
    showEncryptionDialog,
    onFuncSelected,
    handleChipClick,
    handleFuncModalInsert,
    onEncryptionEnabled,
    onEncryptionCancelled,
  }
}
