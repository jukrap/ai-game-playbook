export function snapshotExactDataRecord<const Key extends string>(
  value: unknown,
  expected: readonly Key[],
): Readonly<Record<Key, unknown>> | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const keys = [...expected].sort();
  if (
    actual.length !== keys.length ||
    actual.some((key, index) => key !== keys[index])
  ) {
    return undefined;
  }
  const snapshot = Object.create(null) as Record<Key, unknown>;
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return undefined;
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

export function snapshotDenseDataArray(
  value: unknown,
  maximumLength: number,
): readonly unknown[] | undefined {
  if (
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
