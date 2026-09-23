# @flanksource/plugin-ui-sdk

Browser SDK for calling Mission Control plugin operations.

## Install

```sh
pnpm add @flanksource/plugin-ui-sdk
```

## Plugin client API

Create a Mission Control plugin client, then create an instance for a specific plugin/config pair:

```ts
import { createMissionControlPluginClient } from "@flanksource/plugin-ui-sdk";

const pluginClient = createMissionControlPluginClient({
  mode: "proxy",
  baseUrl: "/api/mission-control",
});

const kubernetes = pluginClient.New("kubernetes", "config-123");
```

### `pluginClient.New(pluginRef, configId?)`

Creates a plugin instance scoped to a plugin ref and optional catalog config id.
The instance exposes the operation methods.

### `instance.invoke(operation, bodyOrQueryParams?, options?)`

Calls a plugin operation and returns the native `Response`.

```ts
const res = await kubernetes.invoke("list-pods");

if (!res.ok) throw new Error(await res.text());
const rows = await res.json();
```

With params/body:

```ts
const res = await kubernetes.invoke("create-pod", {
  namespace: "default",
  name: "nginx",
  image: "nginx:latest",
});
```

Behavior:

- Defaults to `POST /api/plugins/:pluginRef/invoke/:operation`.
- Set `options.proxy: true` to use `/api/plugins/:pluginRef/proxy/:operation` instead; `pluginRef` comes from `pluginClient.New(pluginRef, configId)` and the HTTP method comes from `options.method`.
- Sends the instance `configId` as the `config_id` query parameter.
- Sends `{}` when no body is provided for methods that support a body.
- For `GET`/`HEAD`, treats the second argument as query params.
- JSON-encodes non-`BodyInit` bodies and sets `content-type: application/json`.

HTTP-style proxy request:

```ts
const res = await kubernetes.invoke("list-pods", {
  namespace: "default",
  labelSelector: "app=web",
}, {
  method: "GET",
  proxy: true,
});
// GET /api/plugins/kubernetes/proxy/list-pods?config_id=config-123&namespace=default&labelSelector=app%3Dweb
```

### `instance.stream(operation, query?)`

Opens an SSE stream to a plugin operation via Mission Control's `/proxy/` endpoint.

```ts
const logs = pluginClient.New("kubernetes-logs", "config-123");
const events = logs.stream("tail-logs", {
  pod: "api-123",
  tail: 100,
});

events.onmessage = event => {
  console.log(event.data);
};
```

## Connection modes

### Proxy mode

Browser calls the host backend. The host backend injects service auth and proxies to Mission Control.

```ts
const pluginClient = createMissionControlPluginClient({
  mode: "proxy",
  baseUrl: "/api/mission-control",
});
```

### Pass-through mode

Browser calls Mission Control directly using Mission Control cookies/session.

```ts
const pluginClient = createMissionControlPluginClient({
  mode: "pass-through",
  baseUrl: "https://mission-control.example.com",
});
```

Pass-through requires Mission Control cookies and CORS to support credentialed browser requests.

## Playbooks

The client exposes the Mission Control playbook discovery, parameter, and run APIs using the same
base URL, connection mode, injected `fetch`, and credential policy as plugin operations:

```ts
const playbooks = await pluginClient.playbooks.list("config-123");
const parameters = await pluginClient.playbooks.parameters(playbooks[0].id, {
  config_id: "config-123",
});
const run = await pluginClient.playbooks.run({
  id: playbooks[0].id,
  config_id: "config-123",
  params: { reason: "Operator requested restart" },
});
```

`list(configId)` asks Mission Control to apply target eligibility and permissions. Omit `configId`
to list all playbooks visible to the current user.

## React workload panel

The optional React entry point displays CPU, memory, disk, state, history, and
logs for an application-defined workload. It wraps Clicky's `WorkloadCard`,
adding a backend-neutral loader contract, an actions menu, and a logs dialog.
A workload has a stable `id` plus Clicky's card fields; it is not restricted to
Kubernetes:

```sh
pnpm add @flanksource/plugin-ui-sdk @flanksource/clicky-ui @tanstack/react-query react react-dom
```

