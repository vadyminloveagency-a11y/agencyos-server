import { spawnSync } from 'node:child_process';

if (process.env.SKIP_PLAYWRIGHT_INSTALL === '1') {
  process.exit(0);
}

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  // Install into node_modules so Render deploy includes the browser binary.
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, ['playwright', 'install', 'chromium'], {
  stdio: 'inherit',
  env: process.env
});

process.exit(result.status ?? 1);
