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
- Sends the scoped `configId` as the `config_id` query parameter. It always wins over a
  `config_id` in the operation's query, so a handle cannot be re-scoped per call.
- Sends `{}` when no body is provided for methods that support a body.
- For `GET`/`HEAD`, treats the second argument as query params.
- JSON-encodes non-`BodyInit` bodies and sets `content-type: application/json`.

```ts
await kubernetes.invoke("list-pods", { namespace: "default", labelSelector: "app=web" }, {
  method: "GET",
  proxy: true,
});
// GET /api/plugins/kubernetes/proxy/list-pods?namespace=default&labelSelector=app%3Dweb&config_id=config-123
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
- Inside a plugin iframe, use `createEmbeddedPluginClient()` instead of hardcoding authentication or
  `/api/plugins/...` URLs. The existing `mc.plugin()` handle is for host applications; it does
  not participate in the iframe handshake, and its `stream()` still returns an `EventSource`.

```ts
import { createEmbeddedPluginClient } from "@flanksource/mission-control-sdk";

const plugin = createEmbeddedPluginClient({ name: "kubernetes-logs" });
// configId defaults to config_id in the iframe URL; it cannot be overridden by a call's query.
const response = await plugin.invoke("list-pods", { namespace: "default" });
const pods = await response.json();

// Raw fetch paths are relative to /api/plugins/kubernetes-logs/.
await plugin.fetch("/invoke/list-pods", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ namespace: "default" }),
});

const controller = new AbortController();
try {
  for await (const event of plugin.stream("tail-logs", { pod: "api-123" }, {
    signal: controller.signal,
  })) {
    console.log(event.event, event.data, event.id);
  }
} catch (error) {
  if (!controller.signal.aborted) throw error;
}
// On teardown: controller.abort() and plugin.dispose().
```

The browser client uses token mode for `embed=token` **or any cross-origin parent**, even when
the flag is omitted or changed. Cookie mode (`credentials: "same-origin"`) is allowed only
for a top-level page or a same-origin parent. In token mode it:

- Sends `mc.tab.ready`, accepts valid `mc.token` messages **only from `window.parent`**, and
  waits for a token before making requests. Tokens stay in memory only.
- Forces `credentials: "omit"` and `X-Flanksource-Plugin-Invocation` on every request,
  regardless of caller options. Requests stay within this plugin's same-origin API; redirects
  are rejected in token mode to avoid leaking credentials.
- Leaves scheduled pre-expiry renewal to the host. If the token expires without replacement,
  it aborts active requests/streams and sends `mc.token.request`. New calls wait for a token.
  Unanswered requests are re-sent every five seconds; each token wait rejects with
  `MissionControlError` after 30 seconds. Caller abort signals and `dispose()` also cancel waits.
- Cancels a 401 response, waits for a newer token, then retries **once** with the same body.
  A second 401 and any 403 are returned directly. Disable additional retries in application
  query libraries in token mode (`plugin.mode === "token"`).

`stream()` uses authenticated fetch in both modes and yields `{ event, data, id }`. It handles
UTF-8 chunks, LF/CRLF/CR delimiters, comments, named events, and multiline data. HTTP failures
throw `MissionControlError` with `status`; non-SSE responses are rejected. It does not reconnect
automatically: abort to cancel a pending read, or break the loop to close a received stream.

### Third-party iframe hosts

Use the framework-independent host helper on an iframe already attached to the document:

```ts
import { createPluginEmbed } from "@flanksource/mission-control-sdk";

const embed = createPluginEmbed({
  iframe: document.querySelector<HTMLIFrameElement>("#logs")!,
  baseUrl: "https://mission-control.example.com",
  name: "kubernetes-logs",
  configId: "config-123",
  async getToken(signal) {
    const response = await fetch("/my-backend/logs-ui-token", { signal });
    if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`);
    return response.json(); // { token, expiresInSeconds }
  },
  onError: error => console.error("Plugin token refresh failed", error),
});

// Before removing the iframe (or in a framework's unmount/effect cleanup):
embed.dispose();
```

The helper sets `/api/plugins/:name/ui/?config_id=...&embed=token`, answers readiness and
renewal requests only from that iframe and Mission Control origin, and posts tokens with that
exact target origin, never `"*"`. It deduplicates concurrent refreshes and renews 30 seconds
before expiry (for TTLs of 30 seconds or less, after 10% of the TTL). Failed refreshes call
`onError` and retry with exponential backoff from one second up to 30 seconds; incoming iframe
requests do not bypass this backoff. It never falls back to cookie authentication.

Call `dispose()` on unmount to stop timers/listeners and abort the supplied signal. Removal
is also checked before minting or sending a token. For non-framework DOM management, opt into
immediate removal detection with `observeRemoval: true`; no document observer runs by default.
Each iframe needs its own helper and plugin/config-scoped token. `baseUrl` must be
browser-reachable Mission Control, not the host's backend proxy path.

The host backend must mint the token **as its federated user**, not a service account. On an
existing SDK connection to such a backend proxy, the endpoint is also available as:

```ts
const token = await mc.plugin("kubernetes-logs", { configId: "config-123" }).uiToken({ signal });
// GET <baseUrl>/api/plugins/kubernetes-logs/ui-token?config_id=config-123
// Returns { token, expiresInSeconds }; requests use cache: "no-store".
```

This follows the SDK's existing per-plugin handle rather than adding a separate `plugins`
collection. `uiToken()` requires `configId`. The browser iframe client deliberately does not
expose token minting. UI bundle authorization and federated RoleBinding configuration remain
server-side concerns.

## Other endpoints

`mc.request(path, options?)` calls any endpoint under `baseUrl` with the client's credentials
policy and returns the native `Response`. `query` keys are sent exactly as given (no renaming); a non-`BodyInit` `body`
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
