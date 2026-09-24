import { MissionControlError } from "../core/errors.js";
import type { Transport } from "../core/transport.js";
import type { QueryParams } from "../core/types.js";
import {
  isPlainQueryParams,
  normalizeOptionalString,
  requirePathSegment,
} from "../core/url.js";
import type { PluginClient, PluginInvokeOptions, PluginOptions } from "./types.js";

const PLUGIN_BASE_PATH = "/api/plugins";

export function createPluginClient(
  transport: Transport,
  pluginRef: string,
  options: PluginOptions = {},
): PluginClient {
  const ref = requirePathSegment(pluginRef, "pluginRef");
  const configId = normalizeOptionalString(options.configId);

  function operationPath(operation: string, endpoint: "invoke" | "proxy"): string {
    const name = requirePathSegment(operation, "operation");
    return `${PLUGIN_BASE_PATH}/${encodeURIComponent(ref)}/${endpoint}/${encodeURIComponent(name)}`;
  }

  return {
    pluginRef: ref,
    configId,

    invoke(
      operation: string,
      bodyOrQueryParams?: unknown,
      invokeOptions: PluginInvokeOptions = {},
    ): Promise<Response> {
      const { proxy, method: configuredMethod, ...init } = invokeOptions;
      const method = (configuredMethod ?? "POST").toUpperCase();
      const bodyless = method === "GET" || method === "HEAD";

      return transport.request(operationPath(operation, proxy ? "proxy" : "invoke"), {
        ...init,
        method,
        query: { configId, ...(bodyless ? requireQueryParams(bodyOrQueryParams) : {}) },
        body: bodyless ? undefined : bodyOrQueryParams === undefined ? {} : bodyOrQueryParams,
      });
    },

    stream(operation: string, query?: QueryParams): EventSource {
      return transport.eventSource(operationPath(operation, "proxy"), { configId, ...query });
    },
  };
}

function requireQueryParams(value: unknown): QueryParams | undefined {
  if (value === undefined || value === null) return undefined;
  if (isPlainQueryParams(value)) return value;
  throw new MissionControlError("GET and HEAD requests require query params as a plain object");
}
