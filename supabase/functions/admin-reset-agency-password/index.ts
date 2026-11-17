import { requireAdmin } from "../_shared/auth.ts";
import { isOriginAllowed, json, preflight, serviceConfig } from "../_shared/http.ts";

Deno.serve(async request => {
  const optionsResponse = preflight(request);
  if (optionsResponse) return optionsResponse;
  if (!isOriginAllowed(request)) return json(request, { error: "Origin tidak dibenarkan." }, 403);
  if (request.method !== "POST") return json(request, { error: "Kaedah tidak dibenarkan." }, 405);
  const config = serviceConfig();
  if (!config) return json(request, { error: "Konfigurasi Edge Function belum lengkap." }, 503);
  const admin = await requireAdmin(request, config);
  if (admin.response) return admin.response;

  let input: Record<string, unknown>;
  try { input = await request.json(); }
  catch { return json(request, { error: "Data permintaan tidak sah." }, 400); }
  const id = String(input.id || "").trim();
  const password = String(input.password || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(request, { error: "Pengecam agensi tidak sah." }, 400);
  if (password.length < 8 || password.length > 128) return json(request, { error: "Kata laluan mesti mengandungi 8 hingga 128 aksara." }, 400);

  const headers = { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` };
  const profileResponse = await fetch(`${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&role=eq.agency&select=id`, { headers });
  if (!profileResponse.ok) return json(request, { error: "Profil agensi tidak dapat disahkan." }, 502);
  const profiles = await profileResponse.json();
  if (!profiles.length) return json(request, { error: "Akaun agensi tidak ditemui." }, 404);

  const updateResponse = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ password })
  });
  if (!updateResponse.ok) {
    let result: Record<string, unknown> = {};
    try { result = await updateResponse.json(); } catch { /* Keep the fallback message. */ }
    return json(request, { error: result.msg || result.message || "Kata laluan agensi tidak dapat direset." }, updateResponse.status);
  }
  return json(request, { id, reset: true }, 200);
});
