// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import {
  packedComposedMounts,
  packedComposedErrors,
  packedRouter,
} from '../fixtures/packedAdaptersFixture';

test('packed consumer fixture joins composed lifetimes and renders a scoped router', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  try {
    expect(await packedComposedMounts(host)).toEqual({
      pendingBoth: true,
      pendingReplaced: true,
      detached: true,
      released: ['current', 'replaced'],
    });
    expect(await packedComposedErrors(host)).toEqual({
      observed: 'application',
      errors: [expect.stringContaining('packed child failed')],
      detached: true,
    });
    expect(await packedRouter(host)).toEqual({
      before: 'nested home',
      after: 'nested next',
      initialPath: '/',
      finalPath: '/next',
      published: true,
      detached: true,
      historySubscriptions: 0,
      refused: true,
      unchangedAfterClose: true,
    });
  } finally {
    host.remove();
  }
});
