export async function onRequest({ request, env }) {
  let origin;
  try {
    origin = new URL(env.API_ORIGIN);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
      throw new Error("Invalid API_ORIGIN");
    }
  } catch {
    return new Response("API origin is not configured", { status: 503 });
  }

  const incoming = new URL(request.url);
  const upstream = new URL(incoming.pathname + incoming.search, origin);
  const response = await fetch(new Request(upstream, request), { redirect: "manual" });
  const proxied = new Response(response.body, response);
  proxied.headers.set("Cache-Control", "no-store");
  return proxied;
}
