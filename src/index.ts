export type QueryValue = string | number | boolean | null | undefined;

export type QueryParams = Record<string, QueryValue | readonly QueryValue[]>;

export type ConnectionMode = "pass-through" | "proxy";

export type PluginComponentType = "panel" | "table" | "timeseries" | "action";

export type PlaybookParameter = {
  name: string;
  default?: unknown;
  label?: string;
  required?: boolean;
  icon?: string;
  description?: string;
  type?: string;
  properties?: Record<string, unknown> | null;
  dependsOn?: string[];
};

export type Playbook = {
  id: string;
  namespace?: string;
  name: string;
  title?: string | null;
  icon?: string | null;
  description?: string | null;
  category?: string | null;
  parameters?: PlaybookParameter[] | unknown;
  spec?: {
    parameters?: PlaybookParameter[];
    [key: string]: unknown;
  } | null;
};

export type PlaybookRunTarget = {
  config_id?: string;
  component_id?: string;
  check_id?: string;
};

export type PlaybookRunRequest = PlaybookRunTarget & {
  id: string;
  params?: Record<string, string>;
};

export type PlaybookRunResponse = {
  run_id: string;
  starts_at: string;
};

export type MissionControlPlaybooksClient = {
  list(configId?: string): Promise<Playbook[]>;
  parameters(playbookId: string, target?: PlaybookRunTarget): Promise<PlaybookParameter[]>;
  run(request: PlaybookRunRequest): Promise<PlaybookRunResponse>;
};

export type PluginInvokeOptions = Omit<RequestInit, "body"> & {
  /** Use Mission Control's /proxy/:operation endpoint instead of /invoke/:operation. */
  proxy?: boolean;
};

export type MissionControlPluginClientOptions = {
  mode: ConnectionMode;
  baseUrl: string;
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
};

export type MissionControlPluginClient = {
  mode: ConnectionMode;
  baseUrl: string;
  playbooks: MissionControlPlaybooksClient;
  New(pluginRef: string, configId?: string): MissionControlPluginInstance;
};

export type MissionControlPluginInstance = {
  pluginRef: string;
  configId?: string;
  invoke(
    operation: string,
    bodyOrQueryParams?: unknown,
    options?: PluginInvokeOptions,
  ): Promise<Response>;
  stream(operation: string, query?: QueryParams): EventSource;
};

export type PluginManifest = {
  ref: string;
  name: string;
  version?: string;
  description?: string;
  operations?: PluginOperation[];
  components?: PluginComponent[];
};

