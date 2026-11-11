const APP_ORIGIN = "https://epokdotexe.github.io";
const OWNER_LOGIN = "epokDOTexe";
const SESSION_TTL = 12 * 60 * 60;
const EXCHANGE_TTL = 90;

function cors(origin) {
  if (origin !== APP_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Credentials": "false",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Vary": "Origin"
  };
}

function response(data, status, origin, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...cors(origin),
      ...extra
    }
  });
}

function randomToken(bytes = 32) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, "0")).join("");
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function issueSession(login, secret) {
  const payload = btoa(JSON.stringify({ sub: login, exp: Math.floor(Date.now()/1000) + SESSION_TTL }))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return payload + "." + await sign(payload, secret);
}

async function verifySession(token, secret) {
  if (!token || !token.includes(".")) return false;
  const [payload, signature] = token.split(".");
  if (await sign(payload, secret) !== signature) return false;
  try {
    const data = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return data.sub === OWNER_LOGIN && data.exp > Math.floor(Date.now()/1000);
  } catch { return false; }
}

async function githubFetch(path, token) {
  return fetch("https://api.github.com" + path, {
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "EPOK-SOCIAL"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (url.pathname === "/auth/login" && request.method === "GET") {
      const state = randomToken(24);
      await env.EPOK_DATA.put("oauth_state:" + state, "1", { expirationTtl: 300 });
      const callback = url.origin + "/auth/callback";
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      authorize.searchParams.set("redirect_uri", callback);
      authorize.searchParams.set("scope", "read:user");
      authorize.searchParams.set("state", state);
      return Response.redirect(authorize.toString(), 302);
    }

    if (url.pathname === "/auth/callback" && request.method === "GET") {
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!state || !code || !await env.EPOK_DATA.get("oauth_state:" + state)) {
        return new Response("Connexion refusée : état OAuth invalide.", { status: 400 });
      }
      await env.EPOK_DATA.delete("oauth_state:" + state);

      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: url.origin + "/auth/callback"
        })
      });
      const tokenData = await tokenResponse.json();
      if (!tokenData.access_token) return new Response("Échec de l'authentification GitHub.", { status: 401 });

      const userResponse = await githubFetch("/user", tokenData.access_token);
      const user = await userResponse.json();
      if (!userResponse.ok || user.login !== OWNER_LOGIN) {
        return new Response("Ce compte GitHub n'est pas autorisé.", { status: 403 });
      }

      const exchange = randomToken(24);
      await env.EPOK_DATA.put("oauth_exchange:" + exchange, user.login, { expirationTtl: EXCHANGE_TTL });
      return Response.redirect(APP_ORIGIN + "/epok-social/?auth_code=" + exchange, 302);
    }

    if (url.pathname === "/auth/exchange" && request.method === "POST") {
      if (origin !== APP_ORIGIN) return response({ error: "Origine refusée" }, 403, origin);
      const body = await request.json().catch(() => ({}));
      const code = body.code;
      if (typeof code !== "string" || code.length > 100) return response({ error: "Code invalide" }, 400, origin);
      const login = await env.EPOK_DATA.get("oauth_exchange:" + code);
      if (!login) return response({ error: "Code expiré ou déjà utilisé" }, 401, origin);
      await env.EPOK_DATA.delete("oauth_exchange:" + code);
      const token = await issueSession(login, env.SESSION_SECRET);
      return response({ authenticated: true, login, token }, 200, origin);
    }

    if (url.pathname === "/api/content" && request.method === "GET") {
      const content = await env.EPOK_DATA.get("site_content");
      return response(content ? JSON.parse(content) : {}, 200, origin);
    }

    if (url.pathname === "/api/content" && request.method === "PUT") {
      if (origin !== APP_ORIGIN) return response({ error: "Origine refusée" }, 403, origin);
      const auth = request.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!await verifySession(token, env.SESSION_SECRET)) {
        return response({ error: "Authentification administrateur requise" }, 401, origin);
      }
      const content = await request.json().catch(() => null);
      if (!content || typeof content !== "object" || Array.isArray(content)) {
        return response({ error: "Format de contenu invalide" }, 400, origin);
      }
      const serialized = JSON.stringify(content);
      if (serialized.length > 100000) return response({ error: "Contenu trop volumineux" }, 413, origin);
      await env.EPOK_DATA.put("site_content", serialized);
      return response({ saved: true }, 200, origin);
    }

    if (url.pathname === "/auth/me" && request.method === "GET") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const valid = await verifySession(token, env.SESSION_SECRET);
      return response({ authenticated: valid, login: valid ? OWNER_LOGIN : null }, 200, origin);
    }

    return new Response("Not found", { status: 404 });
  }
};
