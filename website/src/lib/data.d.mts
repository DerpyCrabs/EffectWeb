export interface Page {
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly group: string;
  readonly body: string;
  readonly source?: string;
}
export interface RenderedPage extends Page {
  readonly slug: string;
  readonly html: string;
  readonly headings: readonly { id: string; title: string }[];
  readonly previous?: Page;
  readonly next?: Page;
}
export interface SearchEntry {
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly group: string;
  readonly text: string;
}
export interface Site {
  readonly pages: readonly RenderedPage[];
  readonly groups: readonly string[];
  readonly search: readonly SearchEntry[];
  readonly version: string;
  code(value: string, lang?: string): string;
}
export const repo: string;
export function site(): Promise<Site>;
