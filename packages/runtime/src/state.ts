/** Shallow immutable update; unchanged fields preserve identity and skip publication. */
export function patchModel<Model extends object>(
  model: Model,
  patch: Partial<NoInfer<Model>>,
): Model {
  return (Reflect.ownKeys(patch) as (keyof Model)[]).some(
    (key) =>
      Object.prototype.propertyIsEnumerable.call(patch, key) &&
      (!Object.hasOwn(model, key) || !Object.is(model[key], patch[key])),
  )
    ? { ...model, ...patch }
    : model;
}
