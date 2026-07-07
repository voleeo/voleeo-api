import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Last-resort render-throw guard — without this, one uncaught render error
 *  white-screens the whole window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("Uncaught render error:", error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="h-screen w-screen flex items-center justify-center bg-bg text-fg">
        <div className="max-w-md text-center space-y-4 px-6">
          <p className="text-[1rem] font-semibold">Something went wrong</p>
          <p className="text-[0.857rem] text-muted break-words">
            {error.message}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 text-[0.857rem] rounded-[4px] border border-border bg-surface text-fg hover:bg-subtle cursor-pointer transition-colors"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
