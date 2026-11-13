import { isOriginAllowed, json, preflight, serviceConfig } from "../_shared/http.ts";

Deno.serve(async request => {
  const optionsResponse = preflight(request);
  if (optionsResponse) return optionsResponse;
  if (!isOriginAllowed(request)) return json(request, { error: "Origin not allowed." }, 403);
  if (request.method !== "POST") return json(request, { error: "Method not allowed." }, 405);

  const config = serviceConfig();
  if (!config) return json(request, { error: "Konfigurasi Edge Function belum lengkap." }, 503);

  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json(request, { error: "Log masuk diperlukan." }, 401);
  const userResponse = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.publicKey, authorization }
  });
  if (!userResponse.ok) return json(request, { error: "Sesi tidak sah." }, 401);
  const caller = await userResponse.json();
  const callerResponse = await fetch(
    `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=id,role,agency_type,agency_id`,
    { headers: { apikey: config.publicKey, authorization } }
  );
  const callerProfiles = callerResponse.ok ? await callerResponse.json() : [];
  const callerProfile = callerProfiles[0];
  const officeId = callerProfile?.role === "staff" ? callerProfile.agency_id : callerProfile?.id;
  if (!officeId || !["agency", "staff"].includes(callerProfile.role)) {
    return json(request, { error: "Akses Pejabat Pendidikan diperlukan." }, 403);
  }

  const officeResponse = await fetch(
    `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(officeId)}&role=eq.agency&agency_type=ilike.pejabat&select=id`,
    { headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` } }
  );
  const officeRows = officeResponse.ok ? await officeResponse.json() : [];
  if (!officeRows.length || (callerProfile.role === "agency" && callerProfile.agency_type?.trim().toLocaleLowerCase("ms-MY") !== "pejabat")) {
    return json(request, { error: "Akses Pejabat Pendidikan diperlukan." }, 403);
  }

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return json(request, { error: "Data permintaan tidak sah." }, 400);
  }
  const schoolId = String(input.id || "").trim();
  const name = String(input.name || "").trim().replace(/\s+/g, " ");
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)) return json(request, { error: "Pengecam sekolah tidak sah." }, 400);
  if (!name || name.length > 160) return json(request, { error: "Nama sekolah diperlukan dan tidak boleh melebihi 160 aksara." }, 400);
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return json(request, { error: "Alamat e-mel akaun sekolah tidak sah." }, 400);
  if (password && password.length < 8) return json(request, { error: "Kata laluan baharu mesti sekurang-kurangnya 8 aksara." }, 400);

  const headers = { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` };
  const schoolResponse = await fetch(
    `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(schoolId)}&role=eq.agency&agency_type=ilike.sekolah&ped_office_id=eq.${encodeURIComponent(officeId)}&select=id,name,email`,
    { headers }
  );
  const schools = schoolResponse.ok ? await schoolResponse.json() : [];
  const school = schools[0];
  if (!school) return json(request, { error: "Akaun sekolah tidak ditemui di bawah Pejabat anda." }, 404);

  const authLookup = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(schoolId)}`, { headers });
  const authUser = authLookup.ok ? await authLookup.json() : {};
  if (!authLookup.ok) return json(request, { error: authUser.msg || authUser.message || "Akaun sekolah tidak ditemui." }, authLookup.status);

  const profileUpdate = await fetch(
    `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(schoolId)}&ped_office_id=eq.${encodeURIComponent(officeId)}`,
    {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ name, email })
    }
  );
  if (!profileUpdate.ok) return json(request, { error: "Maklumat akaun sekolah tidak dapat dikemas kini." }, profileUpdate.status);

  const authPayload: Record<string, unknown> = {
    user_metadata: { ...(authUser.user_metadata || {}), name }
  };
  if (email !== String(authUser.email || school.email).trim().toLowerCase()) {
    authPayload.email = email;
    authPayload.email_confirm = true;
  }
  if (password) authPayload.password = password;
  const authUpdate = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(schoolId)}`, {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(authPayload)
  });
  if (!authUpdate.ok) {
    await fetch(
      `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(schoolId)}&ped_office_id=eq.${encodeURIComponent(officeId)}`,
      {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify({ name: school.name, email: school.email })
      }
    );
    let authError: Record<string, unknown> = {};
    try { authError = await authUpdate.json(); } catch { /* Preserve fallback message. */ }
    return json(request, { error: authError.msg || authError.message || "Akaun sekolah tidak dapat dikemas kini." }, authUpdate.status);
  }

  return json(request, { id: schoolId, name, email, passwordChanged: Boolean(password) }, 200);
});
