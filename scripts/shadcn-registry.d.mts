import type { Server } from 'node:http';
export interface RegistryFile {
  path: string;
  type: string;
  target: string;
  content: string;
}
export interface RegistryItem {
  $schema: string;
  name: string;
  type: string;
  title: string;
  dependencies?: string[];
  registryDependencies?: string[];
  files: RegistryFile[];
}
export const outputDirectory: string;
export function toConsumerSource(source: string): string;
export function collectDependencies(
  source: string,
  dependencies?: Record<string, string>,
): { dependencies?: string[]; registryDependencies?: string[] };
export function buildItems(): RegistryItem[];
export function renderRegistry(): Map<string, string>;
export function writeRegistry(directory?: string): void;
export function checkRegistry(directory?: string): string[];
export function serveRegistry(port?: number, directory?: string): Promise<Server>;
