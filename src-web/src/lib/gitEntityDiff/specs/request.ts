import type {
  HttpRequest,
  RequestParameter,
} from "../../../../../packages/types/bindings"
import { blob, type Field, listField, scalar } from "../engine"
import { paramEqual, paramId, paramValue } from "../helpers"
import {
  authBlob,
  bodyShow,
  bodyText,
  gqlQueryShow,
  gqlQueryText,
  gqlVarsShow,
  gqlVarsText,
  headerList,
} from "./shared"

export const requestSpecs: Field<HttpRequest>[] = [
  scalar(
    "name",
    "General",
    (e) => e.name,
    (e, v) => {
      e.name = v
    },
    { label: "Name" },
  ),
  scalar(
    "method",
    "General",
    (e) => e.method,
    (e, v) => {
      e.method = v
    },
    { label: "Method" },
  ),
  scalar(
    "url",
    "URL",
    (e) => e.url,
    (e, v) => {
      e.url = v
    },
  ),
  listField<HttpRequest, RequestParameter>({
    id: "param",
    group: "Query Parameters",
    canBoth: true,
    get: (e) => e.parameters ?? [],
    set: (e, items) => {
      e.parameters = items
    },
    idOf: paramId,
    equal: paramEqual,
    labelOf: (p) => p.name,
    valueOf: paramValue,
  }),
  headerList<HttpRequest>(),
  blob<HttpRequest>(
    "body",
    "Body",
    (e) => bodyText(e.body),
    (e) => bodyShow(e.body),
    (from, to) => {
      to.body = from.body
    },
  ),
  blob<HttpRequest>(
    "graphqlQuery",
    "Query",
    (e) => gqlQueryText(e.body),
    (e) => gqlQueryShow(e.body),
    (from, to) => {
      to.body = from.body
    },
  ),
  blob<HttpRequest>(
    "graphqlVariables",
    "Variables",
    (e) => gqlVarsText(e.body),
    (e) => gqlVarsShow(e.body),
    (from, to) => {
      to.body = from.body
    },
  ),
  authBlob<HttpRequest>(),
]
