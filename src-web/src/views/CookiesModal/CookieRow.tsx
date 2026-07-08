import { useMemo, useState } from "react"
import { Glyph } from "@/components/Glyph"
import { useTemplateInputData } from "@/components/TemplateInput/useTemplateInputData"
import { cn } from "@/lib/utils"
import type { StoredCookie } from "@/store/cookies"
import { Chip, TemplatedText } from "./CookieRowChips"
import { ClockIcon, GlobeIcon, LockIcon } from "./icons"

interface Props {
  cookie: StoredCookie
  active: boolean
  onClick: () => void
  onDelete: () => void
}

function formatExpiry(exp: string | null | undefined): string {
  if (!exp) return "session"
  const d = new Date(exp)
  if (Number.isNaN(d.getTime())) return exp
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function isExpired(exp: string | null | undefined): boolean {
  if (!exp) return false // session cookies don't expire on the clock
  const d = new Date(exp)
  if (Number.isNaN(d.getTime())) return false
  return d.getTime() < Date.now()
}

export function CookieRow({ cookie, active, onClick, onDelete }: Props) {
  const [hover, setHover] = useState(false)
  const { activeVars } = useTemplateInputData()
  // Build a {name → resolved value} lookup once per render; renders the var
  // chip as the live env value so the user sees what will actually be sent
  // while still flagging the value as dynamic.
  const varsMap = useMemo(
    () => new Map(activeVars.map((v) => [v.key, v.value])),
    [activeVars],
  )
  const expired = isExpired(cookie.expires)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      role="button"
      tabIndex={0}
      className={cn(
        "group relative flex flex-col gap-[7px] px-[14px] py-[11px] rounded-[9px] cursor-pointer transition-colors border",
        active
          ? "bg-accent/10 border-transparent"
          : hover
            ? "bg-subtle/60 border-border"
            : "bg-transparent border-border",
        expired && !active && "opacity-55",
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        title="Delete cookie"
        aria-label="Delete cookie"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-60 hover:!opacity-100 flex items-center justify-center w-5 h-5 rounded-[3px] border-0 outline-none cursor-pointer bg-transparent transition-opacity"
      >
        <Glyph kind="trash" size={12} color="var(--base08)" />
      </button>

      {/* name = value */}
      <div className="flex items-baseline gap-[7px] min-w-0">
        <span className="text-[0.929rem] font-semibold text-fg shrink-0">
          {cookie.name}
        </span>
        <span className="text-[0.857rem] text-muted/70">=</span>
        <span className="text-[0.857rem] text-muted truncate min-w-0">
          {!cookie.value ? (
            <em className="not-italic opacity-50">(empty)</em>
          ) : (
            <TemplatedText text={cookie.value} vars={varsMap} />
          )}
        </span>
      </div>

      {/* domain */}
      <div className="flex items-center gap-1.5 text-[0.821rem] text-muted/70 min-w-0">
        <GlobeIcon width="12" height="12" />
        <span className="truncate min-w-0">
          <TemplatedText text={cookie.domain} vars={varsMap} />
        </span>
      </div>

      {/* attribute chips */}
      <div className="flex items-center gap-[5px] flex-wrap">
        {cookie.secure && (
          <Chip tone="secure" icon={<LockIcon width="12" height="12" />}>
            Secure
          </Chip>
        )}
        {cookie.httpOnly && <Chip tone="http">HttpOnly</Chip>}
        {cookie.hostOnly && <Chip tone="scope">host-only</Chip>}
        {cookie.sameSite && <Chip>SameSite={cookie.sameSite}</Chip>}
        {expired ? (
          <Chip tone="expired" icon={<ClockIcon width="12" height="12" />}>
            Expired
          </Chip>
        ) : (
          <Chip icon={<ClockIcon width="12" height="12" />}>
            {formatExpiry(cookie.expires)}
          </Chip>
        )}
      </div>
    </div>
  )
}
