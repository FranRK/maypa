export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Inicia la app con npm run dev:local");
  const target = new URL(url);
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(target.hostname) || target.port !== "54321") {
    throw new Error("Esta etapa solo permite Supabase Auth local");
  }
  return { url, key };
}
