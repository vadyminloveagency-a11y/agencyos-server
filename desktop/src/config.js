import fs from 'fs';
import path from 'path';

export const DEFAULT_SERVER_URL = 'https://agencyos-server-096a.onrender.com';

export function resolveServerUrl(argv = process.argv, env = process.env) {
  const cliArg = argv.find(item => item.startsWith('--server='));
  if (cliArg) return cliArg.slice('--server='.length).trim();
  if (env.AGENCYOS_SERVER_URL) return String(env.AGENCYOS_SERVER_URL).trim();
  return DEFAULT_SERVER_URL;
}

export async function pickWorkingServerUrl(preferredUrl = '') {
  const normalize = value => String(value || '').trim().replace(/\/+$/, '');
  const preferred = normalize(preferredUrl);
  const candidates = [...new Set([preferred, DEFAULT_SERVER_URL, 'http://localhost:3000'].filter(Boolean))];
  for (const candidate of candidates) {
    try {
      const response = await fetch(`${candidate}/api/health`, { signal: AbortSignal.timeout(8000) });
      if (response.ok) return candidate;
    } catch {}
  }
  return DEFAULT_SERVER_URL;
}

export function readConfig(userDataPath) {
  const configPath = path.join(userDataPath, 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

export function writeConfig(userDataPath, patch = {}) {
  const configPath = path.join(userDataPath, 'config.json');
  const current = readConfig(userDataPath);
  const next = { ...current, ...patch };
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
  return next;
}
