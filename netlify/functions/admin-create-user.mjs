const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store" }
});

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const url = process.env.SUPABASE_URL;
  const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const authorization = request.headers.get("authorization");
  if (!url || !publicKey || !secretKey) return json({ error: "Server configuration is incomplete." }, 503);
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication required." }, 401);

  const userResponse = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: publicKey, authorization }
  });
  if (!userResponse.ok) return json({ error: "Invalid session." }, 401);
  const caller = await userResponse.json();

  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=role`, {
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` }
  });
  const profiles = profileResponse.ok ? await profileResponse.json() : [];
  if (profiles[0]?.role !== "admin") return json({ error: "Admin access required." }, 403);

  let input;
  try { input = await request.json(); }
  catch { return json({ error: "Invalid JSON." }, 400); }
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const name = String(input.name || "").trim();
  const agencyType = String(input.agencyType || "").trim();
  if (!email || password.length < 8 || !name || !agencyType) return json({ error: "Complete all fields; password must have at least 8 characters." }, 400);

  const createResponse = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name, agency_type: agencyType } })
  });
  const result = await createResponse.json();
  if (!createResponse.ok) return json({ error: result.msg || result.message || "Unable to create user." }, createResponse.status);
  return json({ id: result.id, email: result.email }, 201);
};
