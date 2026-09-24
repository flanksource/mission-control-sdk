import { afterEach, describe, expect, it, vi } from "vitest";

import { createMissionControlClient } from "../src/index.js";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalWindow !== undefined) vi.stubGlobal("window", originalWindow);
  if (originalFetch !== undefined) vi.stubGlobal("fetch", originalFetch);
  if (originalEventSource !== undefined) vi.stubGlobal("EventSource", originalEventSource);
});

describe("mc.plugin", () => {
  it("creates plugin instances scoped to pluginRef and configId", () => {
    const client = createMissionControlClient({
      mode: "proxy",
      baseUrl: "/api/mission-control",
      fetch: vi.fn(),
    });

    const plugin = client.plugin("kubernetes", { configId: " config-123 " });

    expect(plugin.pluginRef).toBe("kubernetes");
    expect(plugin.configId).toBe("config-123");
  });

  it("invokes plugin operations through /invoke by default", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    const client = createMissionControlClient({
      mode: "proxy",
      baseUrl: "/api/mission-control",
      fetch: fetchMock,
    });
    const plugin = client.plugin("kubernetes", { configId: "config-123" });

    await plugin.invoke("create-pod", {
      namespace: "default",
      name: "nginx",
      image: "nginx:latest",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/mission-control/api/plugins/kubernetes/invoke/create-pod?config_id=config-123",
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe(JSON.stringify({
      namespace: "default",
      name: "nginx",
      image: "nginx:latest",
    }));
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("sends an empty params object when body is omitted", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    const client = createMissionControlClient({
      mode: "proxy",
      baseUrl: "/",
      fetch: fetchMock,
    });

    await client.plugin("kubernetes").invoke("list-pods");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/plugins/kubernetes/invoke/list-pods");
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({}));
  });

  it("requires baseUrl", () => {
    expect(() => createMissionControlClient({ mode: "proxy", baseUrl: "" })).toThrow(
      "baseUrl is required",
    );
  });

  it("uses /proxy and query params for GET requests", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    const client = createMissionControlClient({
      mode: "proxy",
      baseUrl: "/api/mission-control",
      fetch: fetchMock,
    });
    const plugin = client.plugin("kubernetes", { configId: "config-123" });

    await plugin.invoke("list-pods", {
      namespace: "default",
      labelSelector: "app=web",
      empty: null,
      repeated: ["a", "b"],
    }, {
      method: "GET",
      proxy: true,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/mission-control/api/plugins/kubernetes/proxy/list-pods?config_id=config-123&namespace=default&labelSelector=app%3Dweb&repeated=a&repeated=b",
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("uses /proxy for body-capable methods when proxy is true", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    const client = createMissionControlClient({
      mode: "proxy",
      baseUrl: "/api/mission-control",
      fetch: fetchMock,
    });
    const plugin = client.plugin("kubernetes", { configId: "config-123" });

    await plugin.invoke("create-pod", {
      namespace: "default",
      name: "nginx",
      image: "nginx:latest",
    }, { proxy: true });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/mission-control/api/plugins/kubernetes/proxy/create-pod?config_id=config-123",
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({
      namespace: "default",
      name: "nginx",
      image: "nginx:latest",
    }));
  });

  it("uses include credentials for pass-through mode", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    const client = createMissionControlClient({
      mode: "pass-through",
      baseUrl: "https://mc.example.com",
      fetch: fetchMock,
    });

    await client.plugin("kubernetes-logs", { configId: "config-123" }).invoke("pods", { namespace: "default" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://mc.example.com/api/plugins/kubernetes-logs/invoke/pods?config_id=config-123",
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe("include");
  });

  it("opens streams through /proxy", () => {
    const eventSourceMock = vi.fn(function EventSourceStub(
      this: { url: string; options?: EventSourceInit },
      url: string,
      options?: EventSourceInit,
    ) {
      this.url = url;
      this.options = options;
    });
    const client = createMissionControlClient({
      mode: "pass-through",
      baseUrl: "https://mc.example.com",
      EventSource: eventSourceMock as unknown as typeof EventSource,
    });

    client.plugin("kubernetes-logs", { configId: "config-123" }).stream("tail", { pod: "api" });

    expect(eventSourceMock).toHaveBeenCalledWith(
      "https://mc.example.com/api/plugins/kubernetes-logs/proxy/tail?config_id=config-123&pod=api",
      { withCredentials: true },
    );
  });
});
