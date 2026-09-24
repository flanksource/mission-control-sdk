export type QueryValue = string | number | boolean | null | undefined;

export type QueryParams = Record<string, QueryValue | readonly QueryValue[]>;

export type ConnectionMode = "pass-through" | "proxy";

export type MissionControlClientOptions = {
  mode: ConnectionMode;
  baseUrl: string;
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
};

export type MissionControlRequestOptions = Omit<RequestInit, "body"> & {
  query?: QueryParams;
  /** A `BodyInit` is sent as-is; anything else is JSON-encoded. */
  body?: unknown;
};
