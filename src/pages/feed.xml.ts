import type { APIRoute } from 'astro';
import { getTournamentIndex } from '~/lib/data';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const origin = site?.toString().replace(/\/$/, '') ?? '';

  const tournaments = getTournamentIndex()
    .filter(t => (t.categories?.length ?? 0) > 0)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, 30);

  const updated = tournaments[0]?.date
    ? `${tournaments[0].date}T00:00:00Z`
    : '1970-01-01T00:00:00Z';

  const entries = tournaments.map(t => {
    const link = `${origin}${base}/tournaments/${t.slug}`;
    const dateIso = t.date ? `${t.date}T00:00:00Z` : updated;
    return `<entry>
    <id>${link}</id>
    <title>${escapeXml(t.title)}</title>
    <link href="${link}"/>
    <updated>${dateIso}</updated>
    <summary>Season ${escapeXml(t.season)} · ${t.categories.length} categories · ${t.venue ? escapeXml(t.venue) : 'venue TBD'}</summary>
  </entry>`;
  }).join('\n  ');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>carromstats — latest tournaments</title>
  <link href="${origin}${base}/feed.xml" rel="self"/>
  <link href="${origin}${base}/"/>
  <updated>${updated}</updated>
  <id>${origin}${base}/</id>
  <author><name>carromstats</name></author>
  ${entries}
</feed>`;

  return new Response(xml, {
    headers: { 'content-type': 'application/atom+xml; charset=utf-8' },
  });
};

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
