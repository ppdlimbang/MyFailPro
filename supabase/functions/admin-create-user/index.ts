import { requireAdmin } from "../_shared/auth.ts";
import { isOriginAllowed, json, preflight, serviceConfig } from "../_shared/http.ts";

Deno.serve(async request => {
  const optionsResponse = preflight(request);
  if (optionsResponse) return optionsResponse;
  if (!isOriginAllowed(request)) return json(request, { error: "Origin not allowed." }, 403);
  if (request.method !== "POST") return json(request, { error: "Method not allowed." }, 405);

  const config = serviceConfig();
  if (!config) return json(request, { error: "Edge Function configuration is incomplete." }, 503);

  const admin = await requireAdmin(request, config);
  if (admin.response) return admin.response;

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return json(request, { error: "Invalid JSON." }, 400);
  }

  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const name = String(input.name || "").trim();
  const agencyType = String(input.agencyType || "").trim();
  const parentAgencyId = String(input.parentAgencyId || "").trim();
  if (!email || password.length < 8 || !name || !agencyType) {
    return json(request, { error: "Complete all fields; password must have at least 8 characters." }, 400);
  }
  if (agencyType === "Sekolah" && !parentAgencyId) {
    return json(request, { error: "Pilih Pejabat Pendidikan untuk akaun sekolah." }, 400);
  }
  if (agencyType !== "Sekolah" && parentAgencyId) {
    return json(request, { error: "Pejabat Pendidikan hanya boleh dipilih untuk akaun sekolah." }, 400);
  }
  if (parentAgencyId) {
    const parentResponse = await fetch(
      `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(parentAgencyId)}&role=eq.agency&agency_type=eq.Pejabat&select=id`,
      { headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` } }
    );
    const parentRows = parentResponse.ok ? await parentResponse.json() : [];
    if (!parentResponse.ok || !parentRows.length) {
      return json(request, { error: "Pejabat Pendidikan yang dipilih tidak sah." }, 400);
    }
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
      user_metadata: { name, agency_type: agencyType }
    })
  });
  const result = await createResponse.json();
  if (!createResponse.ok) {
    return json(request, { error: result.msg || result.message || "Unable to create user." }, createResponse.status);
  }
  if (parentAgencyId) {
    const updateResponse = await fetch(
      `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(result.id)}`,
      {
        method: "PATCH",
        headers: {
          apikey: config.secretKey,
          authorization: `Bearer ${config.secretKey}`,
          "content-type": "application/json",
          "prefer": "return=minimal"
        },
        body: JSON.stringify({ parent_agency_id: parentAgencyId })
      }
    );
    if (!updateResponse.ok) {
      await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(result.id)}`, {
        method: "DELETE",
        headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` }
      });
      return json(request, { error: "Hubungan Pejabat Pendidikan gagal disimpan. Pastikan migrasi pangkalan data terkini telah dijalankan." }, 500);
    }
  }
  return json(request, { id: result.id, email: result.email }, 201);
});
