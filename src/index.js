const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const fail = (message, status = 400) => json({ error: message }, status);
const encoder = new TextEncoder();
const toHex = (buffer) => [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
};

async function sha256(value) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 120000, hash: "SHA-256" }, key, 256);
  return toHex(bits);
}

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, major: row.major, bio: row.bio, createdAt: row.created_at };
}

async function createSession(db, userId) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(tokenHash, userId, expiresAt).run();
  return { token, expiresAt };
}

async function currentUser(request, db) {
  const header = request.headers.get("authorization") || "";
  const token = header.match(/^Bearer\s+([a-f0-9]{64})$/i)?.[1];
  if (!token) return null;
  const row = await db.prepare(`
    SELECT u.id, u.name, u.email, u.major, u.bio, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(await sha256(token), new Date().toISOString()).first();
  return row || null;
}

async function requireUser(request, db) {
  const user = await currentUser(request, db);
  return user ? { user } : { response: fail("Please sign in to continue.", 401) };
}

async function register(request, env) {
  const body = await readBody(request);
  if (!body) return fail("Enter your profile details and try again.");
  const name = cleanText(body.name, 80);
  const email = cleanText(body.email, 254).toLowerCase();
  const major = cleanText(body.major, 100);
  const bio = cleanText(body.bio, 400);
  const password = typeof body.password === "string" ? body.password : "";
  if (name.length < 2) return fail("Add your name (at least 2 characters). ");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email address.");
  if (password.length < 8 || password.length > 128) return fail("Your password must be 8 to 128 characters.");
  const exists = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (exists) return fail("An account with this email already exists. Sign in instead.", 409);
  const salt = randomToken();
  const hash = await passwordHash(password, salt);
  const user = { id: crypto.randomUUID(), name, email, major, bio };
  try {
    await env.DB.prepare(`INSERT INTO users (id, name, email, major, bio, password_salt, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(user.id, name, email, major, bio, salt, hash).run();
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) return fail("An account with this email already exists. Sign in instead.", 409);
    throw error;
  }
  const session = await createSession(env.DB, user.id);
  return json({ user: { ...user, createdAt: new Date().toISOString() }, ...session }, 201);
}

async function login(request, env) {
  const body = await readBody(request);
  const email = cleanText(body?.email, 254).toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return fail("Enter your email and password.");
  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!row || await passwordHash(password, row.password_salt) !== row.password_hash) return fail("Email or password is incorrect.", 401);
  const session = await createSession(env.DB, row.id);
  return json({ user: publicUser(row), ...session });
}

async function listSkills(request, env) {
  const url = new URL(request.url);
  const query = cleanText(url.searchParams.get("q"), 100).toLowerCase();
  const category = cleanText(url.searchParams.get("category"), 20);
  if (category && !["Creative", "Tech", "Study", "Life"].includes(category)) return fail("Choose a valid category.");
  const rows = await env.DB.prepare(`
    SELECT s.id AS listing_id, u.id AS owner_id, u.name, u.major, u.bio, s.can_teach, s.wants_to_learn,
      s.category, s.availability, s.created_at
    FROM skills s JOIN users u ON u.id = s.owner_id
    WHERE (? = '' OR s.category = ?)
      AND (? = '' OR lower(u.name || ' ' || u.major || ' ' || s.can_teach || ' ' || s.wants_to_learn || ' ' || s.category) LIKE '%' || ? || '%')
    ORDER BY s.created_at DESC LIMIT 100
  `).bind(category, category, query, query).all();
  return json({ skills: rows.results });
}

async function addSkill(request, env) {
  const auth = await requireUser(request, env.DB);
  if (auth.response) return auth.response;
  const body = await readBody(request);
  const canTeach = cleanText(body?.canTeach, 100);
  const wantsToLearn = cleanText(body?.wantsToLearn, 100);
  const category = cleanText(body?.category, 20);
  const availability = cleanText(body?.availability, 100);
  if (canTeach.length < 2 || wantsToLearn.length < 2) return fail("Add both a skill you can teach and one you want to learn.");
  if (!["Creative", "Tech", "Study", "Life"].includes(category)) return fail("Choose a valid category.");
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO skills (id, owner_id, can_teach, wants_to_learn, category, availability) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, auth.user.id, canTeach, wantsToLearn, category, availability).run();
  return json({ skill: { id, owner_id: auth.user.id, name: auth.user.name, major: auth.user.major, bio: auth.user.bio, can_teach: canTeach, wants_to_learn: wantsToLearn, category, availability } }, 201);
}

async function deleteSkill(request, env, id) {
  const auth = await requireUser(request, env.DB);
  if (auth.response) return auth.response;
  const result = await env.DB.prepare("DELETE FROM skills WHERE id = ? AND owner_id = ?").bind(id, auth.user.id).run();
  if (!result.meta.changes) return fail("This listing was not found on your profile.", 404);
  return json({ ok: true });
}

async function updateProfile(request, env) {
  const auth = await requireUser(request, env.DB);
  if (auth.response) return auth.response;
  const body = await readBody(request);
  const name = cleanText(body?.name, 80);
  const major = cleanText(body?.major, 100);
  const bio = cleanText(body?.bio, 400);
  if (name.length < 2) return fail("Add your name (at least 2 characters).");
  await env.DB.prepare("UPDATE users SET name = ?, major = ?, bio = ? WHERE id = ?").bind(name, major, bio, auth.user.id).run();
  const user = await env.DB.prepare("SELECT id, name, email, major, bio, created_at FROM users WHERE id = ?").bind(auth.user.id).first();
  return json({ user: publicUser(user) });
}

