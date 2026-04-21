import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const requestedPort = Number(process.argv[2] || 8131);
const port = await findAvailablePort(requestedPort);
const localUrl = `http://127.0.0.1:${port}/`;
const viteCliPath = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');

await runCommand(npmExecutable, ['run', 'build']);

const previewProcess = spawn(
  process.execPath,
  [viteCliPath, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  {
    stdio: 'inherit',
    windowsHide: true,
  },
);

try {
  await waitForUrl(localUrl, 30_000);
  await runCommand(npmExecutable, ['run', 'smoke:test', '--', localUrl]);
} finally {
  stopProcess(previewProcess);
  await Promise.race([once(previewProcess, 'exit'), delay(3_000)]);
  stopProcess(previewProcess, 'SIGKILL');
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      windowsHide: true,
    });
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

async function findAvailablePort(preferredPort: number): Promise<number> {
  if (await isPortAvailable(preferredPort)) {
    return preferredPort;
  }

  const fallbackPort = await reserveEphemeralPort();
  console.warn(`Port ${preferredPort} is busy, using ${fallbackPort} for local smoke preview`);
  return fallbackPort;
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, '127.0.0.1');
  });
}

async function reserveEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => {
          reject(new Error('Failed to reserve an ephemeral preview port'));
        });
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function stopProcess(process: ReturnType<typeof spawn>, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (process.exitCode != null || process.killed) {
    return;
  }

  try {
    process.kill(signal);
  } catch {}
}
