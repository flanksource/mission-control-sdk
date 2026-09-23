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
