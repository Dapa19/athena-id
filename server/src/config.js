import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const projectDir = path.resolve(serverDir, '..');

const envFile = path.join(projectDir, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
}

export function databasePath() {
  const value = process.env.DATABASE_PATH || 'server/data/athena.sqlite';
  return path.isAbsolute(value) ? value : path.resolve(projectDir, value);
}

export const isProduction = process.env.NODE_ENV === 'production';
