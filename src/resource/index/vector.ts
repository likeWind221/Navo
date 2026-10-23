import { EmbeddingError } from "../../embedding/errors.js";

export const VECTOR_ENCODING_VERSION = "float32le-l2-v1";

export function encodeVector(vector: readonly number[], dimension: number): Uint8Array {
  if (vector.length !== dimension || vector.some(value => !Number.isFinite(value))) invalid();
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) invalid();
  const bytes = Buffer.allocUnsafe(dimension * 4);
  for (let index = 0; index < dimension; index++) bytes.writeFloatLE(vector[index]! / norm, index * 4);
  return bytes;
}

export function decodeVector(value: Uint8Array, dimension: number): Float32Array {
  if (value.byteLength !== dimension * 4) invalid();
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  const result = new Float32Array(dimension);
  for (let index = 0; index < dimension; index++) {
    const component = bytes.readFloatLE(index * 4);
    if (!Number.isFinite(component)) invalid();
    result[index] = component;
  }
  return result;
}

export function dot(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) invalid();
  let result = 0;
  for (let index = 0; index < left.length; index++) result += left[index]! * right[index]!;
  return result;
}

function invalid(): never {
  throw new EmbeddingError("invalid-response", "Embedding vector is invalid.");
}
