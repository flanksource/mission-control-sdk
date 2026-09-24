import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  DropdownMenu,
  JsonSchemaForm,
  Loading,
  Modal,
  type DropdownMenuItem,
} from "@flanksource/clicky-ui/components";
import {
  Callout,
  LogsTable,
  WorkloadCard,
  type GaugeSeries,
  type WorkloadCardMetrics,
  type WorkloadCardResourceMetric,
  type WorkloadCardSize,
  type WorkloadCardVariant,
  type WorkloadCardWorkload,
} from "@flanksource/clicky-ui/data";
import type {
  MissionControlPlaybooksClient,
  Playbook,
  PlaybookParameter,
  PlaybookRunResponse,
} from "./index.js";
import {
  parameterDefaults,
  parameterSchema,
  playbookLabel,
  requiredParametersPresent,
  serializeParameters,
  staticParameters,
} from "./playbook-form.js";

/**
 * This entry point owns the workload loader contract, the actions menu and
 * logs. Rendering, caching and polling are delegated to Clicky's WorkloadCard;
 * callers own resource discovery, authentication, and backend-specific queries.
 */

/**
 * The workload a panel describes: Clicky's workload card fields (name, `type`
 * or Kubernetes `kind`, icon, namespace, replicas, `metadata`, status) plus a
 * stable `id`.
 */
export interface WorkloadDescriptor extends WorkloadCardWorkload {
  /**
   * Stable identity of the workload. It is also the cache identity of its
   * metrics: panels that share an id share cached series, so an id must always
   * map to the same data sources.
   */
  id: string;
}

export type WorkloadMetricPoint = {
  at: string;
  value: number;
};

export type WorkloadMetricSeries = {
  points: WorkloadMetricPoint[];
};

export type WorkloadMetricRequest = {
  workload: WorkloadDescriptor;
  /** Look-back window, e.g. "1h". */
  range: string;
  /** Aborted when the request is no longer needed, e.g. the panel unmounts. */
  signal: AbortSignal;
};

export type WorkloadMetricLoader = (
  request: WorkloadMetricRequest,
) => Promise<WorkloadMetricSeries>;

export type WorkloadMetric = {
  usage: WorkloadMetricLoader;
  /** A loader, or a fixed capacity in the metric's unit. */
  capacity?: WorkloadMetricLoader | number;
  title?: string;
  /** Utilisation percentages at which the fill turns warning, then danger. */
  thresholds?: [warning: number, danger: number];
};

export type WorkloadMetrics = {
  /** CPU loaders return cores. */
  cpu?: WorkloadMetric;
  /** Memory loaders return bytes. */
  memory?: WorkloadMetric;
  /** Disk loaders return bytes. */
  disk?: WorkloadMetric;
};

export type ClickyMetricUnit = "cores" | "millicores" | "bytes";

export type ClickyMetricFetcher = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<WorkloadMetricSeries>;

export type ClickyMetricLoaderOptions = {
  unit: ClickyMetricUnit;
};

/**
 * Adapts Clicky's `GET <baseUrl>/<metricId>?since=<range>` endpoint to the
 * workload loader contract, including named source-unit conversion for CPU
 * collectors that store millicores. The metric id is either fixed or derived
 * from the workload being displayed.
 */
export function createClickyMetricLoader({
  baseUrl,
  fetcher = fetchClickyMetric,
}: {
  baseUrl: string;
  fetcher?: ClickyMetricFetcher;
}) {
  const metricBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  return (
    metricId: string | ((workload: WorkloadDescriptor) => string),
    { unit }: ClickyMetricLoaderOptions,
  ): WorkloadMetricLoader =>
    async ({ workload, range, signal }) => {
      const id = typeof metricId === "function" ? metricId(workload) : metricId;
      const query = new URLSearchParams({ since: range });
      const series = await fetcher(
        `${metricBaseUrl}${encodeURIComponent(id)}?${query}`,
        { signal },
      );
      return scalePoints(series.points, unit === "millicores" ? 1 / 1000 : 1);
    };
}

export type WorkloadPanelLogs = {
  load: (request: {
    workload: WorkloadDescriptor;
    signal: AbortSignal;
  }) => Promise<string | Array<string | Record<string, unknown>>>;
  title?: string;
};

export type WorkloadPanelPlaybooks = {
  client: MissionControlPlaybooksClient;
  configId?: string;
  onRunStarted?: (response: PlaybookRunResponse, playbook: Playbook) => void;
};