async function listSwaps(request, env) {
  const auth = await requireUser(request, env.DB);
  if (auth.response) return auth.response;
  const rows = await env.DB.prepare(`
    SELECT r.id, r.from_user_id, r.to_user_id, r.skill_id, r.wants_to_learn, r.can_offer, r.message,
      r.scheduled_at, r.status, r.created_at, r.updated_at,
      sender.name AS from_name, sender.major AS from_major,
      recipient.name AS to_name, recipient.major AS to_major,
      skill.can_teach AS listed_skill
    FROM swap_requests r
    JOIN users sender ON sender.id = r.from_user_id
    JOIN users recipient ON recipient.id = r.to_user_id
    JOIN skills skill ON skill.id = r.skill_id
    WHERE r.from_user_id = ? OR r.to_user_id = ?
    ORDER BY r.created_at DESC LIMIT 100
  `).bind(auth.user.id, auth.user.id).all();
  return json({ swaps: rows.results });
}

async function createSwap(request, env) {
  const auth = await requireUser(request, env.DB);
  if (auth.response) return auth.response;
  const body = await readBody(request);
  const skillId = cleanText(body?.skillId, 60);
  const wantsToLearn = cleanText(body?.wantsToLearn, 100);
  const canOffer = cleanText(body?.canOffer, 100);
  const message = cleanText(body?.message, 600);
  const scheduledAt = typeof body?.scheduledAt === "string" ? new Date(body.scheduledAt) : null;
  if (!skillId || wantsToLearn.length < 2 || canOffer.length < 2) return fail("Fill in the requested skill and your offer.");
  if (!scheduledAt || Number.isNaN(scheduledAt.valueOf()) || scheduledAt.valueOf() < Date.now() + 5 * 60 * 1000) return fail("Choose a session time at least five minutes from now.");
  const skill = await env.DB.prepare("SELECT id, owner_id FROM skills WHERE id = ?").bind(skillId).first();
  if (!skill) return fail("That skill listing is no longer available. Refresh the page.", 404);
  if (skill.owner_id === auth.user.id) return fail("You cannot request a swap with your own listing.");
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO swap_requests (id, from_user_id, to_user_id, skill_id, wants_to_learn, can_offer, message, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, auth.user.id, skill.owner_id, skill.id, wantsToLearn, canOffer, message, scheduledAt.toISOString()).run();
  return json({ id, status: "pending", scheduled_at: scheduledAt.toISOString() }, 201);
}

async function updateSwap(request, env, id) {
  const auth = await requireUser(request, env.DB);
  if (auth.response) return auth.response;
  const body = await readBody(request);
  const status = body?.status;
  if (!["accepted", "declined"].includes(status)) return fail("Choose accept or decline.");
  const result = await env.DB.prepare(`UPDATE swap_requests SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND to_user_id = ? AND status = 'pending'`).bind(status, id, auth.user.id).run();
  if (!result.meta.changes) return fail("This request is no longer pending or does not belong to your account.", 409);
  return json({ id, status });
}

async function routeApi(request, env) {
  const { pathname } = new URL(request.url);
  const method = request.method.toUpperCase();
  if (pathname === "/api/health" && method === "GET") return json({ ok: true, service: "skilly-api" });
  if (pathname === "/api/auth/register" && method === "POST") return register(request, env);
  if (pathname === "/api/auth/login" && method === "POST") return login(request, env);
  if (pathname === "/api/auth/logout" && method === "POST") {
    const token = (request.headers.get("authorization") || "").match(/^Bearer\s+([a-f0-9]{64})$/i)?.[1];
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return json({ ok: true });
  }
  if (pathname === "/api/me" && method === "GET") {
    const auth = await requireUser(request, env.DB);
    if (auth.response) return auth.response;
    const rows = await env.DB.prepare("SELECT id, can_teach, wants_to_learn, category, availability, created_at FROM skills WHERE owner_id = ? ORDER BY created_at DESC").bind(auth.user.id).all();
    return json({ user: publicUser(auth.user), skills: rows.results });
  }
  if (pathname === "/api/me" && method === "PATCH") return updateProfile(request, env);
  if (pathname === "/api/skills" && method === "GET") return listSkills(request, env);
  if (pathname === "/api/skills" && method === "POST") return addSkill(request, env);
  const skillId = pathname.match(/^\/api\/skills\/([\w-]+)$/)?.[1];
  if (skillId && method === "DELETE") return deleteSkill(request, env, skillId);
  if (pathname === "/api/swaps" && method === "GET") return listSwaps(request, env);
  if (pathname === "/api/swaps" && method === "POST") return createSwap(request, env);
  const swapId = pathname.match(/^\/api\/swaps\/([\w-]+)$/)?.[1];
  if (swapId && method === "PATCH") return updateSwap(request, env, swapId);
  return fail("That API route was not found.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await routeApi(request, env);
    } catch (error) {
      console.error("Skilly API error", error);
      return fail("The server could not complete that request. Please try again.", 500);
    }
  }
};
