# Mission Control SDK

Clients for the Mission Control API.

| Directory | Package | Install |
|---|---|---|
| [`typescript/`](typescript/) | `@flanksource/mission-control-sdk` (browser SDK: playbooks, plugins, raw API access) | `pnpm add @flanksource/mission-control-sdk` |
| [`go/`](go/) | `github.com/flanksource/mission-control-sdk/go` (HTTP client and wire types) | `go get github.com/flanksource/mission-control-sdk/go` |

The npm package is released as `vX.Y.Z` tags and the Go module as `go/vX.Y.Z` tags.

## Generated Go models

`go/clientapi/zz_generated.duty_*.go` hold duty's wire types, so the SDK does not depend on duty:

- `duty_types`: resource selectors, catalog properties (`CatalogProperty`, `CatalogLink`, `CatalogText`), env var and secret references, check uptime and latency.
- `duty_query`: resource search and change search requests and rows.
- `duty_models`: config items and their changes, analyses, relationships and scrapers, artifacts, playbooks and their runs, connections, canaries and checks.

Do not edit them by hand; regenerate them with [Task](https://taskfile.dev) (needs Go, git and `jq`):

```bash
task go:generate         # regenerate
task go:generate:check   # regenerate and fail if the result differs from what is committed
```

`go:generate:models` builds a pinned [flanksource/gopatch](https://github.com/flanksource/gopatch) into `.bin/` and copies the declarations from the duty release in `DUTY_VERSION` with `go/internal/codegen`, keeping only their `json` and `yaml` tags and dropping fields JSON never encodes. gopatch then:

- maps duty's column types onto plain Go and renames the property types (`go/internal/codegen/duty-types.patch`, `duty-models.patch`),
- adds the cost fields the API returns on `ConfigItem`,
- keeps `omitzero` on `Connection`'s timestamps so a new connection does not send zero times.

To move to a newer duty, change `DUTY_VERSION` in `Taskfile.yaml` and regenerate. `JobRun` stays hand-written: duty's `JobHistory` has no JSON tags.
