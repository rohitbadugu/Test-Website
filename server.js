/**
 * RunPeak server — serves the static site and exposes POST /api/capi,
 * which forwards events to the Meta Conversions API server-side.
 *
 * Configuration is supplied on the command line using `key=value` pairs
 * (no .env file). Examples:
 *
 *   node server.js access_token=EAAK83Xky5Fk...
 *   node server.js access_token=EAA... pixel_id=1580328876411962 port=8080
 *   node server.js access_token=EAA... test_event_code=TEST12345
 *
 * Supported keys:
 *   access_token      (required) Meta CAPI access token
 *   pixel_id          (optional) Meta Pixel ID; defaults to 1580328876411962
 *   test_event_code   (optional) routes events to the Test Events tab for QA
 *   port              (optional) HTTP port; defaults to 3000
 *
 * The access token is never written to disk and never sent to the browser.
 */

const path = require('path');
const express = require('express');
const { sendCapiEvent } = require('./server/metaCapi');

// ------------------------------------------------------------------
// Parse CLI args of the form key=value (e.g. `access_token=EAA...`).
// Also accepts a full URL-style string like `?access_token=EAA&pixel_id=123`
// for convenience.
// ------------------------------------------------------------------
function parseCliArgs(argv) {
  const out = {};
  for (const raw of argv.slice(2)) {
    if (!raw) continue;
    // Allow "?a=b&c=d" or "a=b&c=d" as a single combined arg.
    const cleaned = raw.startsWith('?') ? raw.slice(1) : raw;
    for (const pair of cleaned.split('&')) {
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      const key = pair.slice(0, idx).trim().toLowerCase();
      const value = pair.slice(idx + 1).trim();
      if (key) out[key] = value;
    }
  }
  return out;
}

const cliArgs = parseCliArgs(process.argv);

const CAPI_CONFIG = {
  accessToken: cliArgs.access_token || '',
  pixelId: cliArgs.pixel_id || '1580328876411962',
  testEventCode: cliArgs.test_event_code || '',
};

const PORT = Number(cliArgs.port || 3000);

if (!CAPI_CONFIG.accessToken) {
  console.warn(
    '[server] No access_token provided on the command line.\n' +
    '          CAPI events will be skipped until you restart with:\n' +
    '            node server.js access_token=YOUR_TOKEN\n'
  );
} else {
  const masked = CAPI_CONFIG.accessToken.slice(0, 6) + '…' + CAPI_CONFIG.accessToken.slice(-4);
  console.log(`[server] CAPI configured for Pixel ${CAPI_CONFIG.pixelId} (token ${masked})`);
  if (CAPI_CONFIG.testEventCode) {
    console.log(`[server] Using test_event_code=${CAPI_CONFIG.testEventCode}`);
  }
}

// ------------------------------------------------------------------
// Express app
// ------------------------------------------------------------------
const app = express();
app.set('trust proxy', true); // so req.ip / X-Forwarded-For work behind a proxy
app.use(express.json({ limit: '64kb' }));

// Serve the static site (index.html, etc.) from the repo root.
app.use(express.static(path.join(__dirname)));

/**
 * POST /api/capi
 * Body: {
 *   event_name:       string,   // required, e.g. "AddToCart"
 *   event_id?:        string,   // optional, for Pixel↔CAPI dedup
 *   event_source_url?: string,
 *   user_data?: {
 *     email?, phone?, firstName?, lastName?, externalId?
 *   },
 *   custom_data?: {
 *     value?, currency?, content_ids?, content_type?,
 *     content_name?, content_category?, num_items?
 *   }
 * }
 *
 * Response: { ok: boolean, event_id: string | null }
 */
app.post('/api/capi', async (req, res) => {
  const body = req.body || {};
  const eventName = typeof body.event_name === 'string' ? body.event_name : null;
  if (!eventName) {
    return res.status(400).json({ ok: false, error: 'event_name is required' });
  }

  const userDataIn = body.user_data || {};
  const customIn = body.custom_data || {};

  const eventSourceUrl = typeof body.event_source_url === 'string'
    ? body.event_source_url
    : (req.headers.referer || '');

  const eventId = await sendCapiEvent(
    CAPI_CONFIG,
    eventName,
    req,
    {
      email: userDataIn.email,
      phone: userDataIn.phone,
      firstName: userDataIn.firstName || userDataIn.first_name,
      lastName: userDataIn.lastName || userDataIn.last_name,
      externalId: userDataIn.externalId || userDataIn.external_id,
    },
    {
      value: customIn.value,
      currency: customIn.currency,
      contentIds: customIn.content_ids || customIn.contentIds,
      contentType: customIn.content_type || customIn.contentType,
      contentName: customIn.content_name || customIn.contentName,
      contentCategory: customIn.content_category || customIn.contentCategory,
      numItems: customIn.num_items || customIn.numItems,
    },
    eventSourceUrl,
    body.event_id
  );

  res.json({ ok: Boolean(eventId), event_id: eventId });
});

// Simple health check.
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    capi_configured: Boolean(CAPI_CONFIG.accessToken && CAPI_CONFIG.pixelId),
    pixel_id: CAPI_CONFIG.pixelId || null,
    test_event_code: CAPI_CONFIG.testEventCode || null,
  });
});

app.listen(PORT, () => {
  console.log(`[server] RunPeak listening on http://localhost:${PORT}`);
});
