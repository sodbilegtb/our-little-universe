import { spawn } from 'node:child_process';

/*
 * Starts the local API (port 8787) and the web app in HTTP mode (port 5173)
 * together. Open the printed Network URL on phones on the same Wi-Fi.
 * Ctrl+C stops both.
 */
const processes = [
  { name: 'api', color: '\x1b[35m', args: ['run', 'dev', '-w', '@olu/api'], env: {} },
  { name: 'web', color: '\x1b[36m', args: ['run', 'dev:server', '-w', '@olu/web'], env: { VITE_API_MODE: 'http' } },
];

const children = processes.map(({ name, color, args, env }) => {
  const child = spawn('npm', args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `${color}${name}\x1b[0m │ `;
  const forward = (stream) => (chunk) =>
    stream.write(
      chunk
        .toString()
        .split('\n')
        .filter((line, i, all) => line || i < all.length - 1)
        .map((line) => prefix + line)
        .join('\n') + '\n',
    );
  child.stdout.on('data', forward(process.stdout));
  child.stderr.on('data', forward(process.stderr));
  child.on('exit', (code) => {
    if (code) console.error(`${prefix}exited with code ${code}`);
    children.forEach((c) => c.kill());
    process.exit(code ?? 0);
  });
  return child;
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => children.forEach((c) => c.kill(signal)));
