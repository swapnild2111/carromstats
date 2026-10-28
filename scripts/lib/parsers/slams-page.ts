import * as cheerio from 'cheerio';
import { collapseWs } from '../normalize.js';
import { SlamsPage, type SlamsPageT } from '../schemas.js';

// A slams page is a flat sequence, per category:
//   h5.blog_head            "Men's Singles"
//   h5.counter-count + p    "14" / "White Slam"   (then a table.pointsTable of those slams)
//   h5.counter-count + p    "10" / "Black Slam"   (then its table)
// Each table row: name (h5 b), city ("( Thane )"), and "Match- 68 | SET-1 | Board- 5".

function categoryKeyFor(heading: string): string {
  const h = heading.toLowerCase();
  if (/^women/.test(h)) return 'women_singles';
  if (/^men/.test(h)) return 'men_singles';
  return h.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function numAfter(label: string, text: string): number | null {
  const m = new RegExp(String.raw`${label}\s*-?\s*(\d+)`, 'i').exec(text);
  return m ? Number(m[1]) : null;
}

export function parseSlamsPage(html: string, tournamentSlug: string): SlamsPageT {
  const $ = cheerio.load(html);
  const reported: SlamsPageT['reported'] = [];
  const slams: SlamsPageT['slams'] = [];

  let category: string | null = null;
  let color: 'white' | 'black' | null = null;

  $('h5.blog_head, h5.counter-count, table.pointsTable').each((_, el) => {
    const node = $(el);
    if (node.is('h5.blog_head')) {
      category = categoryKeyFor(collapseWs(node.text()));
      color = null;
      return;
    }
    if (node.is('h5.counter-count')) {
      const label = collapseWs(node.next('p').text());
      const m = /(white|black)\s+slam/i.exec(label);
      if (!m || !category) return;
      color = m[1].toLowerCase() as 'white' | 'black';
      reported.push({ categoryKey: category, color, count: Number.parseInt(node.text(), 10) || 0 });
      return;
    }
    if (!category || !color) return;
    node.find('tr').each((_, tr) => {
      const row = $(tr);
      const name = collapseWs(row.find('h5').first().text());
      if (!name) return;
      const divs = row.find('div.winnerName');
      const city = collapseWs(divs.eq(0).text()).replace(/^\(\s*/, '').replace(/\s*\)$/, '') || null;
      const where = collapseWs(divs.eq(1).text());
      slams.push({
        categoryKey: category!,
        color: color!,
        name,
        city,
        match: numAfter('Match', where),
        set: numAfter('SET', where),
        board: numAfter('Board', where),
      });
    });
  });

  for (const r of reported) {
    const got = slams.filter(s => s.categoryKey === r.categoryKey && s.color === r.color).length;
    if (got !== r.count) {
      console.warn(`  WARN ${tournamentSlug}: ${r.categoryKey} ${r.color} slams — page says ${r.count}, parsed ${got}`);
    }
  }

  return SlamsPage.parse({ tournamentSlug, reported, slams });
}
