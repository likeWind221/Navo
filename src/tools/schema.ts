import type { JsonObject } from "../llm/types.js";
import type { ToolCallContentBlock } from "../llm/types.js";
import { ToolServiceError } from "./errors.js";
import type { ToolFailure } from "./types.js";

export type ParsedToolArguments =
  | { readonly kind: "success"; readonly arguments: JsonObject }
  | { readonly kind: "failure"; readonly failure: ToolFailure };

type JsonSchemaType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null";

const schemaTypes = new Set<JsonSchemaType>([
  "object", "array", "string", "number", "integer", "boolean", "null",
]);
const commonKeys = new Set(["type", "description", "enum"]);
const keysByType: Readonly<Record<JsonSchemaType, ReadonlySet<string>>> = {
  object: new Set([...commonKeys, "properties", "required", "additionalProperties"]),
  array: new Set([...commonKeys, "items"]),
  string: commonKeys,
  number: commonKeys,
  integer: commonKeys,
  boolean: commonKeys,
  null: commonKeys,
};

/** Snapshot and validate one model-facing object parameter schema. */
export function snapshotParameters(
  parameters: JsonObject,
  toolName: string,
): JsonObject {
  let snapshot: JsonObject;
  try {
    snapshot = deepFreeze(structuredClone(parameters));
  } catch (error: unknown) {
    throw invalidDefinition(
      `Tool '${toolName}' parameters must be structured-cloneable JSON.`,
      error,
    );
  }
  assertSupportedSchema(snapshot, `${toolName}.parameters`, true);
  return snapshot;
}

/** Parse raw model arguments and validate them against a registered schema. */
export function parseToolArguments(
  call: ToolCallContentBlock,
  schema: JsonObject,
): ParsedToolArguments {
  let candidate: unknown;
  try {
    candidate = JSON.parse(call.arguments) as unknown;
  } catch {
    return invalidArguments(call.name, "arguments are not valid JSON");
  }

  const violations: string[] = [];
  validateSchemaValue(schema, candidate, "$", violations);
  if (violations.length > 0) {
    return {
      kind: "failure",
      failure: {
        code: "invalid-arguments",
        message: `Invalid arguments for tool '${call.name}': ${violations.join("; ")}`,
        details: violations,
      },
    };
  }
  return {
    kind: "success",
    arguments: deepFreeze(structuredClone(candidate as JsonObject)),
  };
}

function invalidArguments(name: string, reason: string): ParsedToolArguments {
  return {
    kind: "failure",
    failure: {
      code: "invalid-arguments",
      message: `Tool '${name}' ${reason}.`,
    },
  };
}

function assertSupportedSchema(
  schema: unknown,
  path: string,
  root = false,
): asserts schema is JsonObject {
  if (!isRecord(schema)) {
    throw invalidDefinition(`${path} must be a JSON Schema object.`);
  }
  const type = schema.type;
  if (typeof type !== "string" || !schemaTypes.has(type as JsonSchemaType)) {
    throw invalidDefinition(`${path}.type must be one supported JSON Schema type.`);
  }
  const schemaType = type as JsonSchemaType;
  if (root && schemaType !== "object") {
    throw invalidDefinition(`${path} must have type 'object'.`);
  }
  for (const key of Object.keys(schema)) {
    if (!keysByType[schemaType].has(key)) {
      throw invalidDefinition(`${path}.${key} is not supported.`);
    }
  }
  if (schema.description !== undefined && typeof schema.description !== "string") {
    throw invalidDefinition(`${path}.description must be a string.`);
  }
  assertEnum(schema, schemaType, path);

  if (schemaType === "object") {
    assertObjectSchema(schema, path);
  } else if (schemaType === "array") {
    if (schema.items === undefined) {
      throw invalidDefinition(`${path}.items is required for array schemas.`);
    }
    assertSupportedSchema(schema.items, `${path}.items`);
  }
}

function assertEnum(
  schema: Record<string, unknown>,
  type: JsonSchemaType,
  path: string,
): void {
  if (schema.enum === undefined) return;
  if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
    throw invalidDefinition(`${path}.enum must be a non-empty array.`);
  }
  for (const value of schema.enum) {
    if (!matchesType(type, value)) {
      throw invalidDefinition(`${path}.enum contains a value outside type '${type}'.`);
    }
  }
}

function assertObjectSchema(schema: Record<string, unknown>, path: string): void {
  const properties = schema.properties ?? {};
  if (!isRecord(properties)) {
    throw invalidDefinition(`${path}.properties must be an object.`);
  }
  for (const [name, child] of Object.entries(properties)) {
    assertSupportedSchema(child, `${path}.properties.${name}`);
  }

  const required = schema.required ?? [];
  if (!Array.isArray(required) || required.some((name) => typeof name !== "string")) {
    throw invalidDefinition(`${path}.required must be an array of strings.`);
  }
  if (new Set(required).size !== required.length) {
    throw invalidDefinition(`${path}.required must not contain duplicates.`);
  }
  for (const name of required) {
    if (!Object.hasOwn(properties, name as string)) {
      throw invalidDefinition(`${path}.required references unknown property '${String(name)}'.`);
    }
  }
  if (schema.additionalProperties !== undefined
    && typeof schema.additionalProperties !== "boolean") {
    throw invalidDefinition(`${path}.additionalProperties must be a boolean.`);
  }
}

function validateSchemaValue(
  schema: JsonObject,
  value: unknown,
  path: string,
  violations: string[],
): void {
  const type = schema.type as JsonSchemaType;
  if (!matchesType(type, value)) {
    violations.push(`${path} must be ${article(type)}${type}`);
    return;
  }
  const enumValues = schema.enum;
  if (Array.isArray(enumValues)
    && !enumValues.some((item) => jsonEqual(item, value))) {
    violations.push(`${path} must be one of the declared enum values`);
    return;
  }
  if (type === "object") {
    validateObjectValue(schema, value as Record<string, unknown>, path, violations);
  } else if (type === "array") {
    const itemSchema = schema.items as JsonObject;
    for (const [index, item] of (value as unknown[]).entries()) {
      validateSchemaValue(itemSchema, item, `${path}[${index}]`, violations);
    }
  }
}

function validateObjectValue(
  schema: JsonObject,
  value: Record<string, unknown>,
  path: string,
  violations: string[],
): void {
  const properties = (schema.properties ?? {}) as Record<string, JsonObject>;
  for (const name of (schema.required ?? []) as string[]) {
    if (!Object.hasOwn(value, name)) violations.push(`${path}.${name} is required`);
  }
  for (const [name, child] of Object.entries(value)) {
    const childSchema = Object.hasOwn(properties, name) ? properties[name] : undefined;
    if (childSchema !== undefined) {
      validateSchemaValue(childSchema, child, `${path}.${name}`, violations);
    } else if (schema.additionalProperties === false) {
      violations.push(`${path}.${name} is not allowed`);
    }
  }
}

function matchesType(type: JsonSchemaType, value: unknown): boolean {
  switch (type) {
    case "object": return isRecord(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
  }
}

function article(type: JsonSchemaType): string {
  return ["object", "array", "integer"].includes(type) ? "an " : "a ";
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((item, index) => jsonEqual(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
      && keys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function invalidDefinition(message: string, cause?: unknown): ToolServiceError {
  return new ToolServiceError("invalid-tool-definition", message, { cause });
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value) as T;
}
