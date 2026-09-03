export type ServiceConfig = {
  url: string;
  publicKey: string;
  secretKey: string;
};

const defaultOrigins = [
  "https://ppdlimbang.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
];

function allowedOrigins() {
  const configured = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  return new Set([...defaultOrigins, ...configured]);
}

export function isOriginAllowed(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || allowedOrigins().has(origin);
}

export function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const allowOrigin = origin && allowedOrigins().has(origin)
    ? origin
    : defaultOrigins[0];
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

export function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request),
      "cache-control": "no-store"
    }
  });
}

export function preflight(request: Request) {
  if (request.method !== "OPTIONS") return null;
  if (!isOriginAllowed(request)) return json(request, { error: "Origin not allowed." }, 403);
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function keyFromCollection(raw: string | undefined) {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed?.default ?? Object.values(parsed || {})[0];
    if (typeof candidate === "string") return candidate;
    if (candidate && typeof candidate === "object" && "key" in candidate) {
      return String((candidate as { key: unknown }).key || "");
    }
  } catch {
    return raw;
  }
  return "";
}

export function serviceConfig(): ServiceConfig | null {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
    || keyFromCollection(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))
    || Deno.env.get("SUPABASE_ANON_KEY")
    || "";
  const secretKey = Deno.env.get("SUPABASE_SECRET_KEY")
    || keyFromCollection(Deno.env.get("SUPABASE_SECRET_KEYS"))
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    || "";
  return url && publicKey && secretKey
    ? { url: url.replace(/\/$/, ""), publicKey, secretKey }
    : null;
}
