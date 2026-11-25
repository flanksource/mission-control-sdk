import type { QueryParams } from "../core/types.js";

export type PluginComponentType = "panel" | "table" | "timeseries" | "action";

export type PluginOptions = {
  /** Catalog config the plugin operates on; sent as the `config_id` query parameter. */
  configId?: string;
};

export type PluginInvokeOptions = Omit<RequestInit, "body"> & {
  /** Use Mission Control's /proxy/:operation endpoint instead of /invoke/:operation. */
  proxy?: boolean;
};

export type PluginUIToken = {
  token: string;
  expiresInSeconds: number;
};

/** A handle for one plugin, optionally scoped to a catalog config. */
export type PluginClient = {
  pluginRef: string;
  configId?: string;
  /** Mint a UI invocation token as the current user; requires a scoped configId. */
  uiToken(options?: Pick<RequestInit, "signal">): Promise<PluginUIToken>;
  invoke(
    operation: string,
    bodyOrQueryParams?: unknown,
    options?: PluginInvokeOptions,
  ): Promise<Response>;
  stream(operation: string, query?: QueryParams): EventSource;
};

export type PluginManifest = {
  ref: string;
  name: string;
  version?: string;
  description?: string;
  operations?: PluginOperation[];
  components?: PluginComponent[];
};

export type PluginOperation = {
  name: string;
  method?: "GET" | "POST";
  streaming?: boolean;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

export type PluginComponent = {
  name: string;
  type: PluginComponentType;
  operation?: string;
};
