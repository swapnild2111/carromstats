import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const CACHE_DIR = path.join(ROOT, '.cache');

const USER_AGENT = 'carromstats/0.1 (+https://github.com/swapnild2111/carromstats)';
const DELAY_MS = 2000;
const MAX_RETRIES = 3;

let lastFetchAt = 0;

function cachePath(url: string): string {
  const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 32);
  return path.join(CACHE_DIR, `${hash}.html`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function politeGet(url: string): Promise<string> {
  const now = Date.now();
  const wait = Math.max(0, lastFetchAt + DELAY_MS - now);
  if (wait > 0) await sleep(wait);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      lastFetchAt = Date.now();
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
        redirect: 'follow',
      });
      if (res.status === 404) {
        return '__404__';
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await sleep(DELAY_MS * attempt);
      }
    }
  }
  throw lastErr;
}

export interface FetchOpts {
  force?: boolean;
}

export async function fetchHtml(url: string, opts: FetchOpts = {}): Promise<string | null> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cached = cachePath(url);
  if (!opts.force && fs.existsSync(cached)) {
    const body = fs.readFileSync(cached, 'utf-8');
    if (body === '__404__') return null;
    return body;
  }
  console.log(`  fetch ${url}`);
  const body = await politeGet(url);
  fs.writeFileSync(cached, body);
  if (body === '__404__') return null;
  return body;
}

export function absolutize(base: string, href: string): string {
  return new URL(href, base).toString();
}

export const MCA_ORIGIN = 'https://maharashtracarromassociation.com/';
