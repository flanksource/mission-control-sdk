# Mission Control SDK Demo

Simple Vite + React app that uses `@flanksource/mission-control-sdk` to call the `kubernetes-logs` Mission Control plugin.

## Run

```sh
pnpm install
pnpm dev
```

Open:

```text
http://localhost:5173
```

## Defaults

The app defaults to SDK `proxy` mode:

```ts
createMissionControlClient({
  mode: 'proxy',
  baseUrl: '/api/mission-control',
})
```

Mode is strict:

- `proxy` uses `/api/mission-control`, so requests go through the Vite proxy. The proxy strips browser cookies and injects `MC_API_TOKEN` if set.
- `pass-through` uses `VITE_MC_TARGET` directly, bypassing the Vite proxy. No service token is injected; the browser relies on Mission Control cookies/CORS.

Vite proxies:

```text
/api/mission-control/* -> http://localhost:8080/*
```

In proxy mode, the Vite proxy strips browser `Cookie`/`Authorization` headers and, if `MC_API_TOKEN` is set in the shell, injects Mission Control Basic auth:

```sh
export MC_API_TOKEN=...
pnpm dev
```

So this SDK call:

```text
/api/mission-control/api/plugins/kubernetes-logs/proxy/list-pods?config_id=...
```

becomes:

```text
http://localhost:8080/api/plugins/kubernetes-logs/proxy/list-pods?config_id=...
```

The demo has a **List Pods** button that calls `kubernetes-logs/list-pods` for the current `config_id`, then lets you pick a pod. Log invoke/stream calls use the `logs` operation with `GET` query parameters: `namespace`, `pod`, `container`, `tailLines`, and `follow`.

## Environment variables

```sh
MC_API_TOKEN=...                          # read from shell env; used only by Vite proxy
VITE_MC_TARGET=http://localhost:8080      # MC target; also pass-through base URL
VITE_MC_MODE=proxy                        # proxy | pass-through
VITE_MC_PROXY_BASE_URL=/api/mission-control
VITE_MC_BASE_URL=/api/mission-control     # optional override for initial base URL
VITE_PLUGIN_REF=kubernetes-logs
VITE_CONFIG_ID=a260e6af-405b-43b4-a9cd-fc81b89dd8df
VITE_OPERATION=logs
```

Example pass-through:

```sh
VITE_MC_MODE=pass-through \
VITE_MC_BASE_URL=http://localhost:8080 \
pnpm dev
```
