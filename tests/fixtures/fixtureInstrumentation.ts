/** Test instrumentation deliberately lives outside the render compiler's purity boundary. */
export const counters = { labels: 0 };
export const label = (text: string) => {
  counters.labels++;
  return text.toUpperCase();
};

export const identity = (counters: { identities: number }, id: number) => {
  counters.identities++;
  return id;
};
