import esbuild from 'esbuild';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

if (!fs.existsSync('scratch')) {
  fs.mkdirSync('scratch', { recursive: true });
}

await esbuild.build({
  entryPoints: ['tests/parser.test.ts'],
  bundle: true,
  platform: 'node',
  external: ['obsidian'],
  outfile: 'scratch/test.cjs',
  format: 'cjs',
});

execSync('node scratch/test.cjs', { stdio: 'inherit' });
