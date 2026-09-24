import { MissionControlError } from "./errors.js";
import type {
  ConnectionMode,
  MissionControlClientOptions,
  MissionControlRequestOptions,
  QueryParams,
} from "./types.js";
import { buildURL, isBodyInit, normalizeBaseUrl } from "./url.js";

/** Shared connection used by every sub-client: base URL, credentials policy and injected globals. */
export type Transport = {
  mode: ConnectionMode;
  baseUrl: string;
  request(path: string, options?: MissionControlRequestOptions): Promise<Response>;
  /** Like request(), but parses JSON and throws MissionControlError on non-2xx responses. */
  json<T>(path: string, options?: MissionControlRequestOptions): Promise<T>;
  eventSource(path: string, query?: QueryParams): EventSource;
};

export function createTransport(options: MissionControlClientOptions): Transport {
  const mode = options.mode;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetch;
  const EventSourceImpl = options.EventSource;
  const defaultCredentials: RequestCredentials = mode === "pass-through" ? "include" : "same-origin";

  function request(path: string, requestOptions: MissionControlRequestOptions = {}): Promise<Response> {
    const { query, body, method, ...init } = requestOptions;
    const headers = new Headers(init.headers);

    return (fetchImpl ?? globalFetch())(buildURL(baseUrl, path, query), {
      ...init,
      method: (method ?? "GET").toUpperCase(),
      credentials: init.credentials ?? defaultCredentials,
      headers,
      body: body === undefined ? undefined : encodeBody(body, headers),
    });
  }

  return {
    mode,
    baseUrl,
    request,

    async json<T>(path: string, requestOptions: MissionControlRequestOptions = {}): Promise<T> {
      const headers = new Headers(requestOptions.headers);
      headers.set("accept", "application/json");
      const response = await request(path, { ...requestOptions, headers });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).trim();
        const method = (requestOptions.method ?? "GET").toUpperCase();
        throw new MissionControlError(
          `${method} ${path} failed with ${response.status}${detail ? `: ${detail}` : ""}`,
          { status: response.status },
        );
      }
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    },

    eventSource(path: string, query?: QueryParams): EventSource {
      const EventSourceCtor = EventSourceImpl ?? globalEventSource();
      return new EventSourceCtor(buildURL(baseUrl, path, query), {
        withCredentials: mode === "pass-through",
      });
    },
  };
}

function encodeBody(body: unknown, headers: Headers): BodyInit {
  if (isBodyInit(body)) return body;

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return JSON.stringify(body);
}

function globalFetch(): typeof fetch {
  if (typeof fetch === "undefined") {
    throw new MissionControlError("fetch is not available in this environment");
  }
  return fetch;
}

function globalEventSource(): typeof EventSource {
  if (typeof EventSource === "undefined") {
    throw new MissionControlError("EventSource is not available in this environment");
  }
  return EventSource;
}
