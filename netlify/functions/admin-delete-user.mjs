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
    headers: { apikey: secretKey }
  });
  const profiles = profileResponse.ok ? await profileResponse.json() : [];
  if (profiles[0]?.role !== "admin") return json({ error: "Admin access required." }, 403);

  let input;
  try { input = await request.json(); }
  catch { return json({ error: "Invalid JSON." }, 400); }
  const id = String(input.id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Invalid user identifier." }, 400);
  if (id === caller.id) return json({ error: "You cannot delete your own account." }, 400);

  const deleteResponse = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { apikey: secretKey }
  });
  if (!deleteResponse.ok) {
    let result = {};
    try { result = await deleteResponse.json(); } catch { /* Response was not JSON. */ }
    return json({ error: result.msg || result.message || "Unable to delete user." }, deleteResponse.status);
  }
  return json({ id }, 200);
};
