import { expect, it, vi } from 'vitest';
import { inspectBindings, traceBinding } from './diagnostics.js';

const source = (expression: string) => ({
  file: 'app.tsx',
  line: 2,
  column: 3,
  expression,
  dependencies: ['model.title'],
});
it('aggregates evaluations by source, explains changes and retains only bounded metadata', () => {
  const inspector = inspectBindings({ limit: 2 });
  const changed = vi.fn();
  const stop = inspector.subscribe(changed);
  const value = { secret: 'never retained' };
  const decoratedSource = { ...source('title'), model: value };
  traceBinding(decoratedSource, undefined, [value], 'derive');
  expect(JSON.stringify(inspector.entries())).not.toContain('secret');
  traceBinding(source('title'), [value], ['changed'], 'binding');
  const entry = inspector.entries()[0]!;
  expect(entry).toEqual({
    source: source('title'),
    derives: 1,
    bindings: 1,
    changed: ['model.title'],
    reason: 'dependencies',
  });
  expect(JSON.stringify(inspector.entries())).not.toContain('secret');
  expect(Object.isFrozen(entry.source.dependencies)).toBe(true);
  traceBinding(source('second'), undefined, [value], 'binding');
  traceBinding(source('third'), undefined, [value], 'binding');
  expect(inspector.entries().map((entry) => entry.source.expression)).toEqual(['third', 'second']);
  expect(changed).toHaveBeenCalledTimes(4);
  stop();
  inspector.clear();
  expect(inspector.entries()).toEqual([]);
  inspector.dispose();
  traceBinding(source('after disposal'), undefined, [value], 'binding');
  expect(inspector.entries()).toEqual([]);
  expect(changed).toHaveBeenCalledTimes(4);
});