export interface WorkloadPanelProps {
  workload: WorkloadDescriptor;
  metrics: WorkloadMetrics;
  logs?: WorkloadPanelLogs;
  /** Host-owned actions menu items, listed before the built-in Logs item. */
  actions?: DropdownMenuItem[];
  playbooks?: WorkloadPanelPlaybooks;
  range?: string;
  refreshMs?: number;
  expandable?: boolean;
  size?: WorkloadCardSize;
  variant?: WorkloadCardVariant;
  className?: string;
}

type LoadState = "idle" | "loading" | "ready" | "error";

type LogsState =
  | { status: "loading" }
  | { status: "ready"; data: string | Array<string | Record<string, unknown>> }
  | { status: "error"; message: string };

const METRIC_NAMES = ["cpu", "memory", "disk"] as const;
type MetricName = (typeof METRIC_NAMES)[number];

// WorkloadCard's CPU bars read millicores (one bar per 1000); the panel's public
// contract is cores, so CPU series and fixed capacities are scaled on the way in.
const CARD_SCALE: Record<MetricName, number> = { cpu: 1000, memory: 1, disk: 1 };

// Millicores in Kubernetes notation ("1,500m") for the history chart, which has
// no dedicated CPU formatter.
const CPU_HISTORY_UNIT = "m";

/**
 * Displays CPU, memory, disk, state, history, and logs for an application-
 * defined workload without imposing a metrics or infrastructure backend.
 *
 * Needs `@flanksource/clicky-ui/styles.css` and a `QueryClientProvider` from
 * the host's `@tanstack/react-query` peer dependency.
 */
export function WorkloadPanel(props: WorkloadPanelProps) {
  // Keying on the workload id resets every target-bound piece of state (open
  // dialogs, loaded logs) and aborts in-flight log loads when the target changes.
  return <WorkloadPanelView key={props.workload.id} {...props} />;
}

