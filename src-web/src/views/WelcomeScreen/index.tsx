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

  if (mode !== "home") {
    return (
      <div className={cn("bg-bg", !isMac && "h-full")}>
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
