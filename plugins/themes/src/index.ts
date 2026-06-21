import type { VoleeoPlugin } from "@voleeo/plugin-api"
import { catppuccinFrappe } from "./themes/catppuccin-frappe"
import { catppuccinLatte } from "./themes/catppuccin-latte"
import { catppuccinMacchiato } from "./themes/catppuccin-macchiato"
import { catppuccinMocha } from "./themes/catppuccin-mocha"
import { dark } from "./themes/dark"
import { githubLight } from "./themes/github-light"
import { tokyoNight } from "./themes/tokyo-night"
import { tokyoNightLight } from "./themes/tokyo-night-light"
import { tokyoNightStorm } from "./themes/tokyo-night-storm"
import { light } from "./themes/light"
import { lightOwl } from "./themes/light-owl"
import { nightOwl } from "./themes/night-owl"
import { nord } from "./themes/nord"
import { rosePine } from "./themes/rose-pine"
import { rosePineDawn } from "./themes/rose-pine-dawn"
import { rosePineMoon } from "./themes/rose-pine-moon"

export const plugin: VoleeoPlugin = {
  meta: {
    id: "@voleeo/themes-voleeo",
    name: "Voleeo Themes",
    version: "1.0.0",
    author: "Voleeo",
  },
  themes: [
    dark,
    light,
    nord,
    nightOwl,
    lightOwl,
    tokyoNight,
    tokyoNightStorm,
    tokyoNightLight,
    rosePine,
    rosePineMoon,
    rosePineDawn,
    githubLight,
    catppuccinMocha,
    catppuccinMacchiato,
    catppuccinFrappe,
    catppuccinLatte,
  ],
}
