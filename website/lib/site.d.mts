import type { Plugin } from 'vite';
export function documentation(root: string): Promise<Plugin>;
export function escape(value: unknown): string;
export function slug(value: string): string;
