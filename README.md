# RunPeak — demo site with Meta Pixel + Conversions API

A static e-commerce landing page (`index.html`) served by a tiny Node.js/Express
backend (`server.js`) that forwards browser events to the
[Meta Conversions API](https://developers.facebook.com/docs/marketing-api/conversions-api)
server-side. The Pixel continues to fire client-side, and both share the same
`event_id` so Meta deduplicates them.

## Architecture

```
 Browser (index.html)
   │
   ├── fbq('track', 'AddToCart', {...}, { eventID })    ── Meta Pixel
   │
   └── POST /api/capi  { event_name, event_id, ... }    ── this server
                             │
                             ▼
          Node.js backend (server.js + server/metaCapi.js)
             • attaches access_token (kept server-side)
             • extracts client IP, User-Agent, _fbp, _fbc
             • SHA-256 hashes any PII via facebook-nodejs-business-sdk
             • POSTs to https://graph.facebook.com/v21.0/{pixel_id}/events
```

The access token is **never** sent to the browser and **never** written to
`.env` — it is supplied on the command line at startup.

## Install

```bash
npm install
```

## Run

Pass the CAPI access token (and any optional params) as `key=value` CLI args:

```bash
node server.js access_token=EAAK83Xky5Fk...YOUR_TOKEN...
```

Optional parameters:

| Key               | Default             | Purpose                                                              |
|-------------------|---------------------|----------------------------------------------------------------------|
| `access_token`    | (required)          | Meta CAPI access token                                               |
| `pixel_id`        | `1580328876411962`  | Meta Pixel ID                                                         |
| `test_event_code` | *(unset)*           | Routes events to the Events Manager **Test Events** tab for QA       |
| `port`            | `3000`              | HTTP port                                                             |

You can combine them in a URL-style string if you prefer:

```bash
node server.js "?access_token=EAA...&pixel_id=1580328876411962&test_event_code=TEST12345"
```

Then open <http://localhost:3000> and trigger events (Add to Cart, Subscribe,
Proceed to Checkout). Each event is sent both by the Pixel and by the backend
with a matching `event_id`.

## Health check

```bash
curl http://localhost:3000/api/health
# {"ok":true,"capi_configured":true,"pixel_id":"1580328876411962","test_event_code":null}
```

## Verifying in Meta

1. In Events Manager, open your Pixel → **Test Events** tab.
2. Run the server with `test_event_code=TEST12345` (replace with the code shown
   in the Test Events tab).
3. Load the page and interact with it. You should see `PageView`,
   `AddToCart`, `InitiateCheckout`, `ViewContent`, and `Lead` arrive with
   **Event Match Quality** and `deduplication: Pixel + Server`.
4. Remove `test_event_code` before putting this in production.

## Security notes

- The access token stays on the Node.js process — it is masked in logs and
  never returned in HTTP responses.
- Do not paste real tokens into commits, issues, or client-side code.
- If a token is ever exposed, revoke it in Events Manager → Settings →
  Conversions API.
