// GET /api/config
// Serves non-secret, environment-specific client config. Currently just the
// PostHog project key + host, kept out of the client bundle so it's never
// hardcoded and can differ between local/preview/production without a code
// change. Not authenticated — nothing returned here is sensitive (PostHog
// project API keys are meant to be public/client-embeddable).

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet({ env }) {
  return json(200, {
    posthogApiKey: env.POSTHOG_API_KEY || null,
    posthogHost: env.POSTHOG_HOST || null,
  });
}

export async function onRequestPost() {
  return json(405, { error: 'method_not_allowed' });
}
