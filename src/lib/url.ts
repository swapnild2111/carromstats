const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

export function url(path: string): string {
  if (!path.startsWith('/')) path = '/' + path;
  return BASE + path;
}
