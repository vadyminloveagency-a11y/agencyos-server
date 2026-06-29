import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export function resolvePlaywrightBrowsersPath(dataDir, usingRuntimeDataDir) {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (usingRuntimeDataDir && dataDir) return path.join(dataDir, 'playwright-browsers');
  return path.join(moduleDir, '.playwright-browsers');
}

function chromiumExecutableExists(playwright) {
  try {
    const executable = playwright.chromium.executablePath();
    return Boolean(executable && fs.existsSync(executable));
  } catch {
    return false;
  }
}

export async function ensurePlaywrightChromium(browsersPath) {
  const targetPath = String(browsersPath || '').trim();
  if (!targetPath) throw new Error('Playwright browsers path is required');
  process.env.PLAYWRIGHT_BROWSERS_PATH = targetPath;
  fs.mkdirSync(targetPath, { recursive: true });

  let playwright = await import('playwright');
  if (chromiumExecutableExists(playwright)) return playwright;

  console.log(`[playwright] Installing Chromium to ${targetPath}...`);
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(command, ['playwright', 'install', 'chromium'], {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: targetPath },
    cwd: moduleDir
  });
  if (result.status !== 0) {
    throw new Error('Could not install Playwright Chromium on server');
  }

  playwright = await import('playwright');
  if (!chromiumExecutableExists(playwright)) {
    throw new Error(`Playwright Chromium is still missing in ${targetPath}`);
  }
  console.log(`[playwright] Chromium ready at ${playwright.chromium.executablePath()}`);
  return playwright;
}
