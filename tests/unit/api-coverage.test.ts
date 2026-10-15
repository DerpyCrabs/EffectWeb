import { expect, it } from 'vitest';
import { apiCoverageProblems } from '../../website/lib/api-coverage.mjs';

it('documents every public export before the API reference is generated', () => {
  expect(apiCoverageProblems()).toEqual([]);
});
