import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

/*
 * Bundles each Lambda into its own ES module for the Node.js 22 runtime:
 *   dist/lambda/api/index.mjs     the REST API (seals secrets, never opens them)
 *   dist/lambda/mailer/index.mjs  emails the reveal code
 *   dist/lambda/reveal/index.mjs  releases the result at the reveal moment
 * Separate bundles mean separate deployments and separate IAM roles.
 * The AWS SDK v3 is provided by the runtime, so it stays external.
 */
const functions = { api: 'src/handlers/http.ts', mailer: 'src/handlers/mailer.ts', reveal: 'src/handlers/reveal.ts' };

await rm('dist/lambda', { recursive: true, force: true });

for (const [name, entry] of Object.entries(functions)) {
  await mkdir(`dist/lambda/${name}`, { recursive: true });
  const result = await build({
    entryPoints: [entry],
    outfile: `dist/lambda/${name}/index.mjs`,
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
  console.log(`Bundled dist/lambda/${name}/index.mjs (${(bytes / 1024).toFixed(0)} KB incl. sourcemap)`);
}
