/** Connection-status pill, styled like the HTTP response status badge. */
export function statusPill(status: string): {
  label: string
  className: string
  textClass: string
} {
  switch (status) {
    case "open":
      return {
        label: "CONNECTED",
        className: "border-success bg-surface",
        textClass: "text-success",
      }
    case "connecting":
      return {
        label: "CONNECTING",
        className: "border-amber-500/80 bg-surface",
        textClass: "text-amber-500",
      }
    case "closing":
      return {
        label: "CLOSING",
        className: "border-amber-500/80 bg-surface",
        textClass: "text-amber-500",
      }
    case "error":
      return {
        label: "ERROR",
        className: "border-destructive bg-surface",
        textClass: "text-destructive",
      }
    default:
      return {
        label: "DISCONNECTED",
        className: "border-border bg-surface",
        textClass: "text-muted",
      }
  }
}
