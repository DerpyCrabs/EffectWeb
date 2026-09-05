import { mountFixture } from './fixture';

Object.assign(window, { snapshotBenchmark: { snapshot: mountFixture } });
