export function patchModel<Model extends object>(
  model: Model,
  patch: Partial<NoInfer<Model>>,
  merge?: (model: Model, patch: Partial<NoInfer<Model>>) => Model,
): Model {
  return (Reflect.ownKeys(patch) as (keyof Model)[]).some(
    (key) =>
      Object.prototype.propertyIsEnumerable.call(patch, key) &&
      (!Object.hasOwn(model, key) || !Object.is(model[key], patch[key])),
  )
    ? merge
      ? merge(model, { ...patch })
      : { ...model, ...patch }
    : model;
}
