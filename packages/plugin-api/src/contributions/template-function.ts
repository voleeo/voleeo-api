import type { Context } from "../context"

/** Result of an optional `previewRender` — what the function modal shows as
 *  the live preview before/instead of calling `onRender`. */
export interface PreviewResult {
  value: string
  /** Optional secondary line shown under the preview (e.g. "Expires in 5m"). */
  hint?: string
}

export interface TemplateFunctionArg {
  name: string
  label?: string
  description?: string
  type: "text" | "number" | "secret" | "select" | "checkbox" | "buttons"
  defaultValue?: string
  placeholder?: string
  /** For `number` args: HTML `min` attribute (clamps the input). */
  min?: string
  options?: Array<{ label: string; value: string }>
  required?: boolean
  /** Show this arg only when the listed sibling args match the given values.
   *  Example: `{ remember: "expire" }` — visible only when sibling `remember` === "expire". */
  visibleWhen?: Record<string, string>
  /** Render adjacent args sharing the same `row` ID inline on one row. The
   *  first arg in the group provides the shared label; later args' labels are
   *  hidden. Hidden args (via `visibleWhen`) drop out of the row. */
  row?: string
  /** Validate a non-empty value in the function modal. Return an error message
   *  to show under the input (and block Insert), or null when valid. Must be
   *  pure and synchronous — it runs on every keystroke. */
  validate?: (value: string) => string | null
}

export interface TemplateFunctionContribution {
  name: string
  label?: string
  description?: string
  args?: TemplateFunctionArg[]
  /** When false, the function modal skips the live preview at insertion time.
   *  Use for functions whose onRender has user-visible side effects (e.g. opens
   *  a runtime prompt) that shouldn't fire while the author is configuring args. */
  previewable?: boolean
  onRender(
    ctx: Context,
    args: Record<string, string>,
  ): Promise<string | null> | string | null
  /** Optional preview-only path the function modal calls in lieu of (or in
   *  addition to) `onRender` to show a meaningful preview without side
   *  effects. Return `null` to fall back to the modal's default placeholder. */
  previewRender?(
    ctx: Context,
    args: Record<string, string>,
  ): Promise<PreviewResult | null> | PreviewResult | null
}
