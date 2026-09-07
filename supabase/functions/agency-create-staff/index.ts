import { requireAgencyOwner } from "../_shared/auth.ts";
import { isOriginAllowed, json, preflight, serviceConfig } from "../_shared/http.ts";

const avatarKeys = new Set(["initials", "professional", "man", "woman", "technology", "educator"]);

async function rollbackAuthUser(config: NonNullable<ReturnType<typeof serviceConfig>>, id: string) {
  await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` }
  });
}

Deno.serve(async request => {
  const optionsResponse = preflight(request);
  if (optionsResponse) return optionsResponse;
  if (!isOriginAllowed(request)) return json(request, { error: "Origin not allowed." }, 403);
  if (request.method !== "POST") return json(request, { error: "Method not allowed." }, 405);

  const config = serviceConfig();
  if (!config) return json(request, { error: "Konfigurasi Edge Function belum lengkap." }, 503);

  const agency = await requireAgencyOwner(request, config);
  if (agency.response) return agency.response;

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return json(request, { error: "Data permintaan tidak sah." }, 400);
  }

  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const name = String(input.name || "").trim();
  const avatarKey = String(input.avatar || "initials");
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !name) {
    return json(request, { error: "Lengkapkan nama dan e-mel; kata laluan mesti sekurang-kurangnya 8 aksara." }, 400);
  }
  if (!avatarKeys.has(avatarKey)) {
    return json(request, { error: "Pilihan avatar tidak sah." }, 400);
  }

  const createResponse = await fetch(`${config.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: config.secretKey,
      authorization: `Bearer ${config.secretKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, agency_type: agency.profile.agency_type, avatar_key: avatarKey }
    })
  });
  const result = await createResponse.json();
  if (!createResponse.ok) {
    return json(request, { error: result.msg || result.message || "Akaun pegawai tidak dapat dicipta." }, createResponse.status);
  }

  const staffId = String(result.id || "");
  const profileResponse = await fetch(`${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(staffId)}`, {
    method: "PATCH",
    headers: {
      apikey: config.secretKey,
      authorization: `Bearer ${config.secretKey}`,
      "content-type": "application/json",
      prefer: "return=representation"
    },
    body: JSON.stringify({
      role: "staff",
      agency_id: agency.caller.id,
      agency_type: agency.profile.agency_type,
      avatar_key: avatarKey
    })
  });
  if (!profileResponse.ok) {
    let profileError: Record<string, unknown> = {};
    try { profileError = await profileResponse.json(); } catch { /* Preserve fallback message. */ }
    await rollbackAuthUser(config, staffId);
    return json(request, {
      error: profileError.message || "Profil pegawai tidak dapat dipautkan kepada agensi. Pastikan semua migrasi pengguna pegawai telah dijalankan."
    }, 500);
  }

  await fetch(`${config.url}/rest/v1/agency_settings?owner_id=eq.${encodeURIComponent(staffId)}`, {
    method: "DELETE",
    headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` }
  });

  return json(request, { id: staffId, email: result.email, name, avatar: avatarKey }, 201);
});
