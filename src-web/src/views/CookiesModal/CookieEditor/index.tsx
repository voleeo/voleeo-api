import { DateTimePicker } from "@/components/DateTimePicker"
import { Glyph } from "@/components/Glyph"
import { MultilineInput } from "@/components/MultilineInput"
import { TemplateInput } from "@/components/TemplateInput"
import { cn } from "@/lib/utils"
import type { SameSite, StoredCookie } from "@/store/cookies"
import { ClockIcon, GlobeIcon } from "../icons"
import { Field, Section, TextField } from "./fields"
import { Segmented, ToggleRow } from "./toggles"
import { defaultExpiryIso, useCookieDraft } from "./useCookieDraft"

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
  const { draft, patch, commitBlur, patchAndSave, handleDelete } =
    useCookieDraft(cookie, workspaceId, jarId)

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
          onClick={() => handleDelete(onDeleted)}
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
