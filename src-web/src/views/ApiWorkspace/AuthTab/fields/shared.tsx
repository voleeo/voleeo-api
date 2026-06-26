import type { ReactNode } from "react"
import { EncryptedInput } from "@/components/EncryptedInput"
import { Glyph } from "@/components/Glyph"
import { TemplateInput } from "@/components/TemplateInput"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { AuthConfig } from "@/store/requests"
import type { SetAuth } from "../useAuthEditor"

// Hoisted to a shared, domain-agnostic component; re-exported so the AuthTab
// field modules keep their `./shared` import.
export { Segmented } from "@/components/Segmented"

export function LabeledDropdown<T extends string>({
  label,
  value,
  options,
  mono,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  mono?: boolean
  onChange: (next: T) => void
}) {
  const active = options.find((o) => o.value === value)?.label ?? value
  const textCls = mono
    ? "font-mono text-[0.786rem]"
    : "font-sans text-[0.857rem]"
  return (
    <div className="flex items-center gap-3">
      <span className="font-sans text-[0.857rem] text-muted shrink-0">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex items-center gap-1 rounded-[5px] border border-border bg-bg px-2.5 py-1 text-fg cursor-pointer outline-none hover:border-accent/50 transition-colors",
            textCls,
          )}
        >
          {active}
          <Glyph kind="chevron-down" size={11} color="currentColor" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[150px]">
          {options.map((o) => (
            <DropdownMenuItem
              key={o.value}
              className={cn(
                "focus:bg-subtle focus:text-fg cursor-pointer grid grid-cols-[1fr_16px] items-center gap-2",
                textCls,
              )}
              onClick={() => onChange(o.value)}
            >
              <span>{o.label}</span>
              <span className="flex items-center justify-center">
                {value === o.value && (
                  <Glyph kind="check" size={11} color="var(--base04)" />
                )}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export interface FieldsProps<K extends AuthConfig["kind"]> {
  auth: Extract<AuthConfig, { kind: K }>
  setAuth: SetAuth
  onVarClick: (varName: string) => void
}

export function FieldShell({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[0.714rem] uppercase tracking-wide text-muted">
        {label}
      </span>
      <div className="border border-border rounded-[4px] bg-surface px-1.5 py-1 focus-within:border-accent transition-colors">
        {children}
      </div>
    </div>
  )
}

export function PlainField({
  label,
  value,
  placeholder,
  onChange,
  onVarClick,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (v: string) => void
  onVarClick: (varName: string) => void
}) {
  return (
    <FieldShell label={label}>
      <TemplateInput
        value={value}
        onChange={onChange}
        onVarClick={onVarClick}
        placeholder={placeholder}
        className="w-full"
      />
    </FieldShell>
  )
}

export function SecretField({
  label,
  value,
  placeholder,
  encrypted,
  onChange,
  onEncryptedChange,
  onVarClick,
}: {
  label: string
  value: string
  placeholder: string
  encrypted: boolean
  onChange: (v: string) => void
  onEncryptedChange: (next: boolean) => void
  onVarClick: (varName: string) => void
}) {
  return (
    <FieldShell label={label}>
      <EncryptedInput
        value={value}
        onChange={onChange}
        encrypted={encrypted}
        onEncryptedChange={onEncryptedChange}
        onVarClick={onVarClick}
        placeholder={placeholder}
        secret
      />
    </FieldShell>
  )
}

export function HelpText({ children }: { children: ReactNode }) {
  return (
    <span className="font-sans text-[0.786rem] text-muted leading-snug">
      {children}
    </span>
  )
}

export function WarningBlock({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-warn/30 bg-warn/10 px-2.5 py-1.5 font-sans text-[0.786rem] text-warn leading-snug",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function AuthToggleButton({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      title={
        enabled
          ? "Auth enabled — click to disable"
          : "Auth disabled — click to enable"
      }
      onClick={() => onChange(!enabled)}
      className={cn(
        "absolute top-0 right-0 z-10 p-1 rounded-[3px] border bg-transparent cursor-pointer transition-colors",
        enabled
          ? "border-border text-muted hover:text-success hover:border-success/70"
          : "border-error/40 text-error hover:border-error/70",
      )}
    >
      <Glyph
        kind={enabled ? "lightning" : "lightning-slash"}
        size={13}
        color="currentColor"
      />
    </button>
  )
}
