// Cloudflare Worker: API proxy for api.<domain> -> Cloud Run.
//
// Cloud Run routes requests by Host header, so a plain proxied CNAME forwards api.<domain> —
// a hostname Cloud Run has never heard of — and every path answers 404. An Origin Rule with a
// Host-header override would fix that declaratively, but that override is Enterprise-only
// ("not entitled to use the HostHeader override" on the free plan), so this Worker does the
// rewrite instead — the same approach as ../cot/cloudflare-worker-api.js, which this adapts.
//
// bindings: BACKEND_ORIGIN (the https://*.run.app service URL), EDGE_SHARED_SECRET (secret)

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const backendUrl = `${BACKEND_ORIGIN}${url.pathname}${url.search}`;

  const headers = new Headers(request.headers);
  headers.set('Host', new URL(BACKEND_ORIGIN).hostname);
  // Proves the request came through the edge (checked by backend/internal/middleware).
  headers.set('X-Hearth-Edge', EDGE_SHARED_SECRET);

  const response = await fetch(backendUrl, {
    method: request.method,
    headers: headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    // Pass redirects through to the client instead of following them inside the Worker, where
    // same-zone subrequests would loop straight back into this route.
    redirect: 'manual',
  });

  // The backend varies credentialed CORS responses by Origin (auth/web/*); make sure any cache
  // in front respects that even if the backend header is ever missed.
  const responseHeaders = new Headers(response.headers);
  responseHeaders.append('Vary', 'Origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