export type PluginOperation = {
  name: string;
  method?: "GET" | "POST";
  streaming?: boolean;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

export type PluginComponent = {
  name: string;
  type: PluginComponentType;
  operation?: string;
};

const DEFAULT_PLUGIN_BASE_PATH = "/api/plugins";
const FALLBACK_BASE_URL = "http://plugin-ui-sdk.local";
const CONFIG_ID_QUERY_PARAM = "config_id";

/** Creates a Mission Control plugin client. */
export function createMissionControlPluginClient(
  options: MissionControlPluginClientOptions,
): MissionControlPluginClient {
  const mode = options.mode;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetch;
  const EventSourceImpl = options.EventSource;
  const defaultCredentials = credentialsForMode(mode);
  const pluginBasePath = joinURL(baseUrl, DEFAULT_PLUGIN_BASE_PATH);

  return {
    mode,
    baseUrl,
    playbooks: {
      list(configId?: string): Promise<Playbook[]> {
        return requestJSON<Playbook[]>(
          missionControlURL(baseUrl, "/playbook/list", {
            config_id: normalizeOptionalString(configId),
          }),
          undefined,
          fetchImpl,
          defaultCredentials,
        );
      },

      async parameters(
        playbookId: string,
        target: PlaybookRunTarget = {},
      ): Promise<PlaybookParameter[]> {
        const id = requirePathSegment(playbookId, "playbookId");
        const response = await requestJSON<{ params?: PlaybookParameter[] }>(
          missionControlURL(baseUrl, `/playbook/${encodeURIComponent(id)}/params`),
          {
            method: "POST",
            body: JSON.stringify({ id, ...target }),
          },
          fetchImpl,
          defaultCredentials,
        );
        return response.params ?? [];
      },

      run(request: PlaybookRunRequest): Promise<PlaybookRunResponse> {
        return requestJSON<PlaybookRunResponse>(
          missionControlURL(baseUrl, "/playbook/run"),
          {
            method: "POST",
            body: JSON.stringify(request),
          },
          fetchImpl,
          defaultCredentials,
        );
      },
    },

    New(pluginRef: string, configId?: string): MissionControlPluginInstance {
      const normalizedPluginRef = requirePathSegment(pluginRef, "pluginRef");
      const normalizedConfigId = normalizeOptionalString(configId);

      return {
        pluginRef: normalizedPluginRef,
        configId: normalizedConfigId,

        invoke(
          operation: string,
          bodyOrQueryParams?: unknown,
          invokeOptions: PluginInvokeOptions = {},
        ): Promise<Response> {
          const { proxy, method: configuredMethod, ...requestInit } = invokeOptions;
          const method = requestMethod(configuredMethod);
          const bodyless = isBodylessMethod(method);
          const query = bodyless ? requireQueryParams(bodyOrQueryParams) : undefined;
          const url = pluginOperationURL(
            {
              basePath: pluginBasePath,
              pluginRef: normalizedPluginRef,
              operation,
              configId: normalizedConfigId,
              query,
            },
            proxy ? "proxy" : "invoke",
          );
          const headers = new Headers(requestInit.headers);
          const encodedBody = bodyless
            ? undefined
            : encodeBody(bodyOrQueryParams === undefined ? {} : bodyOrQueryParams, headers);

          return (fetchImpl ?? globalFetch())(url, {
            ...requestInit,
            method,
            credentials: requestInit.credentials ?? defaultCredentials,
            headers,
            body: encodedBody,
          });
        },

        stream(operation: string, query?: QueryParams): EventSource {
          const url = pluginOperationURL(
            {
              basePath: pluginBasePath,
              pluginRef: normalizedPluginRef,
              operation,
              configId: normalizedConfigId,
              query,
            },
            "proxy",
          );

          const EventSourceCtor = EventSourceImpl ?? globalEventSource();
          return new EventSourceCtor(url, { withCredentials: mode === "pass-through" });
        },
      };
    },
  };
}

/**
 * Naming alias for createMissionControlPluginClient.
 *
 * This is not fully backwards-compatible with the old generic Mission Control
 * client shape: it does not expose request() or a nested plugins API. Migrate
 * mc.plugins.invoke(...) to client.New(pluginRef, configId).invoke(...) and
 * mc.plugins.stream(...) to client.New(pluginRef, configId).stream(...).
 */
export const createMissionControlClient = createMissionControlPluginClient;

function pluginOperationURL(
  args: {
    basePath: string;
    pluginRef: string;
    operation: string;
    configId?: string;
    query?: QueryParams;
  },
  endpoint: "invoke" | "proxy",
): string {
  const pluginRef = requirePathSegment(args.pluginRef, "pluginRef");
  const operation = requirePathSegment(args.operation, "operation");
  const url = new URL(
    `${args.basePath}/${encodeURIComponent(pluginRef)}/${endpoint}/${encodeURIComponent(operation)}`,
    fallbackBaseURL(),
  );

  if (args.configId) url.searchParams.set(CONFIG_ID_QUERY_PARAM, args.configId);
  appendQuery(url.searchParams, args.query);

  return stripFallbackOrigin(url);
}

function missionControlURL(baseUrl: string, path: string, query?: QueryParams): string {
  const url = new URL(joinURL(baseUrl, path), fallbackBaseURL());
  appendQuery(url.searchParams, query);
  return stripFallbackOrigin(url);
}

async function requestJSON<T>(
  url: string,
  init: RequestInit | undefined,
  fetchImpl: typeof fetch | undefined,
  credentials: RequestCredentials,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await (fetchImpl ?? globalFetch())(url, {
    ...init,
    credentials: init?.credentials ?? credentials,
    headers,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim();
    throw sdkError(
      `${init?.method ?? "GET"} ${url} failed with ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function appendQuery(searchParams: URLSearchParams, query?: QueryParams): void {
  if (!query) return;

  for (const [key, value] of Object.entries(query)) {
    const queryKey = key === "configId" ? CONFIG_ID_QUERY_PARAM : key;
    for (const item of queryValues(value)) {
      if (item === null || item === undefined) continue;
      searchParams.append(queryKey, String(item));
    }
  }
}

function requireQueryParams(value: unknown): QueryParams | undefined {
  if (value === undefined || value === null) return undefined;
  if (isPlainQueryParams(value)) return value;
  throw sdkError("GET and HEAD requests require query params as a plain object");
}

function isPlainQueryParams(value: unknown): value is QueryParams {
  if (!value || typeof value !== "object") return false;
  if (isBodyInit(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function queryValues(value: QueryValue | readonly QueryValue[]): readonly QueryValue[] {
  return isQueryValueArray(value) ? value : [value];
}

function isQueryValueArray(value: QueryValue | readonly QueryValue[]): value is readonly QueryValue[] {
  return Array.isArray(value);
}

function encodeBody(body: unknown, headers: Headers): BodyInit {
  if (isBodyInit(body)) return body;

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return JSON.stringify(body);
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === "string" ||
    (typeof Blob !== "undefined" && value instanceof Blob) ||
    (typeof FormData !== "undefined" && value instanceof FormData) ||
    (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams) ||
    (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) ||
    (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) ||
    (typeof ReadableStream !== "undefined" && value instanceof ReadableStream)
  );
}

function requestMethod(method: string | undefined): string {
  return (method ?? "POST").toUpperCase();
}

function isBodylessMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function credentialsForMode(mode: ConnectionMode): RequestCredentials {
  return mode === "pass-through" ? "include" : "same-origin";
}

function globalFetch(): typeof fetch {
  if (typeof fetch === "undefined") {
    throw sdkError("fetch is not available in this environment");
  }
  return fetch;
}

function globalEventSource(): typeof EventSource {
  if (typeof EventSource === "undefined") {
    throw sdkError("EventSource is not available in this environment");
  }
  return EventSource;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) throw sdkError("baseUrl is required");
  return trimTrailingSlash(trimmed);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function requirePathSegment(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw sdkError(`${field} is required`);
  if (trimmed.includes("/")) throw sdkError(`${field} must be a single path segment`);
  return trimmed;
}

function trimTrailingSlash(value: string): string {
  const trimmed = value.trim();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "/") end--;
  return trimmed.slice(0, end);
}

function joinURL(base: string, path: string): string {
  return `${trimTrailingSlash(base)}/${path.replace(/^\/+/, "")}`;
}

function fallbackBaseURL(): string {
  if (typeof window !== "undefined") return window.location.href;
  return FALLBACK_BASE_URL;
}

function stripFallbackOrigin(url: URL): string {
  if (url.origin === FALLBACK_BASE_URL) {
    return `${url.pathname}${url.search}`;
  }

  if (typeof window !== "undefined" && url.origin === window.location.origin) {
    return `${url.pathname}${url.search}`;
  }

  return url.toString();
}

function sdkError(message: string): Error {
  return new Error(`plugin-ui-sdk: ${message}`);
}
