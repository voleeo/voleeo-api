import React from "react"
import ReactDOM from "react-dom/client"
import App from "@/App"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { TooltipProvider } from "@/components/ui/tooltip"
import { initMenuActions } from "@/layout/menuActions"
import { initWindowsAltMenu } from "@/layout/windowsMenu"
import { loadBundledPlugins } from "@/plugins/load"
import { initWorkspaceListeners } from "@/store/workspace"

// Goldman display font used for the Voleeo wordmark on the welcome screen.
import "@fontsource/goldman/400.css"
import "./styles/base.css"

void (async () => {
  await loadBundledPlugins()
  initWorkspaceListeners()
  initWindowsAltMenu()
  initMenuActions()

  const rootEl = document.getElementById("root")
  if (!rootEl) throw new Error("root element not found")

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )
})()
