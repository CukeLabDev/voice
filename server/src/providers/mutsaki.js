import { createHash, randomBytes } from "node:crypto";
import { pool, query } from "../db.js";
import { publicUser, signUser } from "../auth.js";

const authorizationUrl = "https://mutsaki.com/oauth.html";
const tokenUrl = "https://api.mutsaki.com/api/oauth/token";
const userinfoUrl = "https://api.mutsaki.com/api/oauth/userinfo";
const revokeUrl = "https://api.mutsaki.com/api/oauth/revoke";
const browserCookie = "koe_mutsaki_oauth";
const ticketCookie = "koe_mutsaki_ticket";
const cookiePath = "/api/auth/mutsaki";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

const random = () => randomBytes(32).toString("base64url");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const challenge = (value) => createHash("sha256").update(value).digest("base64url");
const now = () => Math.floor(Date.now() / 1000);

export function mutsakiConfig(env = process.env) {
  const clientOrigin = env.CLIENT_ORIGIN;
  const redirectUri = env.MUTSAKI_REDIRECT_URI;
  if (!env.MUTSAKI_CLIENT_ID || !env.MUTSAKI_CLIENT_SECRET || !clientOrigin || !redirectUri) {
    throw new Error("Mutsaki login requires CLIENT_ORIGIN, MUTSAKI_CLIENT_ID, MUTSAKI_CLIENT_SECRET and MUTSAKI_REDIRECT_URI");
  }
  const origin = new URL(clientOrigin);
  const callback = new URL(redirectUri);
  if (origin.href !== `${origin.origin}/` || callback.origin !== origin.origin ||
      callback.username || callback.password ||
      callback.pathname !== "/api/auth/mutsaki/callback" || callback.search || callback.hash ||
      (env.NODE_ENV === "production" && origin.protocol !== "https:")) {
    throw new Error("MUTSAKI_REDIRECT_URI must be the exact /api/auth/mutsaki/callback URL on CLIENT_ORIGIN");
  }
  if (env.NODE_ENV === "production" && env.MUTSAKI_CLIENT_SECRET.length < 32) {
    throw new Error("MUTSAKI_CLIENT_SECRET must be an approved random secret");
  }
  return {
    clientId: env.MUTSAKI_CLIENT_ID,
    clientSecret: env.MUTSAKI_CLIENT_SECRET,
    clientOrigin: origin.origin,
    redirectUri: callback.href,
    secureCookie: callback.protocol === "https:"
  };
}

