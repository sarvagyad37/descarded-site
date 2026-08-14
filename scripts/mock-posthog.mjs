// Minimal local stand-in for PostHog's capture endpoint, used only to
// verify analytics.js's behavior end-to-end (never committed as a real
// dependency — see docs/posthog.md's Validation section for the
// production-equivalent manual check).
import { createServer } from 'node:http';

const PORT = process.env.MOCK_POSTHOG_PORT || 8790;
const events = [];

const STUB_SCRIPT = `
window.posthog = {
  __loaded: true,
  init: function (key, cfg) { this._cfg = cfg; },
  register: function (props) { this._super = Object.assign(this._super || {}, props); },
  capture: function (event, props) {
    fetch(this._cfg.api_host + '/e/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: event, properties: Object.assign({}, this._super, props) })
    });
  }
};
`;

const server = createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/_debug') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(events));
    return;
  }
  if (req.method === 'GET' && req.url === '/static/array.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end(STUB_SCRIPT);
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    const parsed = JSON.parse(body || '{}');
    const batch = Array.isArray(parsed) ? parsed : parsed.batch || [parsed];
    for (const item of batch) {
      if (item && item.event) events.push({ event: item.event, properties: item.properties || {} });
    }
  } catch (e) { /* ignore non-JSON (e.g. /decide/ or array.js internals) */ }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 1 }));
});

server.listen(PORT, () => console.log(`mock posthog capture on :${PORT}`));
