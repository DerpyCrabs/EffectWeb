import { describe, expect, it } from 'vitest';
import { Cause, Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { modelOwner } from './owner.js';
import { program } from './program.js';

describe('published snapshot protection', () => {
  it('rejects nested mutation through retained inputs and subscriber values', () => {
    const initial = { items: [{ text: 'before' }] };
    const app = modelOwner(initial);
    try {
      expect(() => initial.items.push({ text: 'bad' })).toThrow(TypeError);
      expect(() => {
        initial.items[0]!.text = 'bad';
      }).toThrow(TypeError);
      const seen: string[] = [];
      app.source.subscribe((model) => {
        expect(() => {
          // @ts-expect-error Runtime guard also catches untyped mutations.
          model.items[0]!.text = 'bad';
        }).toThrow(TypeError);
        seen.push(model.items[0]!.text);
      });
      app.edit('items', (items) => items.map((item) => ({ ...item, text: 'after' })));
      expect(seen).toEqual(['after']);
      expect(app.read().items[0]!.text).toBe('after');
    } finally {
      app.dispose();
    }
  });

  it('protects reducers before they can mutate and keeps the last valid model', () => {
    const app = program({
      initial: { values: [1] },
      update(model, _message: void) {
        // @ts-expect-error Runtime guard also catches untyped mutations.
        // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
        model.values.push(2);
        return { model };
      },
    });
    try {
      expect(() => app.send()).toThrow(TypeError);
      expect(app.model().values).toEqual([1]);
    } finally {
      app.dispose();
    }
  });

  it('protects staged transaction reads and rolls back a mutation failure', () => {
    const app = modelOwner({ record: { count: 0 } });
    try {
      expect(() =>
        app.transaction(() => {
          app.patch({ record: { count: 1 } });
          // @ts-expect-error Runtime guard also catches untyped mutations.
          app.read().record.count++;
        }),
      ).toThrow(TypeError);
      expect(app.read().record.count).toBe(0);
      app.patch({ record: { count: 2 } });
      expect(app.read().record.count).toBe(2);
    } finally {
      app.dispose();
    }
  });

  it('preserves opaque instances', () => {
    class Service {
      count = 0;
      increment() {
        this.count++;
      }
    }
    const service = new Service();
    const effect = Effect.succeed(1);
    const app = modelOwner({ service, effect });
    try {
      app.read().service.increment();
      expect(service.count).toBe(1);
      expect(app.read().effect).toBe(effect);
      expect(Effect.runSync(effect)).toBe(1);
      expect(Object.isFrozen(service)).toBe(false);
    } finally {
      app.dispose();
    }
  });

  it('rejects accessor-backed snapshot data without executing the getter', () => {
    let reads = 0;
    const record = {
      get current() {
        reads++;
        return 1;
      },
    };
    expect(() => modelOwner({ record })).toThrow(/accessor/u);
    expect(() => modelOwner({ record })).toThrow(/accessor/u);
    expect(reads).toBe(0);
  });

  it('checks symbol fields, cyclic data, and already frozen parent records', () => {
    const key = Symbol('data');
    const child = { value: 1 };
    const root: { self?: unknown; [key]: typeof child } = { [key]: child };
    root.self = root;
    Object.freeze(root);
    const app = modelOwner(root);
    try {
      expect(() => {
        child.value = 2;
      }).toThrow(TypeError);
    } finally {
      app.dispose();
    }
  });

  it('protects query successes and retained data after failed refreshes', () => {
    const success = AsyncResult.success([{ text: 'cached' }]);
    const failure = AsyncResult.failure(Cause.fail('offline'), {
      previousSuccess: Option.some(AsyncResult.success([{ text: 'retained' }])),
    });
    const app = modelOwner({ success, failure });
    try {
      expect(() => {
        success.value[0]!.text = 'bad';
      }).toThrow(TypeError);
      const retained = Option.getOrThrow(AsyncResult.value(failure));
      expect(() => {
        retained[0]!.text = 'bad';
      }).toThrow(TypeError);
      expect(app.read().success).toBe(success);
      expect(app.read().failure).toBe(failure);
      expect(Object.isFrozen(success)).toBe(false);
    } finally {
      app.dispose();
    }
  });

  it('protects inputs while preserving shared references', () => {
    const data = { nested: { count: 0 } };
    const app = modelOwner(data);
    try {
      expect(Object.isFrozen(data)).toBe(true);
      app.patch({ nested: data.nested });
      expect(app.read()).toBe(data);
      app.edit('nested', (nested) => nested);
      expect(app.read()).toBe(data);
    } finally {
      app.dispose();
    }
  });
});
