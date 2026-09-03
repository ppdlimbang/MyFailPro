import { json, type ServiceConfig } from "./http.ts";

export async function requireAdmin(request: Request, config: ServiceConfig) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return { response: json(request, { error: "Authentication required." }, 401) };
  }

  const userResponse = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.publicKey, authorization }
  });
  if (!userResponse.ok) {
    return { response: json(request, { error: "Invalid session." }, 401) };
  }
  const caller = await userResponse.json();

  const profileResponse = await fetch(
    `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=role`,
    { headers: { apikey: config.publicKey, authorization } }
  );
  const profiles = profileResponse.ok ? await profileResponse.json() : [];
  if (profiles[0]?.role !== "admin") {
    return { response: json(request, { error: "Admin access required." }, 403) };
  }
  return { caller };
}
