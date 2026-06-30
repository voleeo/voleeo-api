import { useState } from "react"
import { Glyph } from "@/components/Glyph"
import { methodColor } from "@/components/tokens"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { CommandImportResult } from "@/lib/commandImport"
import { cn } from "@/lib/utils"
import { UrlInput } from "../UrlInput"

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "QUERY",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
] as const

// RFC 7230 token chars — what reqwest's Method parser accepts. Spaces excluded.
const METHOD_TOKEN = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/
// No RFC max, but real methods top out ~17 chars (WebDAV BASELINE-CONTROL); cap generously.
const MAX_METHOD_LEN = 24
// Trigger keeps a fixed footprint; longer customs truncate with the full value on hover.
const DISPLAY_CAP = 9

function displayMethod(m: string): string {
  return m.length > DISPLAY_CAP ? `${m.slice(0, DISPLAY_CAP - 1)}…` : m
}

interface Props {
  method: string
  methodLocked?: boolean
  urlDraft: string
  disabled: boolean
  isSending: boolean
  onMethodChange: (next: string) => void
  onUrlChange: (url: string) => void
  onUrlCommit: () => void | Promise<void>
  onSend: () => void
  onCancel: () => void
  onInspect: () => void
  onParamClick: (name: string) => void
  onVarClick: (name: string) => void
  onQueryParams: (params: Array<{ key: string; value: string }>) => void
  onImportCommand?: (result: CommandImportResult) => void
}

export function RequestActionBar({
  method,
  methodLocked,
  urlDraft,
  disabled,
  isSending,
  onMethodChange,
  onUrlChange,
  onUrlCommit,
  onSend,
  onCancel,
  onInspect,
  onParamClick,
  onVarClick,
  onQueryParams,
  onImportCommand,
}: Props) {
  const [urlFocused, setUrlFocused] = useState(false)
  const [customMode, setCustomMode] = useState(false)
  const [customValue, setCustomValue] = useState("")

  const isKnown = (HTTP_METHODS as readonly string[]).includes(method)
  const inputsDisabled = disabled || isSending

  function commitCustom() {
    const v = customValue.trim().toUpperCase()
    setCustomMode(false)
    setCustomValue("")
    if (v && METHOD_TOKEN.test(v)) onMethodChange(v)
  }

  return (
    <div className="px-3.5 py-2.5">
      <div
        className={cn(
          "group flex items-center border border-border rounded-[5px] bg-surface overflow-hidden",
          disabled && "opacity-50",
        )}
      >
        {methodLocked ? (
          <div
            title="GraphQL is sent over POST"
            className="self-stretch px-2.5 editor-font font-semibold flex items-center cursor-default outline-none border-0 bg-transparent border-r border-border shrink-0"
            style={{ color: methodColor("POST"), fontSize: "0.786rem" }}
          >
            POST
          </div>
        ) : customMode ? (
          <input
            autoFocus
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value.toUpperCase())}
            onBlur={commitCustom}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitCustom()
              else if (e.key === "Escape") {
                setCustomMode(false)
                setCustomValue("")
              }
            }}
            placeholder="METHOD"
            maxLength={MAX_METHOD_LEN}
            spellCheck={false}
            autoComplete="off"
            className="self-stretch px-2.5 editor-font font-semibold bg-transparent border-0 border-r border-border outline-none shrink-0 placeholder:text-muted placeholder:font-normal"
            style={{
              color: methodColor(customValue),
              fontSize: "0.786rem",
              // Grow with content, but cap so a long custom method never crowds the URL.
              width: `${Math.min(Math.max((customValue.length || "METHOD".length) + 1, 4), 16)}ch`,
            }}
          />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={inputsDisabled}
              title={method}
              className="self-stretch px-2.5 editor-font font-semibold flex items-center gap-[5px] cursor-pointer hover:bg-subtle disabled:cursor-not-allowed outline-none border-0 bg-transparent border-r border-border rounded-none shrink-0"
              style={{ color: methodColor(method), fontSize: "0.786rem" }}
            >
              {displayMethod(method)}{" "}
              <Glyph kind="chevron" size={11} color="var(--base04)" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-0 w-auto">
              {HTTP_METHODS.map((m) => (
                <MethodRow
                  key={m}
                  method={m}
                  active={m === method}
                  onClick={() => onMethodChange(m)}
                />
              ))}
              {!isKnown && (
                <MethodRow method={method} active onClick={() => {}} />
              )}
              <DropdownMenuItem
                className="editor-font text-[0.786rem] font-medium text-accent focus:bg-subtle focus:text-accent cursor-pointer"
                onClick={() => {
                  setCustomValue("")
                  setCustomMode(true)
                }}
              >
                + Custom
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <UrlInput
          value={urlDraft}
          disabled={inputsDisabled}
          onChange={onUrlChange}
          onCommit={onUrlCommit}
          onSend={isSending ? onCancel : onSend}
          onParamClick={onParamClick}
          onVarClick={onVarClick}
          onQueryParams={onQueryParams}
          onImportCommand={onImportCommand}
          onFocus={() => setUrlFocused(true)}
          onBlur={() => setUrlFocused(false)}
        />

        <button
          type="button"
          disabled={inputsDisabled}
          onClick={onInspect}
          aria-label="Inspect request"
          title="Inspect request"
          className={cn(
            "self-stretch px-2 flex items-center justify-center cursor-pointer bg-transparent border-0 outline-none shrink-0 text-muted hover:text-accent disabled:cursor-not-allowed disabled:hover:text-muted transition-[opacity,color] duration-150",
            urlFocused
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus:opacity-100",
          )}
        >
          <Glyph kind="view" size={14} color="currentColor" />
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={isSending ? onCancel : onSend}
          aria-label={isSending ? "Cancel request" : "Send request"}
          title={isSending ? "Cancel request" : "Send request"}
          className="self-stretch px-2.5 border-l border-border flex items-center justify-center cursor-pointer bg-transparent hover:bg-subtle disabled:cursor-not-allowed outline-none shrink-0 transition-colors"
        >
          {isSending ? (
            <Glyph kind="x" size={14} color="var(--base08)" />
          ) : (
            <Glyph kind="send-right" size={14} color="var(--base0D)" />
          )}
        </button>
      </div>
    </div>
  )
}

function MethodRow({
  method,
  active,
  onClick,
}: {
  method: string
  active: boolean
  onClick: () => void
}) {
  return (
    <DropdownMenuItem
      className="editor-font text-[0.786rem] font-bold focus:bg-subtle focus:text-fg cursor-pointer grid grid-cols-[1fr_16px] items-center gap-2"
      onClick={onClick}
    >
      <span style={{ color: methodColor(method) }}>{method}</span>
      <span className="flex items-center justify-center">
        {active && <Glyph kind="check" size={11} color="var(--base04)" />}
      </span>
    </DropdownMenuItem>
  )
}
