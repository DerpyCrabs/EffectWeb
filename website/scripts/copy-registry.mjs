import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkRegistry, outputDirectory } from '../../scripts/shadcn-registry.mjs';
const issues = checkRegistry();
if (issues.length) throw new Error(issues.join('\n') + '\nRun npm run registry:build');
const target = fileURLToPath(new URL('../public/r', import.meta.url));
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(outputDirectory, target, { recursive: true });
