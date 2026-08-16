// Cloudflare Worker: Markdown for Agents (content negotiation).
// Browsers get the normal HTML SPA. Agents that send `Accept: text/markdown`
// get a clean, formatting-stripped markdown representation of the page.
// Everything else (assets, sitemap, robots) passes straight through to
// Workers Static Assets via the ASSETS binding.
//
// Docs: https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/

const SITE = 'https://lunatimer.app';

// Clean markdown per public route. Kept in sync with the HTML pages.
const PAGES = {
  '/': {
    title: 'lunatimer',
    body: `# lunatimer

A calm, beautiful timer for **meditation**, **Pomodoro** focus sprints, and **time-boxed** task lists. Works fully offline, no sign-up.

## Timers

- **[Timer](${SITE}/timer)** — Meditation timer with calm Tibetan-bowl bells and optional interval chimes. Wind the dial to set any duration up to 24 hours.
- **[Pomodoro](${SITE}/pomodoro)** — Focus sprints with short and long breaks, a configurable long-break interval, and completion alarms.
- **[Timebox](${SITE}/timebox)** — A time-blocked task list. Assign minutes per task; "hard" tasks stop at zero, "soft" tasks let you add a few more minutes.

All timers keep the screen awake while running and send a notification when time is up.`,
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

    // Advertise that HTML pages also have a markdown representation.
    if (page) {
      const headers = new Headers(resp.headers);
      headers.append('Vary', 'Accept');
      headers.set('Link', `<${SITE}${path === '/' ? '/' : path}>; rel="alternate"; type="text/markdown"`);
      return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
    }
    return resp;
  },
};
