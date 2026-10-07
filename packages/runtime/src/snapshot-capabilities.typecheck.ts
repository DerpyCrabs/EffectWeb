import type { Snapshot, SnapshotOpaque } from './snapshot.js';
import type { Source } from './source.js';

// A plain method-based service keeps its callable capability under Snapshot.
// The opaque brand is unnecessary for this common service interface.
interface MethodService {
  read(): number;
  increment(): void;
}
export function methodServiceNeedsNoBrand(service: Snapshot<MethodService>): MethodService {
  return service;
}

// Mutable fields on a service illustrate what the brand actually changes.
interface MutableService extends SnapshotOpaque {
  pending: string[];
}
export function brandedServiceKeepsMutableApi(service: Snapshot<MutableService>): void {
  service.pending.push('work');
}
export function unbrandedDataRejectsMutation(data: Snapshot<{ pending: string[] }>): void {
  // @ts-expect-error Published plain data cannot be edited through the snapshot.
  const push: unknown = data.pending.push;
  void push;
}

// Structural readonly types cannot prevent the producer retaining a mutable alias.
export function readonlyAnnotationIsNotProtection(mutable: {
  pending: string[];
}): Snapshot<typeof mutable> {
  return mutable;
}

// Alternative: put mutable service access behind a callable accessor. This avoids
// branding but permits calls during render and supplies no ownership guarantee.
export function accessorAlternative(
  service: Snapshot<{ getService: () => { pending: string[] } }>,
): void {
  service.getService().pending.push('work');
}

export function sourceContractIsReadOnly(source: Source<{ count: number }>): void {
  // @ts-expect-error Sources have no update authority.
  const patch: unknown = source.patch;
  // @ts-expect-error Observation does not own the producer.
  const dispose: unknown = source.dispose;
  void patch;
  void dispose;
  // @ts-expect-error Current published data is immutable through the source.
  source.model().count = 1;
}
