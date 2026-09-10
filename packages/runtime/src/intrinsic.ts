import { compiledSlots } from './slotIdentity.js';
// Compiler implementation detail. An untyped receiver's method name is not
// evidence that it is a standard data operation. Validate its descriptor before
// invoking it, without running a user getter in the process.
const prototypes: object[] = [
  Array.prototype as object,
  String.prototype as object,
  Number.prototype as object,
  Boolean.prototype as object,
  BigInt.prototype as object,
  Function.prototype as object,
  Date.prototype as object,
  RegExp.prototype as object,
  Map.prototype as object,
  Set.prototype as object,
  URL.prototype as object,
  URLSearchParams.prototype as object,
  Blob.prototype as object,
  File.prototype as object,
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  Intl.DateTimeFormat.prototype as object,
  Intl.NumberFormat.prototype as object,
  Intl.Collator.prototype as object,
  Intl.RelativeTimeFormat.prototype as object,
  Intl.PluralRules.prototype as object,
  Intl.ListFormat.prototype as object,
  Intl.Segmenter.prototype as object,
];
const operations = new Map<string, PropertyDescriptor[]>();
for (const prototype of prototypes) {
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(prototype))) {
    if (name === 'constructor') continue;
    const entries = operations.get(name) ?? [];
    entries.push(descriptor);
    operations.set(name, entries);
  }
}

/** Preserve receiver identity and JavaScript call/optional-chain semantics. */
export function intrinsic<T>(receiver: T, path: readonly (string | null)[], method: string): T {
  checkPath(receiver, path, 0, method);
  return receiver;
}

function checkPath(
  target: unknown,
  path: readonly (string | null)[],
  index: number,
  method: string,
): void {
  if (target === null || target === undefined) return;
  if (index === path.length) {
    checkIntrinsic(target, method);
    return;
  }
  const field = path[index]!;
  if (field === null) {
    if (Array.isArray(target)) {
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(target))) {
        if (!/^(0|[1-9]\d*)$/u.test(key)) continue;
        if (!Object.hasOwn(descriptor, 'value'))
          throw new Error(
            'EffectWeb render data cannot use an array accessor. Pass immutable values.',
          );
        checkPath(descriptor.value as unknown, path, index + 1, method);
      }
    } else if (target instanceof Map) {
      for (const value of Map.prototype.values.call(target) as Iterable<unknown>)
        checkPath(value, path, index + 1, method);
    } else if (target instanceof Set) {
      for (const value of Set.prototype.values.call(target) as Iterable<unknown>)
        checkPath(value, path, index + 1, method);
    }
    return;
  }
  let object: object | null = Object(target) as object;
  while (object) {
    const descriptor = Object.getOwnPropertyDescriptor(object, field);
    if (descriptor) {
      if (Object.hasOwn(descriptor, 'value')) {
        checkPath(descriptor.value as unknown, path, index + 1, method);
      } else if (
        descriptor.get &&
        operations.get(field)?.some((operation) => operation.get === descriptor.get)
      ) {
        // Native getters are checked by identity before execution. File/Blob
        // metadata and collection sizes expose data through readonly accessors.
        checkPath(descriptor.get.call(target) as unknown, path, index + 1, method);
      } else {
        throw new Error(
          'EffectWeb render data cannot use an accessor to supply a standard data operation. Pass immutable data or a checked helper.',
        );
      }
      return;
    }
    object = Object.getPrototypeOf(object) as object | null;
  }
}

function checkIntrinsic(receiver: unknown, method: string): void {
  if (receiver === null || receiver === undefined) return;
  if (method === '@slot') {
    if (typeof receiver !== 'function' || !compiledSlots.has(receiver))
      throw new Error(
        'EffectWeb render callbacks must be compiled slots. Declare markup with slot(), or use a checked helper with an explicit purity contract.',
      );
    return;
  }
  let object: object | null = Object(receiver) as object;
  while (object) {
    const descriptor = Object.getOwnPropertyDescriptor(object, method);
    if (descriptor) {
      const known = operations
        .get(method)
        ?.some((operation) =>
          Object.hasOwn(descriptor, 'value')
            ? typeof descriptor.value === 'function' && descriptor.value === operation.value
            : descriptor.get !== undefined &&
              descriptor.get === operation.get &&
              descriptor.set === undefined,
        );
      if (!known)
        throw new Error(
          `EffectWeb cannot prove .${method} is a standard data operation. Use a checked local helper or an imported helper with a purity contract.`,
        );
      return;
    }
    object = Object.getPrototypeOf(object) as object | null;
  }
  // The original member call retains its own missing/optional-method behavior.
  return;
}
