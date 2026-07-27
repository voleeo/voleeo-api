import { cn } from "@/lib/utils"

export const ITEM_CLASSES =
  "w-full flex items-center gap-2 px-1.5 py-1 rounded-md cursor-pointer font-sans text-[0.857rem] text-fg hover:bg-subtle focus:bg-subtle outline-none"
export const SEP = "-mx-1 my-1 h-px bg-border"

/** Submenu shell; opens to the left when there's no room to the right. */
export const subMenuClasses = (flipLeft: boolean) =>
  cn(
    "absolute top-0 z-[301] min-w-[150px] rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10",
    flipLeft ? "right-full -mr-px" : "left-full -ml-px",
  )
