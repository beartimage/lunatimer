// Cloudflare Worker: Markdown for Agents (content negotiation).
// Browsers get the normal HTML SPA. Agents that send `Accept: text/markdown`
// get a clean, formatting-stripped markdown representation of the page.
// Everything else (assets, sitemap, robots) passes straight through to
// Workers Static Assets via the ASSETS binding.
//
// Docs: https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/

const SITE = 'https://lunatimer.app';

// RFC 8288 / RFC 9727 §3 discovery links advertised on HTML page responses.
// Root-relative per the RFC examples; agents resolve them against the request URL.
const DISCOVERY_LINKS = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  '</api-docs.html>; rel="service-doc"; type="text/html"',
  '</openapi.json>; rel="describedby"; type="application/vnd.oai.openapi+json"',
];

// Clean markdown per public route. Kept in sync with the HTML pages.
const PAGES = {
  '/': {
    title: 'lunatimer',
    body: `# lunatimer

**A timer for every phase of your day.**

Three calm, focused timers in one place — no sign-up, works fully offline.

## Timers

- **[Meditation Timer](${SITE}/timer)** — Wind the dial to any length, add gentle interval bells, and drift with soft Tibetan-bowl chimes. Perfect for meditation, breathwork, or a mindful pause to reset your focus.
- **[Pomodoro](${SITE}/pomodoro)** — Work in focused sprints with built-in breaks. Focus, short break and long break cycle automatically while it counts your sessions — the simple rhythm that keeps you productive without burning out.
- **[Timebox](${SITE}/timebox)** — Give every task a fixed block of time. Line up your to-dos, set the minutes, and move through the day one task at a time — hard limits to stay sharp, soft ones for a little extra.

[Choose a timer](${SITE}/welcome)`,
  },
  '/welcome': {
    title: 'Choose a timer — lunatimer',
    body: `# Choose your timer

Pick the timer that fits the moment:

- **[Meditation Timer](${SITE}/timer)** — Calm bells & interval chimes.
- **[Pomodoro](${SITE}/pomodoro)** — Focus sprints & breaks.
- **[Timebox](${SITE}/timebox)** — Time-blocked task list.`,
  },
  '/timer': {
    title: 'Timer — lunatimer',
    body: `# Timer (Meditation)

A calm meditation timer with synthesized Tibetan-bowl bells.

- Drag the circular dial to set a duration (each full turn = 60 minutes, up to 24 hours), or tap to type an exact time in minutes or seconds.
- Add optional **interval bells** that chime partway through the session.
- Choose from several bell tones (Basu, Ombu, Tingsha, Koshi, Lotus, Prana, Zenith).
- Save reusable **presets**.

Back to [all timers](${SITE}/).`,
  },
  '/pomodoro': {
    title: 'Pomodoro — lunatimer',
    body: `# Pomodoro

Focus sprints and breaks using the Pomodoro technique.

- **Focus**, **Short break**, and **Long break** phases advance automatically.
- Configure the length of each phase and how many focus sessions trigger a long break.
- Tracks completed pomodoros and the current cycle.
- Pick a completion alarm (Chime, Zen, Pulse, Harp, Marimba).

Back to [all timers](${SITE}/).`,
  },
  '/timebox': {
    title: 'Timebox — lunatimer',
    body: `# Timebox

A time-blocked task list — run one task at a time against a fixed block of minutes.

- Add tasks with a name, a number of minutes, and a type:
  - **Hard** — stop the moment time runs out and move on.
  - **Soft** — when time's up, add +5 / +10 minutes or mark complete.
- Reorder tasks by dragging; edit or delete any task.
- Tracks how many tasks are done.

Back to [all timers](${SITE}/).`,
  },
};

function markdownResponse(page) {
  const md = `${page.body}\n`;
  return new Response(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Vary': 'Accept',
      'Cache-Control': 'public, max-age=3600',
      'X-Robots-Tag': 'all',
    },
  });
}

// Does this Accept header prefer markdown? Honors basic q-values so a browser
// sending `text/html,...;q=0.9` is never mistaken for an agent.
function wantsMarkdown(accept) {
  if (!accept) return false;
  const types = accept.split(',').map((part) => {
    const [type, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return { type: type.toLowerCase(), q: q ? parseFloat(q.slice(2)) : 1 };
  });
  const md = types.find((t) => t.type === 'text/markdown');
  if (!md) return false;
  const html = types.find((t) => t.type === 'text/html');
  // markdown wins unless the client explicitly ranks HTML higher
  return !html || md.q >= html.q;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // --- RFC 9727 API catalog (application/linkset+json) ---
    if (path === '/.well-known/api-catalog') {
      const catalog = {
        linkset: [
          {
            anchor: `${SITE}/api`,
            'service-desc': [
              { href: `${SITE}/openapi.json`, type: 'application/vnd.oai.openapi+json' },
            ],
            'service-doc': [
              { href: `${SITE}/api-docs.html`, type: 'text/html' },
            ],
            status: [
              { href: `${SITE}/api/health`, type: 'application/json' },
            ],
          },
        ],
      };
      return new Response(JSON.stringify(catalog, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/linkset+json',
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // --- Health endpoint (referenced by the catalog `status` relation) ---
    if (path === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'lunatimer' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // --- Markdown for Agents: content negotiation on public pages ---
    const page = PAGES[path];
    if (request.method === 'GET' && page && wantsMarkdown(request.headers.get('Accept'))) {
      return markdownResponse(page);
    }

    // Default: serve the static site (HTML for browsers, plus all assets).
    const resp = await env.ASSETS.fetch(request);

    // Advertise the markdown alternative + machine-readable discovery links.
    if (page) {
      const headers = new Headers(resp.headers);
      headers.append('Vary', 'Accept');
      const links = [
        `<${path === '/' ? '/' : path}>; rel="alternate"; type="text/markdown"`,
        ...DISCOVERY_LINKS,
      ];
      // one comma-separated Link header (RFC 8288 §3) — also valid as multiple
      headers.set('Link', links.join(', '));
      return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
    }
    return resp;
  },
};
