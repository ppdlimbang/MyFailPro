const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store" }
});

export default async () => {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return json({ error: "Supabase environment variables are not configured." }, 503);
  }

  return json({ url, publishableKey });
};
