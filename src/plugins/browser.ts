import { MissionControlError } from "../core/errors.js";
import { createTransport } from "../core/transport.js";
import type { QueryParams } from "../core/types.js";
import { normalizeOptionalString, requirePathSegment } from "../core/url.js";
import { createPluginClient as createPluginHandle } from "./client.js";
import { readPluginEvents, type PluginStreamEvent } from "./sse.js";
import type { PluginClient } from "./types.js";

export type PluginBrowserClientOptions = {
  name: string;
  /** Defaults to config_id in the iframe URL. */
  configId?: string;
  fetch?: typeof fetch;
};

export type PluginBrowserClient = Pick<PluginClient, "pluginRef" | "configId" | "invoke"> & {
  mode: "cookie" | "token";
  /** Fetch a path relative to /api/plugins/:name, with the client's scoped config. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  stream(operation: string, query?: QueryParams, options?: Pick<RequestInit, "signal">): AsyncGenerator<PluginStreamEvent>;
  dispose(): void;
};

/** Owns iframe authentication in memory. Create once per plugin UI and dispose on teardown. */
export function createEmbeddedPluginClient(options: PluginBrowserClientOptions): PluginBrowserClient {
  const name = requirePathSegment(options.name, "name");
  const params = new URLSearchParams(window.location.search);
  let mode: PluginBrowserClient["mode"] = "token";
  // A cross-origin parent cannot opt into the user's Mission Control cookies by omitting a flag.
  try {
    if (params.get("embed") !== "token" &&
        (window.parent === window || window.parent.location.origin === window.location.origin)) mode = "cookie";
  } catch {
    // Reading a cross-origin parent's location throws; token mode remains mandatory.
  }
  const configId = normalizeOptionalString(options.configId ?? params.get("config_id") ?? undefined);
  const pluginPath = `/api/plugins/${encodeURIComponent(name)}`;
  // Keep the iframe's deployment mount for both raw fetch URLs and the typed operation transport.
  const uiIndex = window.location.pathname.lastIndexOf(`${pluginPath}/ui/`);
  const baseUrl = uiIndex < 0 ? "" : window.location.pathname.slice(0, uiIndex);
  const base = new URL(`${baseUrl}${pluginPath}/`, window.location.origin);
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const lifetime = new AbortController();
  let authorization = new AbortController();
  let token: string | undefined;
  let expiresAt = 0;
  let revision = 0;
  let requestTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshRequested = false;
  const waiters = new Set<() => void>();

  /** Retry unanswered requests, but deduplicate concurrent callers for five seconds. */
  function requestToken(): void {
    if (refreshRequested || lifetime.signal.aborted) return;
    refreshRequested = true;
    window.parent.postMessage({ type: "mc.token.request" }, "*");
    requestTimer = setTimeout(() => {
      refreshRequested = false;
      if (!token || waiters.size) requestToken();
    }, 5000);
  }

  function expire(): void {
    token = undefined;
    authorization.abort(new DOMException("Plugin token expired", "AbortError"));
    authorization = new AbortController();
  }

  /** Only the embedding parent may supply credentials; neither storage nor URLs hold tokens. */
  function onMessage(event: MessageEvent): void {
    const message = event.data;
    if (event.source !== window.parent || !message || message.type !== "mc.token") return;
    if (typeof message.token !== "string" || !message.token.trim() ||
        typeof message.expiresInSeconds !== "number" || !Number.isFinite(message.expiresInSeconds) ||
        message.expiresInSeconds <= 0) return;
    clearTimeout(requestTimer);
    clearTimeout(expiryTimer);
    if (token && Date.now() >= expiresAt) expire();
    token = message.token;
    expiresAt = Date.now() + message.expiresInSeconds * 1000;
    revision++;
    refreshRequested = false;
    // The host renews before expiry; the iframe asks only if that deadline is missed or a call gets 401.
    expiryTimer = setTimeout(() => { expire(); requestToken(); }, message.expiresInSeconds * 1000);
    for (const wake of waiters) wake();
  }

  /** Bound token waits so callers can show an error; a 401 still requires a newer revision. */
  function waitForToken(after: number, signal: AbortSignal): Promise<{ token: string; revision: number }> {
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        cleanup();
        reject(new MissionControlError("Timed out waiting for a plugin token"));
      }, 30000);
      function cleanup(): void {
        clearTimeout(deadline);
        waiters.delete(wake);
        signal.removeEventListener("abort", wake);
      }
      function wake(): void {
        if (signal.aborted) {
          cleanup();
          reject(signal.reason);
        } else if (token && revision > after && Date.now() < expiresAt) {
          cleanup();
          resolve({ token, revision });
        }
      }
      waiters.add(wake);
      signal.addEventListener("abort", wake, { once: true });
      wake();
    });
  }

  /** Enforce credentials after caller options, and replay at most once after token renewal. */
  const authenticatedFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new MissionControlError("Plugin requests must stay within this plugin's same-origin API");
    }
    const signal = AbortSignal.any([lifetime.signal, ...(init?.signal ? [init.signal] : [])]);
    signal.throwIfAborted();
    if (mode === "cookie") return fetchImpl(input, { ...init, signal, credentials: "same-origin" });

    const template = new Request(url, { ...init, signal, mode: "same-origin", credentials: "omit", redirect: "error" });
    let used = await waitForToken(0, signal);
    const retry = template.clone();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const headers = new Headers(template.headers);
        headers.set("X-Flanksource-Plugin-Invocation", used.token);
        const requestSignal = AbortSignal.any([signal, authorization.signal]);
        const response = await fetchImpl(attempt === 0 ? template : retry, {
          headers, signal: requestSignal, credentials: "omit", redirect: "error",
        });
        if (response.status !== 401 || attempt === 1) return response;
        await response.body?.cancel();
        const next = waitForToken(used.revision, requestSignal);
        if (revision === used.revision) requestToken();
        used = await next;
      }
      throw new MissionControlError("Plugin retry exhausted");
    } finally {
      if (!retry.bodyUsed) void retry.body?.cancel().catch(() => {});
    }
  };

  const handle = createPluginHandle(createTransport({ mode: "proxy", baseUrl: baseUrl || "/", fetch: authenticatedFetch }), name, { configId });
  if (mode === "token") window.addEventListener("message", onMessage);
  window.parent.postMessage({ type: "mc.tab.ready" }, "*");
  if (mode === "token") requestTimer = setTimeout(requestToken, 5000);

  return {
    pluginRef: handle.pluginRef,
    configId,
    mode,
    invoke: handle.invoke,
    fetch(path, init) {
      const url = new URL(path.replace(/^\/+/, ""), base);
      if (configId) url.searchParams.set("config_id", configId);
      return authenticatedFetch(url, init);
    },
    async *stream(operation, query, streamOptions = {}) {
      const response = await handle.invoke(operation, query, {
        ...streamOptions, method: "GET", proxy: true, headers: { accept: "text/event-stream" },
      });
      yield* readPluginEvents(response);
    },
    dispose() {
      window.removeEventListener("message", onMessage);
      clearTimeout(requestTimer);
      clearTimeout(expiryTimer);
      token = undefined;
      lifetime.abort(new DOMException("Plugin client disposed", "AbortError"));
    },
  };
}
