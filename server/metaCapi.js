/**
 * Meta Conversions API (CAPI) utility.
 *
 * Sends server-side events to the Meta Graph API using the official
 * facebook-nodejs-business-sdk. The SDK automatically SHA-256 hashes PII
 * (email, phone, first name, last name, etc.) per Meta's requirements.
 *
 * Configuration is injected by the caller (see server.js) rather than read
 * from environment variables, so that the access token can be supplied via
 * a CLI argument such as `node server.js access_token=EAA...`.
 */

const crypto = require('crypto');
const bizSdk = require('facebook-nodejs-business-sdk');

const { EventRequest, UserData, ServerEvent, CustomData, FacebookAdsApi } = bizSdk;

let sdkInitializedFor = null; // caches the access token the SDK was init'd with
function ensureSdkInit(accessToken) {
  if (sdkInitializedFor !== accessToken && accessToken) {
    FacebookAdsApi.init(accessToken);
    sdkInitializedFor = accessToken;
  }
}

/**
 * Extract the client's real IP, preferring X-Forwarded-For (first entry).
 * Falls back to req.ip / socket.remoteAddress. Never returns the server IP.
 */
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || '';
}

/**
 * Pull _fbp / _fbc from the raw Cookie header. We don't rely on cookie-parser
 * so the utility works in any Express setup.
 */
function getFbCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  const fbpMatch = cookieHeader.match(/(?:^|;\s*)_fbp=([^;]+)/);
  const fbcMatch = cookieHeader.match(/(?:^|;\s*)_fbc=([^;]+)/);
  return {
    fbp: fbpMatch ? decodeURIComponent(fbpMatch[1]) : null,
    fbc: fbcMatch ? decodeURIComponent(fbcMatch[1]) : null,
  };
}

/**
 * Send a single server event to Meta CAPI.
 *
 * @param {object} config
 *   @param {string} config.accessToken     Meta CAPI access token (required).
 *   @param {string} config.pixelId         Meta Pixel ID (required).
 *   @param {string} [config.testEventCode] Optional Test Events code for QA.
 * @param {string} eventName                Standard event name (PageView, AddToCart, Purchase, ...).
 * @param {import('express').Request} req
 * @param {object} [userDataParams]         Optional PII fields; SDK handles hashing.
 * @param {object} [customDataParams]       Optional event-specific custom_data.
 * @param {string} [eventSourceUrl]         URL where the event took place.
 * @param {string} [clientEventId]          Optional event_id supplied by the browser for dedup.
 * @returns {Promise<string|null>}          The event_id actually sent, or null if unconfigured/failed.
 */
async function sendCapiEvent(
  config,
  eventName,
  req,
  userDataParams = {},
  customDataParams = {},
  eventSourceUrl = '',
  clientEventId = null
) {
  const accessToken = config && config.accessToken;
  const pixelId = config && config.pixelId;
  const testEventCode = config && config.testEventCode;

  if (!accessToken || !pixelId) {
    console.warn('[Meta CAPI] Not configured. Pass access_token=... and (optionally) pixel_id=... on the command line.');
    return null;
  }

  ensureSdkInit(accessToken);

  // Prefer the browser-provided event_id so Pixel and CAPI dedup on the same value.
  const eventId = clientEventId && String(clientEventId).trim().length > 0
    ? String(clientEventId)
    : crypto.randomUUID();

  try {
    const userData = new UserData()
      .setClientIpAddress(getClientIp(req))
      .setClientUserAgent(req.headers['user-agent'] || '');

    // SDK SHA-256 hashes PII automatically (with lowercase/trim normalization).
    if (userDataParams.email) userData.setEmails([String(userDataParams.email).toLowerCase().trim()]);
    if (userDataParams.phone) userData.setPhones([String(userDataParams.phone)]);
    if (userDataParams.firstName) userData.setFirstNames([String(userDataParams.firstName).toLowerCase().trim()]);
    if (userDataParams.lastName) userData.setLastNames([String(userDataParams.lastName).toLowerCase().trim()]);
    if (userDataParams.externalId) userData.setExternalId(String(userDataParams.externalId));

    const { fbp, fbc } = getFbCookies(req);
    if (fbp) userData.setFbp(fbp);
    if (fbc) userData.setFbc(fbc);

    const customData = new CustomData();
    if (customDataParams.value !== undefined && customDataParams.value !== null) {
      customData.setValue(Number(customDataParams.value));
    }
    if (customDataParams.currency) customData.setCurrency(customDataParams.currency);
    if (Array.isArray(customDataParams.contentIds)) customData.setContentIds(customDataParams.contentIds.map(String));
    if (customDataParams.contentType) customData.setContentType(customDataParams.contentType);
    if (customDataParams.contentName) customData.setContentName(customDataParams.contentName);
    if (customDataParams.contentCategory) customData.setContentCategory(customDataParams.contentCategory);
    if (customDataParams.numItems !== undefined && customDataParams.numItems !== null) {
      customData.setNumItems(Number(customDataParams.numItems));
    }

    const serverEvent = new ServerEvent()
      .setEventName(eventName)
      .setEventTime(Math.floor(Date.now() / 1000))
      .setUserData(userData)
      .setCustomData(customData)
      .setEventSourceUrl(eventSourceUrl || '')
      .setActionSource('website')
      .setEventId(eventId);

    const eventRequest = new EventRequest(accessToken, pixelId).setEvents([serverEvent]);
    if (testEventCode) {
      eventRequest.setTestEventCode(testEventCode);
    }

    // Fire-and-forget: don't block the HTTP response on Meta's round-trip.
    eventRequest.execute().then(
      () => console.log(`[Meta CAPI] ${eventName} sent (event_id: ${eventId})`),
      (error) => {
        const msg = error && error.message ? error.message : error;
        console.error(`[Meta CAPI] ${eventName} failed (event_id: ${eventId}):`, msg);
      }
    );

    return eventId;
  } catch (error) {
    console.error('[Meta CAPI] Error constructing event:', error);
    return null;
  }
}

module.exports = { sendCapiEvent };
