import { mountFixture } from './fixture';
import { mountScopedRendering } from './scopedRenderingFixture';

Object.assign(window, {
  snapshotBenchmark: { snapshot: mountFixture, rows: mountScopedRendering },
});
