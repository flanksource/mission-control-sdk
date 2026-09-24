# @flanksource/mission-control-sdk

Browser SDK for Mission Control. One client holds the connection (base URL, mode, credentials);
each Mission Control API hangs off it as a sub-client.

```ts
mc.playbooks.*            // Mission Control playbooks API
mc.plugin(ref, options)   // handle for one plugin's operations
mc.request(path, options) // escape hatch for any other endpoint
```

## Install

```sh
pnpm add @flanksource/mission-control-sdk
```

## Client

```ts
import { createMissionControlClient } from "@flanksource/mission-control-sdk";

const mc = createMissionControlClient({
  mode: "proxy",
  baseUrl: "/api/mission-control",
});
```

Options:

| Option | Description |
|---|---|
| `mode` | `"proxy"` or `"pass-through"`, see [Connection modes](#connection-modes). |
| `baseUrl` | Mission Control URL, or the host backend path that proxies to it. |
| `fetch` | Optional `fetch` implementation (tests, SSR). |
| `EventSource` | Optional `EventSource` implementation used by `stream()`. |

## Playbooks

```ts
const playbooks = await mc.playbooks.list({ configId: "config-123" });

const parameters = await mc.playbooks.parameters(playbooks[0].id, {
  configId: "config-123",
});

const run = await mc.playbooks.run({
  id: playbooks[0].id,
  configId: "config-123",
  params: { reason: "Operator requested restart" },
});
```

| Method | Endpoint |
|---|---|
| `list({ configId? })` | `GET /playbook/list?config_id=` |
| `parameters(id, target?)` | `POST /playbook/:id/params` |
| `run({ id, params?, ...target })` | `POST /playbook/run` |

`list()` asks Mission Control to apply target eligibility and permissions; omit `configId` to list
every playbook visible to the current user. A target is `{ configId?, componentId?, checkId? }` and
is sent as `config_id` / `component_id` / `check_id`.

Failed requests throw `MissionControlError`, which carries the HTTP `status`:

```ts
import { MissionControlError } from "@flanksource/mission-control-sdk";

try {
  await mc.playbooks.run({ id });
} catch (error) {
  if (error instanceof MissionControlError && error.status === 403) showPermissionDenied();
}
```

## Plugins

`mc.plugin(pluginRef, { configId? })` returns a handle for one plugin, optionally scoped to a
catalog config. Plugin operations are defined by each plugin, so they are called by name.

```ts
const kubernetes = mc.plugin("kubernetes", { configId: "config-123" });
```

### `plugin.invoke(operation, bodyOrQueryParams?, options?)`

Calls a plugin operation and returns the native `Response`.

```ts
const res = await kubernetes.invoke("list-pods");
if (!res.ok) throw new Error(await res.text());
const rows = await res.json();

await kubernetes.invoke("create-pod", {
  namespace: "default",
  name: "nginx",
  image: "nginx:latest",
});
```

- Defaults to `POST /api/plugins/:pluginRef/invoke/:operation`.
- `options.proxy: true` uses `/api/plugins/:pluginRef/proxy/:operation` instead; the HTTP method
  comes from `options.method`.
- Sends `configId` as the `config_id` query parameter.
- Sends `{}` when no body is provided for methods that support a body.
- For `GET`/`HEAD`, treats the second argument as query params.
- JSON-encodes non-`BodyInit` bodies and sets `content-type: application/json`.

```ts
await kubernetes.invoke("list-pods", { namespace: "default", labelSelector: "app=web" }, {
  method: "GET",
  proxy: true,
});
// GET /api/plugins/kubernetes/proxy/list-pods?config_id=config-123&namespace=default&labelSelector=app%3Dweb
```

### `plugin.stream(operation, query?)`

Opens an SSE stream to a plugin operation via Mission Control's `/proxy/` endpoint.

```ts
const events = mc
  .plugin("kubernetes-logs", { configId: "config-123" })
  .stream("tail-logs", { pod: "api-123", tail: 100 });

events.onmessage = event => console.log(event.data);
```

### Building plugin UIs

Build plugin UIs as relocatable static apps:

- Use relative asset URLs. For Vite, set `base: "./"`.
- Use hash routing for internal UI routes.
- Use `plugin.invoke()` and `plugin.stream()` instead of hardcoding `/api/plugins/...` URLs.

## Other endpoints

`mc.request(path, options?)` calls any endpoint under `baseUrl` with the client's credentials
policy and returns the native `Response`. `query` is encoded into the URL; a non-`BodyInit` `body`
is JSON-encoded. The method defaults to `GET`.

```ts
const res = await mc.request("/db/config_items", {
  query: { select: "id,name", limit: 10 },
});
```

## Connection modes

### Proxy mode

The browser calls the host backend, which injects service auth and proxies to Mission Control.
Requests use `credentials: "same-origin"`.

```ts
createMissionControlClient({ mode: "proxy", baseUrl: "/api/mission-control" });
```

### Pass-through mode

The browser calls Mission Control directly with its cookies/session. Requests use
`credentials: "include"`, so Mission Control must allow credentialed CORS.

```ts
createMissionControlClient({
  mode: "pass-through",
  baseUrl: "https://mission-control.example.com",
});
```

## React workload panel

The optional React entry point displays CPU, memory, disk, state, history, and
logs for an application-defined workload. It wraps Clicky's `WorkloadCard`,
adding a backend-neutral loader contract, an actions menu, and a logs dialog.
A workload has a stable `id` plus Clicky's card fields; it is not restricted to
Kubernetes:

```sh
pnpm add @flanksource/mission-control-sdk @flanksource/clicky-ui @tanstack/react-query react react-dom
```

```tsx
import "@flanksource/clicky-ui/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMissionControlClient } from "@flanksource/mission-control-sdk";
import {
  WorkloadPanel,
  type WorkloadMetricLoader,
} from "@flanksource/mission-control-sdk/react";

const queryClient = new QueryClient();
const mc = createMissionControlClient({
  mode: "proxy",
  baseUrl: "/api/mission-control",
});

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
    playbooks={{ client: mc.playbooks, configId: "config-123" }}
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
import { createClickyMetricLoader } from "@flanksource/mission-control-sdk/react";

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

Opening the three-dot menu discovers playbooks that Mission Control considers
eligible for `configId`; selecting one resolves its parameters into Clicky's
`JsonSchemaForm` before starting the run.

The root entry point remains independent of React. React, ReactDOM, Clicky UI, and
`@tanstack/react-query` are optional peer dependencies used only when importing
the `/react` entry point.

## Development

```sh
pnpm install
pnpm test
pnpm build
```
