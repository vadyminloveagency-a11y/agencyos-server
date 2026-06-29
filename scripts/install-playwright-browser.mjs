import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

if (process.env.SKIP_PLAYWRIGHT_INSTALL === '1') {
  process.exit(0);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH
  || path.join(projectRoot, '.playwright-browsers');

process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
fs.mkdirSync(browsersPath, { recursive: true });

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, ['playwright', 'install', 'chromium'], {
  stdio: 'inherit',
  env: process.env,
  cwd: projectRoot
});

process.exit(result.status ?? 1);
