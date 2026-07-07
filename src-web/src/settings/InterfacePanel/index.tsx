import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { isWindows } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { useInterfaceStore, type WorkspaceBehavior } from "@/store/interface"
import { commands } from "../../../../packages/types/bindings"
import { CustomTitleBarRow } from "./CustomTitleBarRow"
import { FontRow } from "./FontRow"
import {
  BEHAVIORS,
  DEFAULT_EDITOR_SIZE,
  DEFAULT_INTERFACE_SIZE,
  DEFAULT_WORKSPACE_BEHAVIOR,
  defaultLabel,
  triggerCls,
} from "./shared"

export function InterfacePanel() {
  const {
    workspaceBehavior,
    fontFamily,
    fontSize,
    editorFontFamily,
    editorFontSize,
    setWorkspaceBehavior,
    setFontFamily,
    setFontSize,
    setEditorFontFamily,
    setEditorFontSize,
  } = useInterfaceStore(
    useShallow((s) => ({
      workspaceBehavior: s.workspaceBehavior,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      editorFontFamily: s.editorFontFamily,
      editorFontSize: s.editorFontSize,
      setWorkspaceBehavior: s.setWorkspaceBehavior,
      setFontFamily: s.setFontFamily,
      setFontSize: s.setFontSize,
      setEditorFontFamily: s.setEditorFontFamily,
      setEditorFontSize: s.setEditorFontSize,
    })),
  )

  const [systemFonts, setSystemFonts] = useState<string[]>([])

  // Pull the installed font list once on mount. The enumeration is on a
  // blocking pool in Rust, so the await is cheap on the JS side.
  useEffect(() => {
    let cancelled = false
    commands.listSystemFonts().then((res) => {
      if (cancelled) return
      if (res.status === "ok") setSystemFonts(res.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section>
      <h2 className="text-[1.286rem] font-semibold mb-1 text-fg">Interface</h2>
      <p className="text-[0.929rem] text-muted mb-6">
        Appearance and behavior of the app shell.
      </p>

      <div className="flex flex-col gap-5">
        {!isWindows && <CustomTitleBarRow />}

        <div>
          <label className="block text-[0.929rem] text-muted mb-1.5">
            Open workspace in
          </label>
          <Select
            value={workspaceBehavior}
            onValueChange={(v) => {
              if (v) setWorkspaceBehavior(v as WorkspaceBehavior)
            }}
          >
            <SelectTrigger className={cn(triggerCls, "w-full")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BEHAVIORS.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {defaultLabel(
                    `${b.label} — ${b.desc}`,
                    b.value === DEFAULT_WORKSPACE_BEHAVIOR,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <FontRow
          label="Interface font"
          desc="Font used for Voleeo interface controls."
          family={fontFamily}
          onFamilyChange={setFontFamily}
          size={fontSize}
          onSizeChange={setFontSize}
          defaultSize={DEFAULT_INTERFACE_SIZE}
          systemFonts={systemFonts}
        />

        <FontRow
          label="Editor font"
          desc="Font used in request and response editors."
          family={editorFontFamily}
          onFamilyChange={setEditorFontFamily}
          size={editorFontSize}
          onSizeChange={setEditorFontSize}
          defaultSize={DEFAULT_EDITOR_SIZE}
          systemFonts={systemFonts}
        />
      </div>
    </section>
  )
}
