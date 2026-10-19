import { existsSync, renameSync, rmSync } from 'node:fs';

/** Replace completed outputs, retaining the previous build until every replacement succeeds. */
export function publishBuild(entries, backupRoot) {
  const installed = [];
  try {
    for (const [index, { staged, target }] of entries.entries()) {
      const backup = `${backupRoot}/${index}`;
      const previous = existsSync(target);
      if (previous) renameSync(target, backup);
      const entry = { target, backup, previous, installed: false };
      installed.push(entry);
      renameSync(staged, target);
      entry.installed = true;
    }
  } catch (error) {
    const failures = [error];
    for (const entry of installed.reverse()) {
      try {
        if (entry.installed) rmSync(entry.target, { recursive: true, force: true });
        if (entry.previous) renameSync(entry.backup, entry.target);
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        `Build rollback failed; previous outputs remain in ${backupRoot}`,
      );
    throw error;
  }
}
