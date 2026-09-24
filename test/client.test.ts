import { describe, expect, it, vi } from "vitest";

import { createMissionControlClient } from "../src/index.js";

describe("createMissionControlClient", () => {
  it("exposes the normalized connection settings", () => {
    const mc = createMissionControlClient({
      mode: "pass-through",
      baseUrl: " https://mc.example.com/ ",
    });

    expect(mc.mode).toBe("pass-through");
    expect(mc.baseUrl).toBe("https://mc.example.com");
  });

  it("calls arbitrary endpoints with request()", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("[]"));
    const mc = createMissionControlClient({
      mode: "pass-through",
      baseUrl: "https://mc.example.com",
      fetch: fetchMock,
    });

    await mc.request("/db/config_items", { query: { limit: 10, name: "eq.api" } });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://mc.example.com/db/config_items?limit=10&name=eq.api",
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.body).toBeUndefined();
  });

  it("JSON-encodes request() bodies", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}"));
    const mc = createMissionControlClient({
      mode: "proxy",
      baseUrl: "/api/mission-control",
      fetch: fetchMock,
    });

    await mc.request("/rbac/token", { method: "post", body: { name: "ci" } });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(fetchMock.mock.calls[0][0]).toBe("/api/mission-control/rbac/token");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe(JSON.stringify({ name: "ci" }));
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });
});
