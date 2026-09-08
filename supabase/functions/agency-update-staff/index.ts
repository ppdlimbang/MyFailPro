import { requireAgencyOwner } from "../_shared/auth.ts";
import { isOriginAllowed, json, preflight, serviceConfig } from "../_shared/http.ts";

const avatarKeys = new Set(["initials", "professional", "man", "woman", "technology", "educator"]);

function formatPersonName(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ms-MY")
    .replace(/(^|[\s@'’/-])(\p{L})/gu, (_match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("ms-MY")}`);
}

async function updateStaffProfile(
  config: NonNullable<ReturnType<typeof serviceConfig>>,
  agencyId: string,
  staffId: string,
  values: { name: string; email: string; avatar_key: string }
) {
  return fetch(
    `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(staffId)}&agency_id=eq.${encodeURIComponent(agencyId)}&role=eq.staff`,
    {
      method: "PATCH",
      headers: {
        apikey: config.secretKey,
        authorization: `Bearer ${config.secretKey}`,
        "content-type": "application/json",
        prefer: "return=representation"
      },
      body: JSON.stringify(values)
    }
  );
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

  const staffId = String(input.id || "").trim();
  const name = formatPersonName(input.name);
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const avatarKey = String(input.avatar || "initials");
  if (!/^[0-9a-f-]{36}$/i.test(staffId)) {
    return json(request, { error: "Pengecam pengguna tidak sah." }, 400);
  }
  if (password && password.length < 8) {
    return json(request, { error: "Kata laluan baharu mesti sekurang-kurangnya 8 aksara." }, 400);
  }
  if (!name || name.length > 160) {
    return json(request, { error: "Nama pegawai diperlukan dan tidak boleh melebihi 160 aksara." }, 400);
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    return json(request, { error: "Alamat e-mel pegawai tidak sah." }, 400);
  }
  if (!avatarKeys.has(avatarKey)) {
    return json(request, { error: "Pilihan avatar tidak sah." }, 400);
  }

  const profileLookup = await fetch(
    `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(staffId)}&agency_id=eq.${encodeURIComponent(agency.caller.id)}&role=eq.staff&select=id,name,email,avatar_key`,
    { headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` } }
  );
  const profiles = profileLookup.ok ? await profileLookup.json() : [];
  const profile = profiles[0];
  if (!profile) {
    return json(request, { error: "Akaun pegawai tidak ditemui dalam agensi anda." }, 404);
  }

  const authLookup = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(staffId)}`, {
    headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` }
  });
  const authUser = authLookup.ok ? await authLookup.json() : {};
  if (!authLookup.ok) {
    return json(request, { error: authUser.msg || authUser.message || "Akaun Auth pegawai tidak ditemui." }, authLookup.status);
  }

  const updatedProfile = { name, email, avatar_key: avatarKey };
  const profileUpdate = await updateStaffProfile(config, agency.caller.id, staffId, updatedProfile);
  if (!profileUpdate.ok) {
    let profileError: Record<string, unknown> = {};
    try { profileError = await profileUpdate.json(); } catch { /* Preserve fallback message. */ }
    return json(request, { error: profileError.message || "Maklumat profil pegawai tidak dapat dikemas kini." }, profileUpdate.status);
  }

  const authPayload: Record<string, unknown> = {
    user_metadata: { ...(authUser.user_metadata || {}), name, avatar_key: avatarKey }
  };
  if (email !== String(authUser.email || profile.email).trim().toLowerCase()) {
    authPayload.email = email;
    authPayload.email_confirm = true;
  }
  if (password) authPayload.password = password;
  const authUpdate = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(staffId)}`, {
    method: "PUT",
    headers: {
      apikey: config.secretKey,
      authorization: `Bearer ${config.secretKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(authPayload)
  });
  if (!authUpdate.ok) {
    await updateStaffProfile(config, agency.caller.id, staffId, {
      name: profile.name,
      email: profile.email,
      avatar_key: profile.avatar_key || "initials"
    });
    let authError: Record<string, unknown> = {};
    try { authError = await authUpdate.json(); } catch { /* Preserve fallback message. */ }
    return json(request, { error: authError.msg || authError.message || "Akaun pegawai tidak dapat dikemas kini." }, authUpdate.status);
  }

  return json(request, {
    id: staffId,
    name,
    email,
    avatar: avatarKey,
    passwordChanged: Boolean(password)
  });
});
