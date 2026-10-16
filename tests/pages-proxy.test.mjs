import assert from "node:assert/strict";
import { test } from "node:test";
import { onRequest } from "../functions/api/[[path]].js";

test("Pages API proxy keeps the API path and OAuth redirect response", async () => {
  const originalFetch = globalThis.fetch;
  let requested;
  globalThis.fetch = async (request, init) => {
    requested = { request, init };
    return new Response(null, {
      status: 302,
      headers: {
        Location: "https://mutsaki.com/oauth.html",
        "Set-Cookie": "koe_mutsaki_oauth=abc; Path=/api/auth/mutsaki; HttpOnly; Secure"
      }
    });
  };

  try {
    const response = await onRequest({
      request: new Request("https://voice.cukelab.com/api/auth/mutsaki/start?next=1"),
      env: { API_ORIGIN: "https://api.cukelab.com" }
    });
    assert.equal(requested.request.url, "https://api.cukelab.com/api/auth/mutsaki/start?next=1");
    assert.equal(requested.init.redirect, "manual");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("Location"), "https://mutsaki.com/oauth.html");
    assert.match(response.headers.get("Set-Cookie"), /koe_mutsaki_oauth=abc/);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pages API proxy refuses a missing or non-HTTPS backend", async () => {
  for (const value of [undefined, "http://api.cukelab.com", "https://api.cukelab.com/other"]) {
    const response = await onRequest({
      request: new Request("https://voice.cukelab.com/api/health"),
      env: { API_ORIGIN: value }
    });
    assert.equal(response.status, 503);
  }
});
