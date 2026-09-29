import { readFileSync } from 'node:fs';

// Shared by build, versioning, packing, publishing, and clean-consumer verification.
export const packages = [
  ['compiler', 'index'],
  ['runtime', 'index'],
  ['query', 'index'],
  ['lucide', 'icons/camera'],
  ['antd-icons', 'icons/DeleteOutlined'],
  ['json-render', 'index'],
  ['tanstack-router', 'index'],
  ['tanstack-form', 'index'],
  ['tanstack-table', 'index'],
  ['keycloak', 'index'],
].map(([directory, entry]) => {
  const path = `packages/${directory}`;
  const metadata = JSON.parse(readFileSync(`${path}/package.json`, 'utf8'));
  return { directory, path, entry, metadata };
});
