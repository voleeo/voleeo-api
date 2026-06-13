/** The host capabilities object passed into every plugin callback.
 *
 * This is the ONLY way plugins are supposed to interact with the host —
 * no direct `invoke()` calls, no store imports.  This boundary lets us
 * sandbox plugins in a web worker later without touching plugin code.
 */
export type RememberChoice = "never" | "expire" | "forever"

export interface PromptAskResult {
  value: string
  remember: RememberChoice
  /** Duration in milliseconds; only set when `remember === "expire"`. */
  expiresInMs?: number
}

export interface Context {
  /** Show a transient notification in the app UI. */
  toast: {
    show(opts: { message: string; kind?: "info" | "success" | "error" | "warning" }): void
  }

  /** Read / write text to the system clipboard. */
  clipboard: {
    copyText(text: string): Promise<void>
  }

  /** Open modal dialogs backed by the host UI. */
  prompt: {
    text(opts: { title: string; label?: string; defaultValue?: string }): Promise<string | null>
    ask(opts: {
      title?: string
      defaultValue?: string
      placeholder?: string
    }): Promise<PromptAskResult | null>
  }

  /** Namespaced key/value storage persisted per-plugin.
   *  Keys are arbitrary strings; values must be JSON-serializable. */
  store: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set<T = unknown>(key: string, value: T): Promise<void>
    delete(key: string): Promise<void>
  }

  /** Read information about the current workspace context. */
  workspace: {
    /** The active workspace ID, or null if no workspace is open. */
    currentId(): string | null
  }

  /** Expand template variables ({{ env.MY_VAR }}, etc.) in a value. */
  templates: {
    /** Deep-renders all template expressions inside value.  Returns the
     *  same structure with all expressions replaced by their resolved strings.
     *  Pass a plain string for URL/header values; pass an object to batch. */
    render<T>(value: T): Promise<T>
  }

  /** Resolve dynamic auth schemes that the host signs at send time. */
  auth: {
    /** Sign a dynamic scheme (AWS SigV4, OAuth 1.0) over the final request and
     *  return the header and/or query params to add (OAuth 1.0 can place its
     *  params in either). `auth` must already be template-resolved. */
    signDynamic(
      auth: unknown,
      req: { method: string; url: string; body?: unknown },
    ): Promise<{
      headers: Array<{ name: string; value: string }>
      query: Array<{ name: string; value: string }>
    }>
  }

  /** Structured logging — output is tagged with the plugin id. */
  log: {
    debug(...args: unknown[]): void
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
    error(...args: unknown[]): void
  }
}
