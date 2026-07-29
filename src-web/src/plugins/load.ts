import { plugin as onePasswordPlugin } from "@voleeo/1password"
import { plugin as askPlugin } from "@voleeo/ask"
import { plugin as base64Plugin } from "@voleeo/base64"
import { plugin as curlPlugin } from "@voleeo/curl"
import { plugin as encryptPlugin } from "@voleeo/encrypt"
import { plugin as fakerPlugin } from "@voleeo/faker"
import { plugin as fetchPlugin } from "@voleeo/fetch"
import { plugin as grpcurlPlugin } from "@voleeo/grpcurl"
import { plugin as httpiePlugin } from "@voleeo/httpie"
import { plugin as themesPlugin } from "@voleeo/themes"
import { plugin as timestampPlugin } from "@voleeo/timestamp"
import { plugin as urlPlugin } from "@voleeo/url"
import { plugin as uuidPlugin } from "@voleeo/uuid"
import { requestBuiltin } from "@/builtins/request"
import { responseBuiltin } from "@/builtins/response"
import { createContext } from "./context"
import { registry } from "./registry"

/** Register all bundled first-party plugins.
 *
 * Call once during app boot (before <App /> renders) so themes and other
 * contributions are available on the first render.
 *
 * External / third-party plugins will be loaded here too once that infrastructure lands.
 */
export async function loadBundledPlugins(): Promise<void> {
  await registry.register(themesPlugin, createContext(themesPlugin.meta))
  await registry.register(uuidPlugin, createContext(uuidPlugin.meta))
  await registry.register(urlPlugin, createContext(urlPlugin.meta))
  await registry.register(base64Plugin, createContext(base64Plugin.meta))
  await registry.register(timestampPlugin, createContext(timestampPlugin.meta))
  await registry.register(fakerPlugin, createContext(fakerPlugin.meta))
  await registry.register(encryptPlugin, createContext(encryptPlugin.meta))
  await registry.register(askPlugin, createContext(askPlugin.meta))
  await registry.register(
    onePasswordPlugin,
    createContext(onePasswordPlugin.meta),
  )
  await registry.register(curlPlugin, createContext(curlPlugin.meta))
  await registry.register(fetchPlugin, createContext(fetchPlugin.meta))
  await registry.register(grpcurlPlugin, createContext(grpcurlPlugin.meta))
  await registry.register(httpiePlugin, createContext(httpiePlugin.meta))
  await registry.register(responseBuiltin, createContext(responseBuiltin.meta))
  await registry.register(requestBuiltin, createContext(requestBuiltin.meta))
}
