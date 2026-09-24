import { MissionControlError } from "./errors.js";
import type { QueryParams, QueryValue } from "./types.js";

const FALLBACK_BASE_URL = "http://mission-control-sdk.local";

/**
 * Builds a URL under baseUrl, returning a path when it resolves to the current origin.
 * Query keys are sent exactly as given; typed clients own any wire-name mapping.
 */
export function buildURL(baseUrl: string, path: string, query?: QueryParams): string {
  const url = new URL(joinURL(baseUrl, path), fallbackBaseURL());
  appendQuery(url.searchParams, query);
  return stripFallbackOrigin(url);
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) throw new MissionControlError("baseUrl is required");
  return trimTrailingSlash(trimmed);
}

export function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function requirePathSegment(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new MissionControlError(`${field} is required`);
  if (trimmed.includes("/")) throw new MissionControlError(`${field} must be a single path segment`);
  return trimmed;
}

export function isPlainQueryParams(value: unknown): value is QueryParams {
  if (!value || typeof value !== "object") return false;
  if (isBodyInit(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

export function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === "string" ||
    (typeof Blob !== "undefined" && value instanceof Blob) ||
    (typeof FormData !== "undefined" && value instanceof FormData) ||
    (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams) ||
    (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) ||
    (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) ||
    (typeof ReadableStream !== "undefined" && value instanceof ReadableStream)
  );
}

function appendQuery(searchParams: URLSearchParams, query?: QueryParams): void {
  if (!query) return;

  for (const [key, value] of Object.entries(query)) {
    for (const item of queryValues(value)) {
      if (item === null || item === undefined) continue;
      searchParams.append(key, String(item));
    }
  }
}

function queryValues(value: QueryValue | readonly QueryValue[]): readonly QueryValue[] {
  return isQueryValueArray(value) ? value : [value];
}

function isQueryValueArray(value: QueryValue | readonly QueryValue[]): value is readonly QueryValue[] {
  return Array.isArray(value);
}

function trimTrailingSlash(value: string): string {
  const trimmed = value.trim();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "/") end--;
  return trimmed.slice(0, end);
}

function joinURL(base: string, path: string): string {
  return `${trimTrailingSlash(base)}/${path.replace(/^\/+/, "")}`;
}

function fallbackBaseURL(): string {
  if (typeof window !== "undefined") return window.location.href;
  return FALLBACK_BASE_URL;
}

function stripFallbackOrigin(url: URL): string {
  if (url.origin === FALLBACK_BASE_URL) {
    return `${url.pathname}${url.search}`;
  }

  if (typeof window !== "undefined" && url.origin === window.location.origin) {
    return `${url.pathname}${url.search}`;
  }

  return url.toString();
}
