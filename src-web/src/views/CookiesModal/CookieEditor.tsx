import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { DateTimePicker } from "@/components/DateTimePicker"
import { Glyph } from "@/components/Glyph"
import { MultilineInput } from "@/components/MultilineInput"
import { TemplateInput } from "@/components/TemplateInput"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { SameSite, StoredCookie } from "@/store/cookies"
import { useCookiesStore } from "@/store/cookies"
import { ClockIcon, GlobeIcon } from "./icons"

interface Props {
  cookie: StoredCookie
  workspaceId: string
  jarId: string
  onClose: () => void
  onDeleted: () => void
}

export function CookieEditor({
  cookie,
  workspaceId,
  jarId,
  onClose,
  onDeleted,
}: Props) {
  const { saveCookie, deleteCookie } = useCookiesStore(
    useShallow((s) => ({
      saveCookie: s.saveCookie,
      deleteCookie: s.deleteCookie,
    })),
  )
  const [draft, setDraft] = useState<StoredCookie>(cookie)
  const [dirty, setDirty] = useState(false)

  // Reset draft only when a *different* cookie is selected (by id). Depend
  // on `cookie.id` rather than the object reference — the parent rebuilds
  // the cookie list on every reload, so a `[cookie]` dep would wipe
  // in-flight unsaved edits as soon as the store refreshes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: id-only dep is intentional
  useEffect(() => {
    setDraft(cookie)
    setDirty(false)
  }, [cookie.id])

  function patch(p: Partial<StoredCookie>) {
    setDraft((d) => ({ ...d, ...p }))
    setDirty(true)
  }

  // Commit a specific next-cookie snapshot. Pass the value explicitly so we
  // don't race React's pending state update — calling `commit()` right after
  // `setDraft` would still read the old `draft` from this render's closure.
  async function commitWith(next: StoredCookie) {
    if (!next.name.trim() || !next.domain.trim()) return
    const saved = await saveCookie(workspaceId, jarId, next).catch(() => null)
    if (saved) {
      setDraft(saved)
      setDirty(false)
    }
  }

  // Text fields call this on blur: persist the current `draft` if dirty.
  async function commitBlur() {
    if (!dirty) return
    await commitWith(draft)
  }

  // Toggles / segmented controls call this: build the next snapshot and save
  // immediately, no microtask, no stale closure.
  function patchAndSave(p: Partial<StoredCookie>) {
    const next = { ...draft, ...p }
    setDraft(next)
    void commitWith(next)
  }

  async function handleDelete() {
    await deleteCookie(workspaceId, jarId, cookie.id).catch(() => {})
    onDeleted()
  }

  const session = !draft.expires
  const nameError = !draft.name.trim() ? "Name is required" : null
  const domainError = !draft.domain.trim() ? "Domain is required" : null

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── editor header ── */}
      <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-border shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.964rem] font-semibold text-fg truncate">
            {draft.name || "untitled"}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          title="Delete cookie"
          aria-label="Delete cookie"
          className="p-1 rounded-[3px] cursor-pointer hover:bg-subtle bg-transparent border-0 outline-none"
        >
          <Glyph kind="trash" size={13} color="var(--base08)" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close editor"
          aria-label="Close editor"
          className="p-1 rounded-[3px] cursor-pointer hover:bg-subtle bg-transparent border-0 outline-none"
        >
          <Glyph kind="x" size={13} color="var(--base04)" />
        </button>
      </div>

      {/* ── scrollable body ── */}
      <div className="flex-1 overflow-auto p-5 flex flex-col gap-6">
        <Section>
          <Field label="Name" required error={nameError}>
            <TextField
              value={draft.name}
              onChange={(v) => patch({ name: v })}
              onCommit={commitBlur}
              placeholder="cookie_name"
              invalid={!!nameError}
            />
          </Field>
          <Field label="Value">
            <MultilineInput
              value={draft.value}
              onChange={(v) => patch({ value: v })}
              onCommit={commitBlur}
              placeholder="value"
              className="bg-bg border border-border rounded-lg text-fg px-2.5 py-2 text-[0.893rem] outline-none focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20 transition-colors leading-normal min-h-[52px] max-h-[200px]"
            />
          </Field>
        </Section>

        <Section>
          <div className="grid grid-cols-[1.4fr_1fr] gap-3">
            <Field
              label="Domain"
              icon={<GlobeIcon width="12" height="12" />}
              required
              error={domainError}
            >
              <TemplateInput
                value={draft.domain}
                onChange={(v) => patch({ domain: v })}
                onCommit={commitBlur}
                placeholder="example.com"
                className={cn(
                  "w-full bg-bg border rounded-lg text-fg px-2.5 py-2 text-[0.893rem] outline-none focus-within:ring-3 transition-colors leading-normal",
                  domainError
                    ? "border-error focus-within:border-error focus-within:ring-error/20"
                    : "border-border focus-within:border-accent focus-within:ring-accent/20",
                )}
              />
            </Field>
            <Field label="Path">
              <TextField
                value={draft.path}
                onChange={(v) => patch({ path: v })}
                onCommit={commitBlur}
                placeholder="/"
              />
            </Field>
          </div>
        </Section>

        <Section>
          <ToggleRow
            label="Host-only"
            desc="Send only to the exact domain."
            on={draft.hostOnly}
            onChange={(next) => patchAndSave({ hostOnly: next })}
          />
          <ToggleRow
            label="Secure"
            desc="Transmit over HTTPS connections only."
            on={draft.secure}
            onChange={(next) => patchAndSave({ secure: next })}
          />
          <ToggleRow
            label="HttpOnly"
            desc="Hide from client-side JavaScript."
            on={draft.httpOnly}
            onChange={(next) => patchAndSave({ httpOnly: next })}
          />
          <Field label="SameSite">
            <Segmented
              value={draft.sameSite ?? "_none"}
              options={[
                { label: "None", value: "_none" },
                { label: "Lax", value: "lax" },
                { label: "Strict", value: "strict" },
              ]}
              onChange={(v) =>
                patchAndSave({
                  sameSite: v === "_none" ? null : (v as SameSite),
                })
              }
            />
          </Field>
        </Section>

        <Section>
          <Segmented
            value={session ? "session" : "date"}
            options={[
              { label: "Session", value: "session" },
              { label: "Expires on date", value: "date" },
            ]}
            onChange={(v) =>
              patchAndSave({
                expires: v === "session" ? null : defaultExpiryIso(),
              })
            }
          />
          {!session && (
            <Field label="Expires" icon={<ClockIcon width="12" height="12" />}>
              <DateTimePicker
                value={draft.expires}
                onChange={(iso) => patchAndSave({ expires: iso })}
                onCommit={commitBlur}
              />
            </Field>
          )}
        </Section>
      </div>
    </div>
  )
}

