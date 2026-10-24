import esbuild from 'esbuild';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

if (!fs.existsSync('scratch')) {
  fs.mkdirSync('scratch', { recursive: true });
}

const testFiles = fs
  .readdirSync('tests')
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => path.join('tests', f));

// Generate a test runner bundle
const runnerContent = testFiles.map((f) => `import '../${f.replace(/\\/g, '/')}';`).join('\n');
fs.writeFileSync('scratch/runner.ts', runnerContent);

await esbuild.build({
  entryPoints: ['scratch/runner.ts'],
  bundle: true,
  platform: 'node',
  external: ['obsidian'],
  outfile: 'scratch/test.cjs',
  format: 'cjs',
});

execSync('node scratch/test.cjs', { stdio: 'inherit' });
