// A bounded publication-pipeline experiment, not a DOM or whole-framework benchmark.
// Usage: node scripts/compare-snapshot-pipelines.mjs /path/to/@solidjs/signals/dist/prod/index.js
import assert from 'node:assert/strict';
import { resolve, dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { modelOwner } from '../packages/runtime/dist/owner.js';
import { Scope } from '../packages/runtime/dist/dom.js';

assert.ok(process.argv[2], 'Supply the production @solidjs/signals entry path.');
const entry = resolve(process.argv[2]);
const solid = await import(pathToFileURL(entry).href);
let directory = dirname(entry);
while (!existsSync(join(directory, 'package.json'))) {
  const parent = dirname(directory);
  assert.notEqual(parent, directory, 'Could not identify the Solid signals package.');
  directory = parent;
}
const solidPackage = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
const steps = 200;
const samples = 11;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const report = {
  solid: `${solidPackage.name}@${solidPackage.version}`,
  steps,
  samples,
  scope:
    'Same EffectWeb modelOwner, immutable snapshots, scalar sinks; no DOM, stores, proxies, or official adapter.',
  results: [],
};

function measure(kind, initial, publications, burst) {
  const source = modelOwner(initial);
  const sink = Array(initial.rows.length);
  let writes = 0;
  let dispose;
  if (kind.startsWith('effectweb-')) {
    const scope = new Scope(
      source.read(),
      () => {},
      (error) => {
        throw error;
      },
    );
    for (let index = 0; index < sink.length; index++) {
      scope.watch(
        () => [scope.value.rows[index]],
        () => {
          sink[index] = scope.value.rows[index];
          writes++;
        },
      );
    }
    const unsubscribe = source.source.subscribe((model) => scope.set(model));
    dispose = () => {
      unsubscribe();
      scope.dispose();
    };
  } else {
    dispose = solid.createRoot((stop) => {
      const [model, setModel] = solid.createSignal(source.read());
      solid.onCleanup(source.source.subscribe((next) => setModel(next)));
      for (let index = 0; index < sink.length; index++) {
        const selected = solid.createMemo(() => model().rows[index]);
        solid.createEffect(selected, (value) => {
          sink[index] = value;
          writes++;
        });
      }
      return stop;
    });
    solid.flush();
  }
  assert.deepEqual(sink, initial.rows);
  writes = 0;
  const start = performance.now();
  const publish = () => {
    for (const publication of publications) {
      source.patch(publication);
      if (kind === 'solid-signal-bridge' && !burst) solid.flush();
    }
  };
  if (kind === 'effectweb-transaction') source.transaction(publish);
  else publish();
  if (kind === 'solid-signal-bridge') solid.flush();
  const milliseconds = performance.now() - start;
  assert.deepEqual(sink, publications.at(-1).rows);
  const changed = publications.at(-1).rows[0] !== initial.rows[0];
  assert.equal(
    writes,
    changed
      ? (kind === 'solid-signal-bridge' && burst) || kind === 'effectweb-transaction'
        ? 1
        : publications.length
      : 0,
    'Both pipelines must suppress unchanged scalar sinks.',
  );
  const committedWrites = writes;
  dispose();
  source.patch(initial);
  solid.flush();
  assert.equal(writes, committedWrites, 'Disposed bindings received a publication.');
  source.dispose();
  return { milliseconds, writes };
}

for (const bindings of [100, 1000, 10000]) {
  for (const workload of ['single-row', 'unrelated', 'burst']) {
    const initial = { rows: Array(bindings).fill(0), tick: 0 };
    const publications = Array.from({ length: steps }, (_, index) => {
      const rows = workload === 'unrelated' ? initial.rows : initial.rows.with(0, index + 1);
      return { rows, tick: index + 1 };
    });
    const measurements = { 'effectweb-scope': [], 'solid-signal-bridge': [] };
    if (workload === 'burst') measurements['effectweb-transaction'] = [];
    // Alternate order to reduce systematic warmup/order bias. First two rounds are discarded.
    for (let sample = -2; sample < samples; sample++) {
      const kinds = Object.keys(measurements);
      if (sample % 2) kinds.reverse();
      for (const kind of kinds) {
        const result = measure(kind, initial, publications, workload === 'burst');
        if (sample >= 0) measurements[kind].push(result);
      }
    }
    report.results.push({
      bindings,
      workload,
      pipelines: Object.fromEntries(
        Object.entries(measurements).map(([kind, values]) => [
          kind,
          {
            medianMilliseconds: median(values.map((value) => value.milliseconds)),
            minMilliseconds: Math.min(...values.map((value) => value.milliseconds)),
            maxMilliseconds: Math.max(...values.map((value) => value.milliseconds)),
            writes: values[0].writes,
          },
        ]),
      ),
    });
  }
}
console.log(JSON.stringify(report, null, 2));