function defaultExpiryIso(): string {
  return new Date(Date.now() + 7 * 864e5).toISOString()
}

// ─── reusable section/field primitives ────────────────────────────────────

function Section({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-[11px]">{children}</div>
}

function Field({
  label,
  icon,
  required,
  error,
  children,
}: {
  label: string
  icon?: React.ReactNode
  required?: boolean
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-muted/70">
        {icon}
        <span className="text-[0.75rem] font-semibold uppercase tracking-[1.2px]">
          {label}
          {required && <span className="text-accent ml-0.5">*</span>}
        </span>
      </div>
      {children}
      {error && <span className="text-[0.75rem] text-error">{error}</span>}
    </div>
  )
}

function TextField({
  value,
  onChange,
  onCommit,
  placeholder,
  area = false,
  invalid = false,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  placeholder?: string
  area?: boolean
  invalid?: boolean
}) {
  const className = cn(
    "w-full bg-bg border rounded-lg text-fg px-2.5 py-2 text-[0.893rem] outline-none focus:ring-3 transition-colors leading-normal",
    invalid
      ? "border-error focus:border-error focus:ring-error/20"
      : "border-border focus:border-accent focus:ring-accent/20",
  )
  return area ? (
    <textarea
      rows={3}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      className={cn(className, "resize-y min-h-[64px]")}
      spellCheck={false}
      autoComplete="off"
    />
  ) : (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      className={className}
      spellCheck={false}
      autoComplete="off"
    />
  )
}

function ToggleRow({
  label,
  desc,
  on,
  onChange,
}: {
  label: string
  desc: string
  on: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        // Don't double-toggle when the click hit the Switch — it already
        // fires `onCheckedChange` on its own.
        const t = e.target as HTMLElement
        if (t.closest('[data-slot="switch"]')) return
        onChange(!on)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onChange(!on)
        }
      }}
      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer bg-bg border border-border rounded-lg hover:border-muted/40 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[0.893rem] font-medium text-fg">{label}</div>
        <div className="text-[0.786rem] text-muted/70 mt-[1.5px] leading-snug">
          {desc}
        </div>
      </div>
      <Switch
        size="sm"
        checked={on}
        onCheckedChange={(next) => onChange(next === true)}
      />
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ label: string; value: T }>
  onChange: (v: T) => void
}) {
  return (
    <div className="flex bg-bg border border-border rounded-lg p-0.5 gap-0.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 px-2 py-[5px] rounded-[5px] border-0 cursor-pointer text-[0.786rem] tracking-[0.2px] transition-colors",
              active
                ? "bg-subtle text-fg font-semibold"
                : "bg-transparent text-muted/80 hover:text-fg",
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
