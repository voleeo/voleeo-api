import {
  buildClientSchema,
  type GraphQLSchema,
  getIntrospectionQuery,
  type IntrospectionQuery,
} from "graphql"
import { create } from "zustand"
import { useEnvironmentStore } from "@/store/environment"
import { commands } from "../../../packages/types/bindings"

interface GraphqlSchemaStore {
  schemas: Record<string, GraphQLSchema>
  urls: Record<string, string>
  loading: Record<string, boolean>
  introspect: (
    workspaceId: string,
    requestId: string,
    url: string,
  ) => Promise<void>
  clearSchema: (requestId: string) => void
}

export const useGraphqlSchemaStore = create<GraphqlSchemaStore>((set) => ({
  schemas: {},
  urls: {},
  loading: {},

  introspect: async (workspaceId, requestId, url) => {
    set((s) => ({ loading: { ...s.loading, [requestId]: true } }))
    const done = () =>
      set((s) => ({ loading: { ...s.loading, [requestId]: false } }))

    const envId = useEnvironmentStore.getState().activeEnvId
    const res = await commands.graphqlIntrospect(
      workspaceId,
      requestId,
      envId,
      getIntrospectionQuery(),
    )
    if (
      res.status !== "ok" ||
      res.data.status < 200 ||
      res.data.status >= 300
    ) {
      done()
      return
    }
    try {
      const payload = JSON.parse(res.data.body) as {
        data?: IntrospectionQuery
      }
      if (!payload.data) {
        done()
        return
      }
      const schema = buildClientSchema(payload.data)
      set((s) => ({
        schemas: { ...s.schemas, [requestId]: schema },
        urls: { ...s.urls, [requestId]: url },
        loading: { ...s.loading, [requestId]: false },
      }))
    } catch {
      done()
    }
  },

  clearSchema: (requestId) => {
    set((s) => {
      const schemas = { ...s.schemas }
      delete schemas[requestId]
      const urls = { ...s.urls }
      delete urls[requestId]
      return { schemas, urls }
    })
  },
}))
