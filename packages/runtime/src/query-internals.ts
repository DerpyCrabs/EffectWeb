import type { Effect } from 'effect';
import type { Snapshot } from './snapshot.js';
import type { Query, QueryGroup } from './query.js';

export interface QueryDefinition<Args, A, E, R> {
  readonly name: string;
  readonly load: (args: Snapshot<Args>, previous?: Snapshot<A>) => Effect.Effect<A, E, R>;
  readonly groups?: readonly QueryGroup[];
  readonly unused?: 'retain' | 'cancel';
  readonly staleTime: number;
  readonly share?: (previous: Snapshot<A>, next: A | Snapshot<A>) => A | Snapshot<A>;
}
const definitions = new WeakMap<object, unknown>();
export function registerQuery<Args, A, E, R>(
  query: Query<Args, A, E, R>,
  definition: QueryDefinition<Args, A, E, R>,
): void {
  definitions.set(query, definition);
}
export function queryDefinition<Args, A, E, R>(
  query: Query<Args, A, E, R>,
): QueryDefinition<Args, A, E, R> {
  const definition = definitions.get(query);
  if (!definition) throw new TypeError('Use query() to create a query definition.');
  return definition as QueryDefinition<Args, A, E, R>;
}
