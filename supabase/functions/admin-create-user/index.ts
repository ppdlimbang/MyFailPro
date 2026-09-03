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
  if (!email || password.length < 8 || !name || !agencyType) {
    return json(request, { error: "Complete all fields; password must have at least 8 characters." }, 400);
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
  return json(request, { id: result.id, email: result.email }, 201);
});
