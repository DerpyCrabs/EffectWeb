export function publishBuild(
  entries: readonly { staged: string; target: string }[],
  backupRoot: string,
): void;
