import { Dithering } from "@paper-design/shaders-react"
import { useEffect, useState } from "react"
import { useThemeStore } from "@/store/theme"

export function ShaderBackground() {
  const palette = useThemeStore((s) => s.activeTheme?.palette)
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    const on = () => setFocused(true)
    const off = () => setFocused(false)
    window.addEventListener("focus", on)
    window.addEventListener("blur", off)
    return () => {
      window.removeEventListener("focus", on)
      window.removeEventListener("blur", off)
    }
  }, [])

  if (!palette) return null

  return (
    <Dithering
      className="fixed inset-0 -z-10 pointer-events-none"
      width="100%"
      height="100%"
      colorBack={palette.base00}
      colorFront={palette.base0D}
      shape="wave"
      type="4x4"
      size={4}
      speed={focused ? 0.2 : 0}
      scale={1}
      rotation={270}
      offsetX={0.7}
      offsetY={0.2}
    />
  )
}
