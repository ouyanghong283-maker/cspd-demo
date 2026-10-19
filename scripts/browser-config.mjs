import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const base = (process.env.CSPD_BASE_URL || 'http://127.0.0.1:4200').replace(/\/+$/, '');