function WorkloadPanelView({
  workload,
  metrics,
  logs,
  actions,
  playbooks,
  range = "1h",
  refreshMs = 5000,
  expandable = true,
  size,
  variant,
  className,
}: WorkloadPanelProps) {
  const [playbookState, setPlaybookState] = useState<LoadState>("idle");
  const [availablePlaybooks, setAvailablePlaybooks] = useState<Playbook[]>([]);
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook>();
  const [parameters, setParameters] = useState<PlaybookParameter[]>([]);
  const [parameterState, setParameterState] = useState<LoadState>("idle");
  const [parameterError, setParameterError] = useState<string>();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [runError, setRunError] = useState<string>();
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsState, setLogsState] = useState<LogsState>({ status: "loading" });
  const playbookClient = playbooks?.client;
  const playbookConfigId = playbooks?.configId;
  const onRunStarted = playbooks?.onRunStarted;
  const targetToken = useMemo(
    () => Symbol("workload-panel-target"),
    [playbookClient, playbookConfigId, workload.id],
  );
  const activeTargetToken = useRef(targetToken);
  const selectedTargetToken = useRef<symbol | undefined>(undefined);
  const parameterTargetToken = useRef<symbol | undefined>(undefined);
  const playbookLoadingTarget = useRef<symbol | undefined>(undefined);
  const submittingTarget = useRef<symbol | undefined>(undefined);
  const logsRequest = useRef<AbortController | null>(null);
  const cardMetrics = useMemo(
    () => toCardMetrics(workload, metrics),
    [workload, metrics],
  );

  useLayoutEffect(() => {
    activeTargetToken.current = targetToken;
    selectedTargetToken.current = undefined;
    parameterTargetToken.current = undefined;
    logsRequest.current?.abort();
    setPlaybookState("idle");
    setAvailablePlaybooks([]);
    setSelectedPlaybook(undefined);
    setParameters([]);
    setParameterState("idle");
    setParameterError(undefined);
    setValues({});
    setSubmitting(false);
    setRunError(undefined);
    setLogsOpen(false);
    setLogsState({ status: "loading" });
    return () => {
      activeTargetToken.current = Symbol("inactive-workload-panel");
      logsRequest.current?.abort();
    };
  }, [targetToken]);

  useEffect(() => {
    if (!selectedPlaybook || !playbookClient) return;
    if (selectedTargetToken.current !== targetToken) return;
    let cancelled = false;
    const fallback = staticParameters(selectedPlaybook);
    parameterTargetToken.current = undefined;
    setParameterState("loading");
    setParameterError(undefined);
    setRunError(undefined);
    setValues(parameterDefaults(fallback));

    playbookClient
      .parameters(
        selectedPlaybook.id,
        playbookConfigId ? { config_id: playbookConfigId } : {},
      )
      .then((resolved) => {
        if (
          cancelled ||
          activeTargetToken.current !== targetToken ||
          selectedTargetToken.current !== targetToken
        ) {
          return;
        }
        setParameters(resolved);
        setValues(parameterDefaults(resolved));
        parameterTargetToken.current = targetToken;
        setParameterState("ready");
      })
      .catch((error: unknown) => {
        if (
          cancelled ||
          activeTargetToken.current !== targetToken ||
          selectedTargetToken.current !== targetToken
        ) {
          return;
        }
        setParameters(fallback);
        setParameterError(errorMessage(error));
        parameterTargetToken.current = targetToken;
        setParameterState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [playbookClient, playbookConfigId, selectedPlaybook, targetToken]);

  const schema = useMemo(() => parameterSchema(parameters), [parameters]);

  async function loadPlaybooks() {
    if (!playbookClient || playbookLoadingTarget.current === targetToken) return;
    playbookLoadingTarget.current = targetToken;
    setPlaybookState("loading");
    try {
      const resolved = await playbookClient.list(playbookConfigId);
      if (activeTargetToken.current !== targetToken) return;
      setAvailablePlaybooks(resolved);
      setPlaybookState("ready");
    } catch {
      if (activeTargetToken.current !== targetToken) return;
      setPlaybookState("error");
    } finally {
      if (playbookLoadingTarget.current === targetToken) {
        playbookLoadingTarget.current = undefined;
      }
    }
  }

  async function openLogs() {
    if (!logs) return;
    logsRequest.current?.abort();
    const request = new AbortController();
    logsRequest.current = request;
    setLogsOpen(true);
    setLogsState({ status: "loading" });
    try {
      const data = await logs.load({ workload, signal: request.signal });
      if (!request.signal.aborted) setLogsState({ status: "ready", data });
    } catch (error) {
      if (!request.signal.aborted) {
        setLogsState({ status: "error", message: errorMessage(error) });
      }
    }
  }

  function closeLogs() {
    logsRequest.current?.abort();
    setLogsOpen(false);
  }

  async function runSelectedPlaybook() {
    if (
      !selectedPlaybook ||
      !playbookClient ||
      selectedTargetToken.current !== targetToken ||
      parameterTargetToken.current !== targetToken ||
      (parameterState !== "ready" && parameterState !== "error") ||
      submittingTarget.current === targetToken
    ) {
      return;
    }
    submittingTarget.current = targetToken;
    setSubmitting(true);
    setRunError(undefined);
    try {
      const response = await playbookClient.run({
        id: selectedPlaybook.id,
        ...(playbookConfigId ? { config_id: playbookConfigId } : {}),
        params: serializeParameters(parameters, values),
      });
      if (activeTargetToken.current !== targetToken) return;
      onRunStarted?.(response, selectedPlaybook);
      selectedTargetToken.current = undefined;
      parameterTargetToken.current = undefined;
      setSelectedPlaybook(undefined);
    } catch (error) {
      if (activeTargetToken.current !== targetToken) return;
      setRunError(errorMessage(error));
    } finally {
      if (submittingTarget.current === targetToken) {
        submittingTarget.current = undefined;
        if (activeTargetToken.current === targetToken) setSubmitting(false);
      }
    }
  }

  function closePlaybook() {
    if (submitting) return;
    selectedTargetToken.current = undefined;
    parameterTargetToken.current = undefined;
    setSelectedPlaybook(undefined);
  }

  const menuItems: DropdownMenuItem[] = [...(actions ?? [])];
  if (logs) {
    menuItems.push({
      label: "Logs",
      group: "View",
      onSelect: () => void openLogs(),
    });
  }
  if (playbooks) {
    if (playbookState === "ready" && availablePlaybooks.length > 0) {
      menuItems.push(
        ...availablePlaybooks.map((playbook) => ({
          label: playbookLabel(playbook),
          ...(playbook.icon ? { icon: playbook.icon } : {}),
          group: "Playbooks",
          onSelect: () => {
            selectedTargetToken.current = targetToken;
            parameterTargetToken.current = undefined;
            setSelectedPlaybook(playbook);
          },
        })),
      );
    } else {
      menuItems.push({
        label:
          playbookState === "loading"
            ? "Loading playbooks…"
            : playbookState === "error"
              ? "Retry loading playbooks"
              : playbookState === "ready"
                ? "No playbooks available"
                : "Load playbooks",
        group: "Playbooks",
        disabled: playbookState === "loading" || playbookState === "ready",
        onSelect: () => void loadPlaybooks(),
      });
    }
  }

  return (
    <>
      <WorkloadCard
        workload={workload}
        metrics={cardMetrics}
        range={range}
        refreshMs={refreshMs}
        expandable={expandable}
        {...(size ? { size } : {})}
        {...(variant ? { variant } : {})}
        {...(className ? { className } : {})}
        headerActions={
          menuItems.length > 0 ? (
            <DropdownMenu
              align="right"
              menuLabel={`${workload.name} actions`}
              items={menuItems}
              onOpenChange={(open: boolean) => {
                if (open && playbookClient && playbookState === "idle") {
                  void loadPlaybooks();
                }
              }}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Open ${workload.name} actions`}
                  title="Actions"
                  style={{ width: 24, height: 24 }}
                >
                  <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>
                    ⋯
                  </span>
                </Button>
              }
            />
          ) : null
        }
      />

      <Modal
        open={logsOpen}
        onClose={closeLogs}
        title={logs?.title ?? `${workload.name} logs`}
        size="2xl"
        scrollBody={false}
      >
        <div style={{ display: "flex", minHeight: 360, height: "65vh" }}>
          {logsState.status === "loading" ? (
            <Loading label="Loading logs" />
          ) : logsState.status === "error" ? (
            <div role="alert" style={{ flex: 1 }}>
              <Callout variant="caution" title="Logs could not be loaded">
                {logsState.message}
              </Callout>
            </div>
          ) : (
            <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
              <LogsTable logs={logsState.data} />
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={selectedPlaybook !== undefined}
        onClose={closePlaybook}
        title={
          selectedPlaybook
            ? `Run ${playbookLabel(selectedPlaybook)}`
            : "Run playbook"
        }
        size="lg"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void runSelectedPlaybook();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          {parameterState === "loading" ? (
            <Loading label="Loading parameters" />
          ) : (
            <JsonSchemaForm
              schema={schema}
              value={values}
              onChange={setValues}
            />
          )}
          {parameterError ? (
            <Callout variant="caution" title="Live parameters unavailable">
              {parameterError}
            </Callout>
          ) : null}
          {runError ? (
            <Callout variant="caution" title="Playbook could not be started">
              {runError}
            </Callout>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              type="button"
              variant="outline"
              onClick={closePlaybook}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={submitting}
              loadingLabel={submitting ? "Starting…" : undefined}
              disabled={
                submitting ||
                parameterTargetToken.current !== targetToken ||
                (parameterState !== "ready" && parameterState !== "error") ||
                !requiredParametersPresent(parameters, values)
              }
            >
              Run
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/**
 * Maps the panel's loader contract onto Clicky's function-backed series. Series
 * ids are `plugin-ui-sdk/workload/<workload id>/<metric>/<usage|capacity>`;
 * Clicky caches loaded series by that id.
 */
function toCardMetrics(
  workload: WorkloadDescriptor,
  metrics: WorkloadMetrics,
): WorkloadCardMetrics {
  const card: WorkloadCardMetrics = {};
  for (const name of METRIC_NAMES) {
    const metric = metrics[name];
    if (!metric) continue;
    const scale = CARD_SCALE[name];
    const { capacity } = metric;
    const resource: WorkloadCardResourceMetric = {
      value: loadedSeries(workload, name, "usage", metric.usage, scale),
      maxLabel: "capacity",
      ...(typeof capacity === "function"
        ? { max: loadedSeries(workload, name, "capacity", capacity, scale) }
        : capacity !== undefined
          ? { max: capacity * scale }
          : {}),
      ...(metric.title ? { title: metric.title } : {}),
      ...(metric.thresholds ? { thresholds: metric.thresholds } : {}),
      ...(name === "cpu" ? { unit: CPU_HISTORY_UNIT } : {}),
    };
    card[name] = resource;
  }
  return card;
}

function loadedSeries(
  workload: WorkloadDescriptor,
  name: MetricName,
  part: "usage" | "capacity",
  loader: WorkloadMetricLoader,
  scale: number,
): GaugeSeries {
  const id = `plugin-ui-sdk/workload/${workload.id}/${name}/${part}`;
  return {
    id,
    load: async ({ range, signal }) => {
      const series = await loader({ workload, range, signal });
      return { id, ...scalePoints(series.points, scale) };
    },
  };
}

function scalePoints(
  points: WorkloadMetricPoint[],
  scale: number,
): WorkloadMetricSeries {
  return {
    points:
      scale === 1
        ? points
        : points.map((point) => ({ ...point, value: point.value * scale })),
  };
}

async function fetchClickyMetric(
  url: string,
  { signal }: { signal: AbortSignal },
): Promise<WorkloadMetricSeries> {
  const response = await fetch(url, { credentials: "same-origin", signal });
  if (!response.ok) {
    throw new Error(`Metric request failed: ${response.status}`);
  }
  return response.json() as Promise<WorkloadMetricSeries>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
