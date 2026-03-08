import { spawn } from 'node:child_process';
import { once } from 'node:events';

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const port = Number(process.argv[2] || 8131);
const localUrl = `http://127.0.0.1:${port}/`;

await runCommand(npmExecutable, ['run', 'build']);

const previewProcess = spawn(
  npmExecutable,
  ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port)],
  {
    stdio: 'inherit',
  },
);

try {
  await waitForUrl(localUrl, 30_000);
  await runCommand(npmExecutable, ['run', 'smoke:test', '--', localUrl]);
} finally {
  previewProcess.kill('SIGTERM');
  await Promise.race([once(previewProcess, 'exit'), delay(3_000)]);
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) {
        return;
      }
    } catch {}

    await delay(500);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
