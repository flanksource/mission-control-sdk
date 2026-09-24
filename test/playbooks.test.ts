import { describe, expect, it, vi } from "vitest";

import { createMissionControlClient, MissionControlError } from "../src/index.js";

function clientWith(response: () => Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response());
  const mc = createMissionControlClient({
    mode: "proxy",
    baseUrl: "/api/mission-control",
    fetch: fetchMock,
  });
  const call = (i = 0) => ({
    url: fetchMock.mock.calls[i][0] as string,
    init: fetchMock.mock.calls[i][1] as RequestInit,
  });
  return { mc, fetchMock, call };
}

describe("mc.playbooks", () => {
  it("lists playbooks eligible for a config", async () => {
    const { mc, call } = clientWith(() => Response.json([{ id: "p1", name: "restart" }]));

    const playbooks = await mc.playbooks.list({ configId: "config-123" });

    expect(playbooks).toEqual([{ id: "p1", name: "restart" }]);
    expect(call().url).toBe("/api/mission-control/playbook/list?config_id=config-123");
    expect(call().init.method).toBe("GET");
    expect(new Headers(call().init.headers).get("accept")).toBe("application/json");
  });

  it("lists all playbooks without a config", async () => {
    const { mc, call } = clientWith(() => Response.json([]));

    await mc.playbooks.list();

    expect(call().url).toBe("/api/mission-control/playbook/list");
  });

  it("resolves parameters for a target", async () => {
    const { mc, call } = clientWith(() => Response.json({ params: [{ name: "reason" }] }));

    const parameters = await mc.playbooks.parameters("p1", { configId: "config-123" });

    expect(parameters).toEqual([{ name: "reason" }]);
    expect(call().url).toBe("/api/mission-control/playbook/p1/params");
    expect(call().init.method).toBe("POST");
    expect(call().init.body).toBe(JSON.stringify({ id: "p1", config_id: "config-123" }));
    expect(new Headers(call().init.headers).get("content-type")).toBe("application/json");
  });

  it("runs a playbook with snake_case target fields on the wire", async () => {
    const { mc, call } = clientWith(() =>
      Response.json({ run_id: "r1", starts_at: "2026-09-24T00:00:00Z" }),
    );

    const run = await mc.playbooks.run({
      id: "p1",
      componentId: "component-1",
      params: { reason: "restart" },
    });

    expect(run.run_id).toBe("r1");
    expect(call().url).toBe("/api/mission-control/playbook/run");
    expect(call().init.body).toBe(
      JSON.stringify({ id: "p1", component_id: "component-1", params: { reason: "restart" } }),
    );
  });

  it("throws MissionControlError with the response status", async () => {
    const { mc } = clientWith(() => new Response("forbidden", { status: 403 }));

    const error = await mc.playbooks.run({ id: "p1" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MissionControlError);
    expect((error as MissionControlError).status).toBe(403);
    expect((error as MissionControlError).message).toBe(
      "mission-control-sdk: POST /playbook/run failed with 403: forbidden",
    );
  });
});
