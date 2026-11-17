export default async function handler(request, response) {
  const apiOrigin = process.env.SKILLY_API_URL;
  if (!apiOrigin) {
    return response.status(503).json({ error: "Skilly API is not connected yet." });
  }

  const path = Array.isArray(request.query.path) ? request.query.path.join("/") : "";
  const target = new URL(`/api/${path}${new URL(request.url, "http://localhost").search}`, apiOrigin);
  const headers = new Headers();
  if (request.headers.authorization) headers.set("authorization", request.headers.authorization);
  if (request.headers["content-type"]) headers.set("content-type", request.headers["content-type"]);

  let body;
  if (!["GET", "HEAD"].includes(request.method)) {
    body = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
  }

  try {
    const upstream = await fetch(target, { method: request.method, headers, body });
    response.status(upstream.status);
    response.setHeader("content-type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    return response.send(await upstream.text());
  } catch (error) {
    console.error("Skilly API proxy error", error);
    return response.status(502).json({ error: "The Skilly API could not be reached." });
  }
}
