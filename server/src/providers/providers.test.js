import test from "node:test";
import assert from "node:assert/strict";
import { configuredProviders } from "./index.js";
import { mutsakiConfig } from "./mutsaki.js";

test("configured providers preserve chosen order and reject unknown or duplicate IDs", () => {
  assert.deepEqual(configuredProviders("mutsaki,local").map((item) => item.id), ["mutsaki", "local"]);
  assert.deepEqual(configuredProviders("local").map((item) => item.id), ["local"]);
  for (const value of ["", "local,local", "local,unknown"]) {
    assert.throws(() => configuredProviders(value));
  }
});

test("Mutsaki callback must match the configured site exactly", () => {
  const env = {
    NODE_ENV: "production",
    CLIENT_ORIGIN: "https://voice.example.com",
    MUTSAKI_CLIENT_ID: "koe",
    MUTSAKI_CLIENT_SECRET: "test-secret-with-more-than-32-characters",
    MUTSAKI_REDIRECT_URI: "https://voice.example.com/api/auth/mutsaki/callback"
  };
  assert.equal(mutsakiConfig(env).redirectUri, env.MUTSAKI_REDIRECT_URI);
  for (const bad of [
    "http://voice.example.com/api/auth/mutsaki/callback",
    "https://other.example.com/api/auth/mutsaki/callback",
    "https://voice.example.com/api/auth/mutsaki/callback?next=other",
    "https://user:password@voice.example.com/api/auth/mutsaki/callback",
    "https://voice.example.com/api/auth/mutsaki/other"
  ]) {
    assert.throws(() => mutsakiConfig({ ...env, MUTSAKI_REDIRECT_URI: bad }));
  }
});
