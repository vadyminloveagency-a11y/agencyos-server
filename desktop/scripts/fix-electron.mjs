import extract from 'extract-zip';
import fs from 'fs';
import path from 'path';
import { downloadArtifact } from '@electron/get';

const root = path.resolve(path.join(import.meta.dirname, '..'));
const electronDir = path.join(root, 'node_modules', 'electron');
const dist = path.join(electronDir, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const zip = await downloadArtifact({
  version: '33.4.11',
  artifactName: 'electron',
  force: true,
  platform: 'win32',
  arch: 'x64'
});

console.log('Downloading from cache or network:', zip);
await extract(zip, { dir: dist });
fs.writeFileSync(path.join(electronDir, 'path.txt'), 'electron.exe');
const exePath = path.join(dist, 'electron.exe');
console.log('electron.exe ready:', fs.existsSync(exePath), exePath);