function cookieValue(req, name) {
  const part = (req.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : "";
}

function cookie(name, value, maxAge, secure) {
  return `${name}=${value}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function redirect(res, url, cookies = []) {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  for (const value of cookies) res.append("Set-Cookie", value);
  res.redirect(302, url);
}

function displayName(profile) {
  const value = String(profile.name || profile.preferred_username || "Mutsaki 用户");
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "Mutsaki 用户";
}

async function findOrCreateUser(profile) {
  const subject = profile.sub;
  const name = displayName(profile);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`mutsaki:${subject}`]);
    const existing = await client.query(
      `select u.id from auth_identities i join users u on u.id=i.user_id
       where i.provider='mutsaki' and i.subject=$1`,
      [subject]
    );
    let result;
    if (existing.rows[0]) {
      result = await client.query(
        `update users set display_name=$2 where id=$1
         returning id, username, display_name as "displayName", 'mutsaki' as provider,
                   role, can_create_room as "canCreateRoom"`,
        [existing.rows[0].id, name]
      );
    } else {
      const username = `mutsaki_${digest(subject)}`;
      result = await client.query(
        `insert into users (username, display_name, password_hash)
         values ($1, $2, null)
         returning id, username, display_name as "displayName", 'mutsaki' as provider,
                   role, can_create_room as "canCreateRoom"`,
        [username, name]
      );
      await client.query("insert into auth_identities (provider, subject, user_id) values ('mutsaki', $1, $2)", [subject, result.rows[0].id]);
    }
    await client.query("commit");
    return result.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function exchangeCode(code, verifier, config) {
  const credentials = { client_id: config.clientId, client_secret: config.clientSecret };
  const tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...credentials, grant_type: "authorization_code", redirect_uri: config.redirectUri, code, code_verifier: verifier }),
    signal: AbortSignal.timeout(15000)
  });
  if (!tokenResponse.ok) throw new Error("Mutsaki token exchange failed");
  const token = await tokenResponse.json();
  if (!tokenPattern.test(token.access_token || "")) throw new Error("Mutsaki access token invalid");
  try {
    const profileResponse = await fetch(userinfoUrl, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!profileResponse.ok) throw new Error("Mutsaki profile request failed");
    const profile = await profileResponse.json();
    if (typeof profile.sub !== "string" || !profile.sub || profile.sub.length > 200 ||
        typeof profile.preferred_username !== "string" || typeof profile.name !== "string") {
      throw new Error("Mutsaki profile invalid");
    }
    return profile;
  } finally {
    await fetch(revokeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...credentials, token: token.access_token }),
      signal: AbortSignal.timeout(10000)
    }).catch(() => {});
  }
}

export const mutsakiProvider = {
  id: "mutsaki",
  label: "Mutsaki 账号",
  install(app, { asyncRoute, loginLimit }) {
    const config = mutsakiConfig();
    app.get("/auth/mutsaki/start", loginLimit, asyncRoute(async (_req, res) => {
      const state = random();
      const browser = random();
      const verifier = random();
      await query("delete from oauth_pending where expires_at <= $1", [now()]);
      await query("delete from oauth_login_tickets where expires_at <= $1", [now()]);
      await query(
        "insert into oauth_pending (state_hash, browser_hash, verifier, expires_at) values ($1, $2, $3, $4)",
        [digest(state), digest(browser), verifier, now() + 300]
      );
      const authorization = new URL(authorizationUrl);
      authorization.search = new URLSearchParams({
        response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri,
        scope: "profile", state, code_challenge: challenge(verifier), code_challenge_method: "S256"
      });
      redirect(res, authorization.href, [cookie(browserCookie, browser, 300, config.secureCookie)]);
    }));

    app.get("/auth/mutsaki/callback", asyncRoute(async (req, res) => {
      res.set("Cache-Control", "no-store");
      res.set("Referrer-Policy", "no-referrer");
      const clearBrowser = cookie(browserCookie, "", 0, config.secureCookie);
      const browser = cookieValue(req, browserCookie);
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!tokenPattern.test(browser) || !tokenPattern.test(state)) {
        return redirect(res, `${config.clientOrigin}/?auth_error=invalid_state`, [clearBrowser]);
      }
      const pending = await query(
        "delete from oauth_pending where state_hash=$1 and browser_hash=$2 and expires_at>$3 returning verifier",
        [digest(state), digest(browser), now()]
      );
      if (!pending.rows[0]) return redirect(res, `${config.clientOrigin}/?auth_error=invalid_state`, [clearBrowser]);
      if (req.query.error) return redirect(res, `${config.clientOrigin}/?auth_error=cancelled`, [clearBrowser]);
      const code = typeof req.query.code === "string" ? req.query.code : "";
      if (!tokenPattern.test(code)) return redirect(res, `${config.clientOrigin}/?auth_error=invalid_code`, [clearBrowser]);
      try {
        const profile = await exchangeCode(code, pending.rows[0].verifier, config);
        const user = await findOrCreateUser(profile);
        const ticket = random();
        await query("insert into oauth_login_tickets (ticket_hash, user_id, expires_at) values ($1, $2, $3)", [digest(ticket), user.id, now() + 120]);
        return redirect(res, `${config.clientOrigin}/?auth=mutsaki`, [clearBrowser, cookie(ticketCookie, ticket, 120, config.secureCookie)]);
      } catch (error) {
        console.error("Mutsaki login failed:", error.message);
        return redirect(res, `${config.clientOrigin}/?auth_error=failed`, [clearBrowser]);
      }
    }));

    app.post("/auth/mutsaki/complete", loginLimit, asyncRoute(async (req, res) => {
      if (req.get("origin") && req.get("origin") !== config.clientOrigin) {
        return res.status(403).json({ error: "来源无效" });
      }
      const ticket = cookieValue(req, ticketCookie);
      res.append("Set-Cookie", cookie(ticketCookie, "", 0, config.secureCookie));
      res.set("Cache-Control", "no-store");
      if (!tokenPattern.test(ticket)) return res.status(401).json({ error: "登录已过期，请重试" });
      const consumed = await query(
        "delete from oauth_login_tickets where ticket_hash=$1 and expires_at>$2 returning user_id",
        [digest(ticket), now()]
      );
      if (!consumed.rows[0]) return res.status(401).json({ error: "登录已过期，请重试" });
      const result = await query(
        `select id, username, display_name as "displayName", 'mutsaki' as provider,
                role, can_create_room as "canCreateRoom"
         from users where id=$1`,
        [consumed.rows[0].user_id]
      );
      if (!result.rows[0]) return res.status(401).json({ error: "账号不存在" });
      res.json({ user: publicUser(result.rows[0]), token: signUser(result.rows[0]) });
    }));
  }
};
