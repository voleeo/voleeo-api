export const isMac =
  typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent)

export const isWindows =
  typeof navigator !== "undefined" && /win/i.test(navigator.userAgent)

export const isLinux = !isMac && !isWindows
