import { Dithering } from "@paper-design/shaders-react"
import { useThemeStore } from "@/store/theme"

export function ShaderBackground() {
  const palette = useThemeStore((s) => s.activeTheme?.palette)
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
      speed={0.2}
      scale={1}
      rotation={270}
      offsetX={0.7}
      offsetY={0.2}
    />
  )
}
