import { isProxy } from "node:util/types";

export function snapshotOptionalDataRecord<const Key extends string>(
  value: unknown,
  allowedKeys: readonly Key[],
): Readonly<Partial<Record<Key, unknown>>> | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return undefined;
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set<string>(allowedKeys);
  const snapshot = Object.create(null) as Partial<Record<Key, unknown>>;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (
      !allowed.has(key) ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return undefined;
    }
    snapshot[key as Key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

export function snapshotDenseDataArray(
  value: unknown,
  maximumLength: number,
): readonly unknown[] | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
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
  const length = lengthDescriptor?.value as unknown;
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.enumerable !== false ||
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximumLength ||
    Object.keys(descriptors).length !== length + 1
  ) {
    return undefined;
  }

  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
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
