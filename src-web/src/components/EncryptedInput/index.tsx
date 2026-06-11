import {
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { EnableEncryptionDialog } from "@/components/EnableEncryptionDialog"
import { Glyph } from "@/components/Glyph"
import { TemplateInput } from "@/components/TemplateInput"
import { setCaretOffset } from "@/lib/caret"
import { cn } from "@/lib/utils"
import { useEncryptCollapse } from "./useEncryptCollapse"

function MaskedDisplay({ onActivate }: { onActivate: () => void }) {
  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault()
        onActivate()
      }}
      className="absolute inset-0 flex items-center font-mono text-[9px] tracking-[0.12em] text-muted cursor-text select-none bg-surface"
    >
      •••••••••
    </div>
  )
}

function ShieldToggle({
  encrypted,
  onClick,
  disabled,
}: {
  encrypted: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={
        encrypted ? "Encrypted — click to disable" : "Click to encrypt value"
      }
      className={cn(
        "flex items-center justify-center w-5 h-5 shrink-0 rounded-[3px] border-0 outline-none cursor-pointer transition-colors",
        encrypted ? "bg-accent/10" : "bg-transparent hover:bg-subtle",
      )}
    >
      <Glyph
        kind={encrypted ? "shield-slash" : "shield-star"}
        size={12}
        color={encrypted ? "var(--base0D)" : "var(--base04)"}
      />
    </button>
  )
}

export interface EncryptedInputProps {
  value: string
  onChange: (v: string) => void
  onCommit?: () => void
  encrypted: boolean
  onEncryptedChange: (next: boolean) => void
  placeholder?: string
  disabled?: boolean
  /** Password-style field: value is masked when blurred, with an eye toggle to
   *  reveal it regardless of focus. Independent of at-rest encryption. */
  secret?: boolean
  onVarClick?: (varName: string) => void
  excludeVarKeys?: string[]
  className?: string
  ref?: Ref<HTMLDivElement>
  focusOnMount?: boolean
}

/**
 * A `TemplateInput` for sensitive values. A shield toggle marks the field
 * encrypted-at-rest; `secret` makes it password-style (always masked when
 * blurred). Either way the value masks behind nine dots and reveals on focus.
 * Supports `{{ }}` template autocomplete.
 */
export function EncryptedInput({
  value,
  onChange,
  onCommit,
  encrypted,
  onEncryptedChange,
  placeholder,
  disabled,
  secret,
  onVarClick,
  excludeVarKeys,
  className,
  ref,
  focusOnMount,
}: EncryptedInputProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const focusOnMountRef = useRef(focusOnMount)
  const [focused, setFocused] = useState(false)

  const setEditorRef = useCallback(
    (el: HTMLDivElement | null) => {
      editorRef.current = el
      if (typeof ref === "function") ref(el)
      else if (ref) ref.current = el
    },
    [ref],
  )
  const {
    workspaceId,
    dialogOpen,
    handleCommit,
    handleEncryptInsert,
    requestToggle,
    handleEncryptionEnabled,
    handleEncryptionCancelled,
  } = useEncryptCollapse({
    value,
    encrypted,
    onChange,
    onEncryptedChange,
    onCommit,
  })

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const onFocus = () => setFocused(true)
    const onBlur = () => {
      requestAnimationFrame(() => {
        const active = document.activeElement
        if (el === active || el.contains(active)) return
        setFocused(false)
      })
    }
    el.addEventListener("focus", onFocus)
    el.addEventListener("blur", onBlur)
    return () => {
      el.removeEventListener("focus", onFocus)
      el.removeEventListener("blur", onBlur)
    }
  }, [])

  useLayoutEffect(() => {
    if (!focusOnMountRef.current) return
    const el = editorRef.current
    if (!el) return
    el.focus()
    setFocused(true)
    setCaretOffset(el, el.textContent?.length ?? 0)
  }, [])

  const revealAndFocus = useCallback(() => {
    setFocused(true)
    const el = editorRef.current
    if (!el) return
    el.focus()
    setCaretOffset(el, el.textContent?.length ?? 0)
  }, [])

  // Mask while blurred for secret (password-style) or encrypted fields; both
  // reveal on focus.
  const masked = (secret || encrypted) && !focused && value !== ""

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <div className="relative flex-1 min-w-0">
        <TemplateInput
          ref={setEditorRef}
          value={value}
          onChange={onChange}
          onCommit={handleCommit}
          onEncryptInsert={handleEncryptInsert}
          placeholder={placeholder}
          disabled={disabled}
          onVarClick={onVarClick}
          excludeVarKeys={excludeVarKeys}
          className="w-full"
        />
        {masked && <MaskedDisplay onActivate={revealAndFocus} />}
      </div>

      <ShieldToggle
        encrypted={encrypted}
        onClick={requestToggle}
        disabled={disabled}
      />

      {dialogOpen &&
        workspaceId &&
        createPortal(
          <EnableEncryptionDialog
            workspaceId={workspaceId}
            onEnabled={handleEncryptionEnabled}
            onCancel={handleEncryptionCancelled}
          />,
          document.body,
        )}
    </div>
  )
}
