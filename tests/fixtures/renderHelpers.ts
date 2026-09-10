export function formatLabel(value: string) {
  return value.toUpperCase();
}

export function summarizeUser(model: {
  readonly label: string;
  readonly user: { readonly name: string } | null;
  readonly items: readonly string[];
}) {
  return `${model.label}:${model.user?.name ?? 'none'}:${model.items.length}`;
}

export function mapLabels(items: readonly string[], label: (value: string) => string) {
  return items.map(label).join(',');
}
