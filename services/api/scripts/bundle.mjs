import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

/*
 * Bundles the Lambda handler into one ES module for the Node.js 22 runtime.
 * The AWS SDK v3 is provided by the runtime, so it stays external.
 * Milestone 4's Terraform zips dist/lambda/.
 */
await rm('dist/lambda', { recursive: true, force: true });
await mkdir('dist/lambda', { recursive: true });

const result = await build({
  entryPoints: ['src/handlers/http.ts'],
  outfile: 'dist/lambda/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: 'linked',
  external: ['@aws-sdk/*'],
  metafile: true,
  legalComments: 'none',
});

const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
console.log(`Bundled dist/lambda/index.mjs (${(bytes / 1024).toFixed(0)} KB incl. sourcemap)`);
