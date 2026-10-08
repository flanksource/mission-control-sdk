import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmbeddedPluginClient, type PluginBrowserClient } from "../src/index.js";

const clients: PluginBrowserClient[] = [];

function frame(embed = "token", parentOrigin: string | null = "https://host.test") {
  const parent = {
    postMessage: vi.fn(),
    get location() {
      if (parentOrigin === null) throw new DOMException("Cross-origin", "SecurityError");
      return new URL(parentOrigin);
    },
  };
  const window = Object.assign(new EventTarget(), {
    location: new URL(`https://mc.test/api/plugins/logs/ui/?config_id=scope-a&embed=${embed}`),
    parent,
    postMessage: vi.fn(),
  });
  vi.stubGlobal("window", window);
  return {
    window,
    parent,
    token(token = "original", expiresInSeconds: unknown = 300, source: unknown = parent) {
      window.dispatchEvent(Object.assign(new Event("message"), {
        source, data: { type: "mc.token", token, expiresInSeconds },
      }));
    },
    requests: () => parent.postMessage.mock.calls.filter(([message]) => message.type === "mc.token.request"),
  };
}

function client(fetch: typeof globalThis.fetch) {
  const result = createEmbeddedPluginClient({ name: "logs", fetch });
  clients.push(result);
  return result;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("embedded plugin authentication", () => {
  it.each([
    ["", "https://mc.test", "cookie"],
    ["", "https://host.test", "token"],
    ["", null, "token"],
    ["cookie", null, "token"],
    ["token", "https://mc.test", "token"],
  ] as const)("selects %s / parent %s as %s", async (embed, origin, mode) => {
    frame(embed, origin);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("{}"));
    const plugin = client(fetch);
    expect(plugin.mode).toBe(mode);
    if (mode === "cookie") {
      await plugin.invoke("pods", {}, { credentials: "include" });
      expect(fetch.mock.calls[0][1]?.credentials).toBe("same-origin");
    }
  });

  it("preserves cookie mode in a top-level page", async () => {
    const { window } = frame("");
    Object.assign(window, { parent: window });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("{}"));
    await client(fetch).invoke("pods");
    expect(fetch.mock.calls[0][1]?.credentials).toBe("same-origin");
  });

  it("waits for a valid parent token, then enforces credentials, headers and config scope", async () => {
    const host = frame();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("{}"));
    const plugin = client(fetch);
    expect(host.parent.postMessage).toHaveBeenCalledWith({ type: "mc.tab.ready" }, "*");
    const waiting = plugin.fetch("/proxy/pods?config_id=other", {
      credentials: "include",
      headers: { "x-custom": "preserved", "X-Flanksource-Plugin-Invocation": "forged" },
    });
    host.token("spoofed", 300, host.window);
    host.token("", 300);
    host.token("bad", 0);
    host.token("bad", "300");
    host.token("bad", Infinity);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetch).not.toHaveBeenCalled();
    host.token("accepted");
    await waiting;
    const [request, init] = fetch.mock.calls[0];
    expect((request as Request).url).toBe("https://mc.test/api/plugins/logs/proxy/pods?config_id=scope-a");
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("X-Flanksource-Plugin-Invocation")).toBe("accepted");
    expect(new Headers(init?.headers).get("x-custom")).toBe("preserved");
    await expect(plugin.fetch("../other/invoke/pods")).rejects.toThrow("same-origin API");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retries a 401 with a newer token and the same body, returning the second 401", async () => {
    const host = frame();
    const unauthorized = new Response("denied", { status: 401 });
    const cancel = vi.spyOn(unauthorized.body!, "cancel");
    const bodies: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async input => {
      bodies.push(await (input as Request).text());
      return bodies.length === 1 ? unauthorized : new Response("still denied", { status: 401 });
    });
    const plugin = client(fetch);
    host.token("old");
    const response = plugin.invoke("pods", { namespace: "payments", count: 7 });
    await vi.waitFor(() => expect(host.requests()).toHaveLength(1));
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    host.token("new");
    expect((await response).status).toBe(401);
    expect(bodies).toEqual([
      '{"namespace":"payments","count":7}', '{"namespace":"payments","count":7}',
    ]);
    expect(fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get("X-Flanksource-Plugin-Invocation")))
      .toEqual(["old", "new"]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(host.requests()).toHaveLength(1);
  });

  it("deduplicates concurrent 401 renewal and does not renew for 403", async () => {
    const host = frame();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) => new Response(null, {
      status: new Headers(init?.headers).get("X-Flanksource-Plugin-Invocation") === "old" ? 401 : 403,
    }));
    const plugin = client(fetch);
    host.token("old");
    const responses = [plugin.invoke("first"), plugin.invoke("second")];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(host.requests()).toHaveLength(1);
    host.token("new");
    expect((await Promise.all(responses)).map(response => response.status)).toEqual([403, 403]);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(host.requests()).toHaveLength(1);
  });

  it("re-requests unanswered tokens and rejects after 30 seconds, then allows recovery", async () => {
    const host = frame();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("{}"));
    const plugin = client(fetch);
    const failed = expect(plugin.invoke("pods")).rejects.toThrow("Timed out waiting for a plugin token");
    expect(host.requests()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(4999);
    expect(host.requests()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(host.requests()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(25000);
    await failed;
    expect(fetch).not.toHaveBeenCalled();
    host.token("recovered");
    expect((await plugin.invoke("pods")).status).toBe(200);
  });

  it("bounds the wait for a newer token after a 401", async () => {
    const host = frame();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 401 }));
    const plugin = client(fetch);
    host.token();
    const failed = expect(plugin.invoke("pods")).rejects.toThrow("Timed out waiting for a plugin token");
    await vi.advanceTimersByTimeAsync(30000);
    await failed;
    expect(fetch).toHaveBeenCalledOnce();
    expect(host.requests().length).toBeGreaterThan(1);
  });

  it("cancels token waits on caller abort and disposal", async () => {
    frame();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const plugin = client(fetch);
    const controller = new AbortController();
    const aborted = expect(plugin.invoke("pods", {}, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await aborted;
    const disposed = expect(plugin.invoke("pods")).rejects.toMatchObject({ name: "AbortError" });
    plugin.dispose();
    await disposed;
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts an open SSE stream on expiry and does not schedule a competing pre-expiry renewal", async () => {
    const host = frame();
    let requestSignal: AbortSignal | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) => {
      requestSignal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: first\n\n"));
          requestSignal!.addEventListener("abort", () => controller.error(requestSignal!.reason));
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    });
    const plugin = client(fetch);
    host.token("short", 35);
    const events = plugin.stream("follow");
    expect((await events.next()).value).toEqual({ event: "message", data: "first", id: "" });
    const ended = expect(events.next()).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(34999);
    expect(host.requests()).toHaveLength(0);
    expect(requestSignal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await ended;
    expect(requestSignal!.aborted).toBe(true);
    expect(host.requests()).toHaveLength(1);
  });
});
