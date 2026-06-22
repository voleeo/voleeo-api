import { Command } from "cmdk"
import type React from "react"
import { Glyph } from "@/components/Glyph"

const GROUP_HEADING_CLS = [
  "[&_[cmdk-group-heading]]:px-3",
  "[&_[cmdk-group-heading]]:py-1.5",
  "[&_[cmdk-group-heading]]:mt-1",
  "[&_[cmdk-group-heading]]:text-[0.714rem]",
  "[&_[cmdk-group-heading]]:font-bold",
  "[&_[cmdk-group-heading]]:uppercase",
  "[&_[cmdk-group-heading]]:tracking-[0.6px]",
  "[&_[cmdk-group-heading]]:text-muted",
  "[&_[cmdk-group-heading]]:select-none",
].join(" ")

export function Group({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  return (
    <Command.Group heading={heading} className={GROUP_HEADING_CLS}>
      {children}
    </Command.Group>
  )
}

interface PaletteItemProps {
  icon: string
  label: string
  active?: boolean
  onSelect: () => void
}

export function PaletteItem({
  icon,
  label,
  active,
  onSelect,
}: PaletteItemProps) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 mx-1.5 rounded-[4px] cursor-pointer font-sans text-[0.929rem] text-fg select-none outline-none aria-selected:bg-subtle"
    >
      <Glyph kind={icon} size={13} color="var(--base04)" />
      <span className="flex-1">{label}</span>
      {active && <Glyph kind="check" size={13} color="var(--base04)" />}
    </Command.Item>
  )
}

interface RequestPaletteItemProps {
  badge: string
  badgeColor: string
  name: string
  folderPath: string
  active: boolean
  onSelect: () => void
}

export function RequestPaletteItem({
  badge,
  badgeColor,
  name,
  folderPath,
  active,
  onSelect,
}: RequestPaletteItemProps) {
  const searchValue = [badge, folderPath, name].filter(Boolean).join(" ")

  return (
    <Command.Item
      value={searchValue}
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 mx-1.5 rounded-[4px] cursor-pointer select-none outline-none aria-selected:bg-subtle"
    >
      <span
        className="font-mono text-[0.714rem] font-semibold w-[40px] text-right shrink-0 tracking-wide"
        style={{ color: badgeColor }}
      >
        {badge}
      </span>
      <span className="flex-1 min-w-0 flex items-center gap-1.5 font-sans text-[0.929rem] text-fg">
        {folderPath && (
          <>
            <span className="text-muted shrink-0 max-w-[45%] truncate">
              {folderPath}
            </span>
            <span className="text-muted shrink-0">›</span>
          </>
        )}
        <span className="truncate">{name}</span>
      </span>
      {active && <Glyph kind="check" size={13} color="var(--base04)" />}
    </Command.Item>
  )
}
