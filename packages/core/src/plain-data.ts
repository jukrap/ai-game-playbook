import { isProxy } from "node:util/types";

type DataRecord = Readonly<Record<string, unknown>>;

function hasAllowedPrototype(
  value: object,
  allowNullPrototype: boolean,
): boolean {
  const prototype = Object.getPrototypeOf(value);
  return (
    prototype === Object.prototype ||
    (allowNullPrototype && prototype === null)
  );
}

export function snapshotEnumerableDataRecord(
  value: unknown,
  allowNullPrototype = false,
): DataRecord | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Array.isArray(value) ||
    !hasAllowedPrototype(value, allowNullPrototype) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return undefined;
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || descriptor.enumerable !== true) {
      return undefined;
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

export function snapshotExactDataRecord<const Key extends string>(
  value: unknown,
  keys: readonly Key[],
  allowNullPrototype = false,
): Readonly<Record<Key, unknown>> | undefined {
  const snapshot = snapshotEnumerableDataRecord(value, allowNullPrototype);
  if (snapshot === undefined) {
    return undefined;
  }
  const actual = Object.keys(snapshot).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return undefined;
  }
  return snapshot as Readonly<Record<Key, unknown>>;
}

export function snapshotDenseDataArray(
  value: unknown,
  maximumLength: number,
): readonly unknown[] | undefined {
  if (
    isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return undefined;
  }

  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor | undefined
  >;
  const lengthDescriptor = descriptors["length"];
  const lengthValue = lengthDescriptor?.value as unknown;
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.enumerable !== false ||
    typeof lengthValue !== "number" ||
    !Number.isSafeInteger(lengthValue) ||
    lengthValue < 0 ||
    lengthValue > maximumLength ||
    Object.keys(descriptors).length !== lengthValue + 1
  ) {
    return undefined;
  }

  const snapshot: unknown[] = [];
  for (let index = 0; index < lengthValue; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return undefined;
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}
