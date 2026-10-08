import { MissionControlError } from "../core/errors.js";
import { buildURL, requirePathSegment } from "../core/url.js";
import type { PluginUIToken } from "./types.js";

export type PluginEmbedOptions = {
  iframe: HTMLIFrameElement;
  /** Mission Control's browser-reachable URL, not the host backend's proxy URL. */
  baseUrl: string;
  name: string;
  configId: string;
  /** Fetch a plugin/config-scoped token from the host backend as its current user. */
  getToken(signal: AbortSignal): Promise<PluginUIToken>;
  onError?(error: unknown): void;
};

/** Mount a token-mode iframe; the host owns minting, this helper owns messaging and refresh cleanup. */
export function createPluginEmbed(options: PluginEmbedOptions): { dispose(): void } {
  const { iframe, getToken, onError } = options;
  const name = requirePathSegment(options.name, "name");
  const configId = options.configId.trim();
  if (!configId) throw new MissionControlError("configId is required");
  if (!iframe.isConnected) throw new MissionControlError("iframe must be attached to the document");
  const url = new URL(buildURL(options.baseUrl, `/api/plugins/${encodeURIComponent(name)}/ui/`, {
    config_id: configId, embed: "token",
  }), window.location.href);
  const lifetime = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let current: PluginUIToken | undefined;
  let expiresAt = 0;

  function send(value: PluginUIToken): void {
    iframe.contentWindow?.postMessage({ type: "mc.token", ...value }, url.origin);
  }

  /** Deduplicate ready/request/timer races; failures never fall back to a session cookie. */
  function refresh(): Promise<void> {
    if (pending) return pending;
    clearTimeout(timer);
    pending = Promise.resolve().then(() => getToken(lifetime.signal)).then(value => {
      if (lifetime.signal.aborted) return;
      if (!value || typeof value.token !== "string" || !value.token.trim() ||
          typeof value.expiresInSeconds !== "number" || !Number.isFinite(value.expiresInSeconds) ||
          value.expiresInSeconds <= 0) throw new MissionControlError("getToken returned an invalid token");
      current = { token: value.token, expiresInSeconds: value.expiresInSeconds };
      expiresAt = Date.now() + value.expiresInSeconds * 1000;
      send(current);
      const delay = value.expiresInSeconds > 30 ? value.expiresInSeconds - 30 : value.expiresInSeconds * 0.1;
      timer = setTimeout(() => void refresh(), delay * 1000);
    }).catch(error => {
      if (!lifetime.signal.aborted) onError?.(error);
    }).finally(() => { pending = undefined; });
    return pending;
  }

  function onMessage(event: MessageEvent): void {
    if (event.source !== iframe.contentWindow || event.origin !== url.origin || lifetime.signal.aborted) return;
    if (event.data?.type === "mc.tab.ready") {
      if (current && expiresAt > Date.now()) {
        send({ token: current.token, expiresInSeconds: (expiresAt - Date.now()) / 1000 });
      } else void refresh();
    } else if (event.data?.type === "mc.token.request") void refresh();
  }

  function dispose(): void {
    lifetime.abort();
    clearTimeout(timer);
    current = undefined;
    observer.disconnect();
    window.removeEventListener("message", onMessage);
  }

  const observer = new MutationObserver(() => {
    if (!iframe.isConnected) dispose();
  });
  observer.observe(iframe.ownerDocument, { childList: true, subtree: true });
  window.addEventListener("message", onMessage);
  iframe.src = url.href;
  return { dispose };
}
