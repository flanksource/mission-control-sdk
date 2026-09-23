// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  WorkloadPanel,
  createClickyMetricLoader,
  type WorkloadDescriptor,
  type WorkloadMetricLoader,
} from "../src/react.js";

afterEach(cleanup);

const series = (...values: number[]) => ({
  points: values.map((value, i) => ({
    at: new Date(Date.UTC(2026, 8, 23, 12, i)).toISOString(),
    value,
  })),
});

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return {
    ...view,
    client,
    rerender: (next: ReactElement) =>
      view.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
  };
}

const vm: WorkloadDescriptor = {
  id: "aws/eu-west-1/i-0123",
  name: "payments-api",
  type: "EC2 instance",
  metadata: [{ label: "Region", value: "eu-west-1" }],
  status: { label: "running", health: "healthy" },
};

describe("WorkloadPanel", () => {
  it("renders the workload card and passes workload, range and signal to loaders", async () => {
    const usage = vi.fn<WorkloadMetricLoader>(async () => series(1, 1.5));
    renderWithClient(
      <WorkloadPanel
        workload={vm}
        metrics={{ cpu: { usage, capacity: 4 } }}
        range="15m"
        refreshMs={0}
      />,
    );

    expect(screen.getByText("payments-api")).toBeTruthy();
    expect(screen.getByText("EC2 instance")).toBeTruthy();
    expect(screen.getByText("eu-west-1")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();

    await waitFor(() => expect(usage).toHaveBeenCalled());
    const request = usage.mock.calls[0]![0];
    expect(request.workload.id).toBe(vm.id);
    expect(request.range).toBe("15m");
    expect(request.signal).toBeInstanceOf(AbortSignal);

    // Cores in, Clicky's millicore bars out: 1.5 cores of a fixed 4.
    expect(await screen.findByText("1.5 cores")).toBeTruthy();
  });

  it("keys cached series by workload id and metric", async () => {
    const a = vi.fn<WorkloadMetricLoader>(async () => series(0.5));
    const b = vi.fn<WorkloadMetricLoader>(async () => series(2));
    const { client } = renderWithClient(
      <>
        <WorkloadPanel workload={{ id: "a", name: "a" }} metrics={{ cpu: { usage: a } }} refreshMs={0} />
        <WorkloadPanel workload={{ id: "b", name: "b" }} metrics={{ cpu: { usage: b } }} refreshMs={0} />
      </>,
    );

    await waitFor(() => {
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });
    const keys = client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["timeseries", "load", "plugin-ui-sdk/workload/a/cpu/usage", "1h"],
        ["timeseries", "load", "plugin-ui-sdk/workload/b/cpu/usage", "1h"],
      ]),
    );
  });

  it("lists host actions before Logs in the actions menu", async () => {
    const onSelect = vi.fn();
    renderWithClient(
      <WorkloadPanel
        workload={vm}
        metrics={{}}
        actions={[{ label: "Restart", onSelect }]}
        logs={{ load: async () => "line" }}
      />,
    );

    await act(async () => screen.getByLabelText("Open payments-api actions").click());
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["Restart", "Logs"]);

    await act(async () => screen.getByText("Restart").click());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("aborts and discards a pending log load when the workload changes", async () => {
    let signalA: AbortSignal | undefined;
    let resolveA: (logs: string) => void = () => {};
    const load = vi.fn(({ workload, signal }: { workload: WorkloadDescriptor; signal: AbortSignal }) => {
      if (workload.id !== "a") return Promise.resolve("logs of b");
      signalA = signal;
      return new Promise<string>((resolve) => (resolveA = resolve));
    });
    const panel = (id: string) => (
      <WorkloadPanel workload={{ id, name: id }} metrics={{}} logs={{ load }} />
    );
    const { rerender } = renderWithClient(panel("a"));

    await act(async () => screen.getByLabelText("Open a actions").click());
    await act(async () => screen.getByText("Logs").click());
    expect(screen.getByText("Loading logs")).toBeTruthy();

    rerender(panel("b"));
    expect(signalA?.aborted).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => resolveA("logs of a"));
    expect(document.body.textContent).not.toContain("logs of a");
  });

  it("shows a log load failure", async () => {
    renderWithClient(
      <WorkloadPanel
        workload={vm}
        metrics={{}}
        logs={{ load: async () => Promise.reject(new Error("no pods")) }}
      />,
    );

    await act(async () => screen.getByLabelText("Open payments-api actions").click());
    await act(async () => screen.getByText("Logs").click());
    expect((await screen.findByRole("alert")).textContent).toContain("no pods");
  });
});

describe("createClickyMetricLoader", () => {
  const signal = new AbortController().signal;

  it("derives the metric id from the workload and converts millicores to cores", async () => {
    const fetcher = vi.fn(async () => series(500, 1500));
    const metric = createClickyMetricLoader({ baseUrl: "/api/v1/metrics", fetcher });
    const load = metric((w) => `k8s.deployment.${w.name}.cpu.usage`, { unit: "millicores" });

    const result = await load({ workload: vm, range: "1h", signal });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/metrics/k8s.deployment.payments-api.cpu.usage?since=1h",
      { signal },
    );
    expect(result.points.map((p) => p.value)).toEqual([0.5, 1.5]);
  });

  it("accepts a fixed id and leaves bytes unscaled", async () => {
    const fetcher = vi.fn(async () => series(2048));
    const metric = createClickyMetricLoader({ baseUrl: "/metrics/", fetcher });

    const result = await metric("node.memory.usage", { unit: "bytes" })({
      workload: vm,
      range: "6h",
      signal,
    });

    expect(fetcher).toHaveBeenCalledWith("/metrics/node.memory.usage?since=6h", { signal });
    expect(result.points[0]!.value).toBe(2048);
  });
});
