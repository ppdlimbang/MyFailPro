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

  const id = String(input.id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(request, { error: "Invalid user identifier." }, 400);
  if (id === admin.caller.id) return json(request, { error: "You cannot delete your own account." }, 400);

  const deleteResponse = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      apikey: config.secretKey,
      authorization: `Bearer ${config.secretKey}`
    }
  });
  if (!deleteResponse.ok) {
    let result: Record<string, unknown> = {};
    try {
      result = await deleteResponse.json();
    } catch {
      // Supabase may return an empty non-JSON error response.
    }
    return json(
      request,
      { error: result.msg || result.message || "Unable to delete user." },
      deleteResponse.status
    );
  }
  return json(request, { id }, 200);
});
