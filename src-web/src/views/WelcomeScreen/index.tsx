import { useCallback, useEffect, useState } from "react"
import { isMac } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { applyWelcomeWindowSize, useUiStore } from "@/store/workspace"
import { ApiClientFlow } from "./ApiClientFlow"
import { HomeView } from "./HomeView"
import { ImportFlow } from "./ImportFlow"

type Mode = "home" | "api" | "import"

export function WelcomeScreen() {
  const loadWorkspaces = useUiStore((s) => s.loadWorkspaces)
  const [mode, setMode] = useState<Mode>("home")

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  const goHome = useCallback(() => {
    setMode("home")
    applyWelcomeWindowSize()
  }, [])

  // On macOS the flow uses a plain div (no h-full/flex) so FlowShell can grow
  // the fixed window to its own content height. On resizable platforms the
  // window doesn't auto-fit, so fill and centre the flow instead.
  if (mode !== "home") {
    return (
      <div
        className={cn(
          "bg-bg",
          !isMac &&
            "h-full flex flex-col items-center [justify-content:safe_center] overflow-auto",
        )}
      >
        {mode === "api" && <ApiClientFlow onCancel={goHome} />}
        {mode === "import" && <ImportFlow onCancel={goHome} />}
      </div>
    )
  }

  return (
    <div className="h-full flex bg-bg">
      <HomeView onSelect={setMode} />
    </div>
  )
}
