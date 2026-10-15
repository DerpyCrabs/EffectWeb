/** Validate page structure and return a compact cross-page reference index. */
export function indexPage(
  html: string,
  url: string,
): { readonly ids: ReadonlySet<string>; readonly references: readonly string[] };
