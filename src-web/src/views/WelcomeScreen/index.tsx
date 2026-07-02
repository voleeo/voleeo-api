import { useCallback, useEffect, useState } from "react"
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
      <div className="bg-bg h-full overflow-auto">
        {mode === "api" && <ApiClientFlow onCancel={goHome} />}
        {mode === "import" && <ImportFlow onCancel={goHome} />}
      </div>
    )
  }

  return (
    <div className="h-full flex">
      <HomeView onSelect={setMode} />
    </div>
  )
}