```tsx
import "@flanksource/clicky-ui/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  WorkloadPanel,
  type WorkloadMetricLoader,
} from "@flanksource/plugin-ui-sdk/react";

const queryClient = new QueryClient();

const loadMetric = (
  metric: "cpu" | "memory",
  measure: "usage" | "capacity",
): WorkloadMetricLoader =>
  ({ workload, range, signal }) =>
    observability.loadSeries({
      workloadId: workload.id,
      metric,
      measure,
      range,
      signal,
    });

<QueryClientProvider client={queryClient}>
  <WorkloadPanel
    workload={{
      id: "production/payments-api",
      name: "payments-api",
      type: "EC2 instance",
      metadata: [
        { label: "Region", value: "eu-west-1" },
        { label: "Instance", value: "i-0123456789" },
      ],
      status: { label: "running", health: "healthy" },
    }}
    metrics={{
      cpu: {
        usage: loadMetric("cpu", "usage"),
        capacity: loadMetric("cpu", "capacity"),
      },
      memory: {
        usage: loadMetric("memory", "usage"),
        capacity: loadMetric("memory", "capacity"),
      },
    }}
    actions={[{ label: "Restart", onSelect: () => restart("payments-api") }]}
    logs={{
      load: ({ workload, signal }) => observability.loadLogs(workload.id, { signal }),
    }}
  />
</QueryClientProvider>
```

- **Workload.** Any `WorkloadCard` field works: a free-form `type` or a
  Kubernetes `kind`, `icon`, `namespace`, `replicas`, `createdAt`, and
  `metadata`. The status badge tone comes from `status.health`
  (`healthy`, `warning`, `unhealthy`) or an explicit `status.tone`; the label
  text never affects it.
- **Metrics.** Loaders receive the workload, the selected range, and an
  `AbortSignal`, and return `{ points: [{ at, value }] }`. They own
  authentication, filtering, and backend queries, whether the source is
  Prometheus, Clicky, a cloud API, or an in-memory collector. CPU values use
  cores; memory and disk values use bytes. `capacity` may also be a fixed
  number in the same unit.
- **Caching.** Series are cached by workload `id` and metric, so an id must
  always map to the same data sources.
- **Actions.** `actions` items appear in the ⋯ menu before the built-in Logs
  item.
- **Styles.** Import `@flanksource/clicky-ui/styles.css` once at the app root;
  without it the card, menu, and dialogs render unstyled.
- **Query client.** The panel polls through react-query, so it needs a
  `QueryClientProvider` from the host's `@tanstack/react-query` peer dependency.
  Install a version satisfying the SDK and Clicky peer range (`^5.66.8`).

For Clicky's `GET <baseUrl>/<metricId>?since=<range>` contract, use the supplied
adapter. The metric id is fixed or derived from the workload, and named source
units keep collector-specific conversion out of callers:

```tsx
import { createClickyMetricLoader } from "@flanksource/plugin-ui-sdk/react";

const clickyMetric = createClickyMetricLoader({
  baseUrl: "/api/v1/metrics",
  fetcher: metricsFetcher,
});
const metricId = (dimension: string) => (workload: { name: string }) =>
  `k8s.statefulset.${workload.name}.${dimension}`;

<WorkloadPanel
  workload={workload}
  metrics={{
    cpu: {
      usage: clickyMetric(metricId("cpu.usage"), { unit: "millicores" }),
      capacity: clickyMetric(metricId("cpu.limit"), { unit: "millicores" }),
    },
    memory: {
      usage: clickyMetric(metricId("memory.usage"), { unit: "bytes" }),
      capacity: clickyMetric(metricId("memory.limit"), { unit: "bytes" }),
    },
  }}
/>
```

A custom `fetcher` receives the URL and `{ signal }`.

The root client remains independent of React. React, ReactDOM, Clicky UI, and
`@tanstack/react-query` are optional peer dependencies used only when importing
the `/react` entry point.

## Types

Important exported types:

```ts
type ConnectionMode = "pass-through" | "proxy";
type QueryValue = string | number | boolean | null | undefined;
type QueryParams = Record<string, QueryValue | readonly QueryValue[]>;

interface MissionControlPluginClient {
  mode: ConnectionMode;
  baseUrl: string;
  playbooks: MissionControlPlaybooksClient;
  New(pluginRef: string, configId?: string): MissionControlPluginInstance;
}

interface MissionControlPluginInstance {
  pluginRef: string;
  configId?: string;
  invoke(operation: string, bodyOrQueryParams?: unknown, options?: PluginInvokeOptions): Promise<Response>;
  stream(operation: string, query?: QueryParams): EventSource;
}
```

## UI build guidance

Build plugin UIs as relocatable static apps:

- Use relative asset URLs. For Vite, set `base: "./"`.
- Use hash routing for internal UI routes.
- Use `instance.invoke()` and `instance.stream()` for plugin backend calls instead of hardcoding `/api/plugins/...` URLs.

Vite example:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
});
```

## Development

```sh
pnpm install
pnpm test
pnpm build
```
