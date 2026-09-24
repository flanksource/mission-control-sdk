import type {
  JsonSchemaObject,
  JsonSchemaProperty,
} from "@flanksource/clicky-ui/components";
import type { Playbook, PlaybookParameter } from "./index.js";

export function playbookLabel(playbook: Playbook): string {
  return playbook.title?.trim() || playbook.name;
}

export function staticParameters(playbook: Playbook): PlaybookParameter[] {
  const candidates = Array.isArray(playbook.parameters)
    ? playbook.parameters
    : playbook.spec?.parameters;
  return Array.isArray(candidates)
    ? candidates.filter(isPlaybookParameter)
    : [];
}

function isPlaybookParameter(value: unknown): value is PlaybookParameter {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

export function parameterDefaults(
  parameters: PlaybookParameter[],
): Record<string, unknown> {
  return Object.fromEntries(
    parameters.map((parameter) => [parameter.name, parameterDefault(parameter)]),
  );
}

function parameterDefault(parameter: PlaybookParameter): unknown {
  const type = parameterType(parameter);
  if (type === "boolean") {
    return parameter.default === true || parameter.default === "true";
  }
  if (parameter.default === undefined) return "";
  if (type === "number") {
    const value = finiteNumber(parameter.default);
    if (value !== undefined) return value;
  }
  if (typeof parameter.default === "string") return parameter.default;
  return JSON.stringify(parameter.default);
}

/** Mission Control marks number inputs with `properties.format: "number"`. */
function parameterType(parameter: PlaybookParameter): "boolean" | "number" | "string" {
  if (parameter.type === "checkbox") return "boolean";
  return parameter.properties?.format === "number" ? "number" : "string";
}

/** `properties.format` values Clicky's JsonSchemaForm renders; others are Mission Control-only. */
const FORM_FORMATS = new Set(["password", "date", "date-time", "textarea", "md"]);

/** Mission Control `properties` keys translated into JSON Schema below rather than copied. */
const TRANSLATED_PROPERTIES = new Set([
  "format",
  "options",
  "multiline",
  "regex",
  "min",
  "max",
  "minLength",
  "maxLength",
]);

export function parameterSchema(
  parameters: PlaybookParameter[],
): JsonSchemaObject {
  return {
    type: "object",
    properties: Object.fromEntries(
      parameters.map((parameter) => [parameter.name, parameterProperty(parameter)]),
    ),
    required: parameters
      .filter((parameter) => parameter.required)
      .map((parameter) => parameter.name),
    "x-order": parameters.map((parameter) => parameter.name),
  };
}

function parameterProperty(parameter: PlaybookParameter): JsonSchemaProperty {
  const metadata = parameter.properties ?? {};
  const format = typeof metadata.format === "string" ? metadata.format : undefined;
  const options = normalizeOptions(metadata.options);
  const type = parameterType(parameter);
  const property: JsonSchemaProperty = {
    ...Object.fromEntries(
      Object.entries(metadata).filter(([key]) => !TRANSLATED_PROPERTIES.has(key)),
    ),
    type,
    title: parameter.label || parameter.name,
    ...(parameter.description ? { description: parameter.description } : {}),
    ...(parameter.default !== undefined
      ? { default: parameterDefault(parameter) }
      : {}),
  };

  if (type === "string" && format && FORM_FORMATS.has(format)) property.format = format;
  if (parameter.type === "secret") property.format = "password";
  if (
    parameter.type === "code" ||
    metadata.multiline === true ||
    metadata.multiline === "true"
  ) {
    property.format = "textarea";
  }
  if (options.length > 0) {
    property.enum = options.map((option) => option.value);
    property["x-enum-labels"] = Object.fromEntries(
      options.map((option) => [option.value, option.label]),
    );
  }
  if (typeof metadata.regex === "string") property.pattern = metadata.regex;
  const minLength = finiteNumber(metadata.minLength);
  const maxLength = finiteNumber(metadata.maxLength);
  const minimum = finiteNumber(metadata.min);
  const maximum = finiteNumber(metadata.max);
  if (minLength !== undefined) property.minLength = minLength;
  if (maxLength !== undefined) property.maxLength = maxLength;
  if (type === "number" && minimum !== undefined) property.minimum = minimum;
  if (type === "number" && maximum !== undefined) property.maximum = maximum;
  return property;
}

function normalizeOptions(
  value: unknown,
): Array<{ value: string; label: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) => {
    if (
      typeof option === "string" ||
      typeof option === "number" ||
      typeof option === "boolean"
    ) {
      return [{ value: String(option), label: String(option) }];
    }
    if (!option || typeof option !== "object") return [];
    const item = option as {
      value?: unknown;
      id?: unknown;
      label?: unknown;
      name?: unknown;
    };
    const rawValue = item.value ?? item.id ?? item.name ?? item.label;
    if (rawValue === undefined) return [];
    const optionValue = String(rawValue);
    const optionLabel = item.label ?? item.name ?? optionValue;
    return [{ value: optionValue, label: String(optionLabel) }];
  });
}

function finiteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function requiredParametersPresent(
  parameters: PlaybookParameter[],
  values: Record<string, unknown>,
): boolean {
  return parameters
    .filter((parameter) => parameter.required)
    .every((parameter) => {
      const value = values[parameter.name];
      if (typeof value === "string") return value.trim() !== "";
      return value !== undefined && value !== null;
    });
}

/**
 * Converts form values into Mission Control run params. The server applies the
 * templated default to an omitted param but keeps an explicit "", so "" is sent
 * only for a param that has a default, meaning the user cleared it on purpose.
 */
export function serializeParameters(
  parameters: PlaybookParameter[],
  values: Record<string, unknown>,
): Record<string, string> {
  const defaulted = new Set(
    parameters
      .filter((parameter) => parameter.default !== undefined && parameter.default !== "")
      .map((parameter) => parameter.name),
  );
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => {
      if (value === undefined || value === null) return [];
      if (value === "") return defaulted.has(key) ? [[key, ""]] : [];
      if (typeof value === "object") return [[key, JSON.stringify(value)]];
      return [[key, String(value)]];
    }),
  );
}
