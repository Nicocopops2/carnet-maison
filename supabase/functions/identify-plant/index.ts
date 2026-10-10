// Edge Function : identification d'une plante à partir d'une photo, via l'API Pl@ntNet (gratuite).
// https://my.plantnet.org — offre gratuite : 500 identifications par jour, mention de Pl@ntNet requise.
// Secret requis : PLANTNET_API_KEY.
// Accès : utilisateur connecté et membre du foyer indiqué, dans la limite du quota quotidien du foyer
// (voir consume_identify_quota dans schema.sql).
// À déployer avec la vérification JWT désactivée : la fonction contrôle elle-même l'accès.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let image = "", household_id = "";
  try { ({ image, household_id } = await req.json()); } catch { /* corps invalide */ }
  if (!image || typeof image !== "string") return json({ error: "image_missing" }, 400);
  if (!household_id) return json({ error: "household_missing" }, 400);
  if (image.length > 7_000_000) return json({ error: "image_too_large" }, 413);

  // 1. Appelant connecté + membre du foyer + quota du jour (vérifié par la base, avec le jeton de l'utilisateur)
  const auth = req.headers.get("Authorization") ?? "";
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, publicKey, { global: { headers: { Authorization: auth } } });
  const { data: allowed, error: quotaErr } = await sb.rpc("consume_identify_quota", { h: household_id });
  if (quotaErr) return json({ error: "forbidden" }, 403);
  if (!allowed) return json({ error: "quota_exceeded" }, 429);

  // 2. Appel Pl@ntNet
  const key = Deno.env.get("PLANTNET_API_KEY");
  if (!key) return json({ error: "not_configured" }, 500);

  const bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("images", new Blob([bytes], { type: "image/jpeg" }), "photo.jpg");
  form.append("organs", "auto");

  const url = new URL("https://my-api.plantnet.org/v2/identify/all");
  url.searchParams.set("api-key", key);
  url.searchParams.set("lang", "fr");
  url.searchParams.set("nb-results", "3");
  url.searchParams.set("include-related-images", "false");

  const res = await fetch(url, { method: "POST", body: form });
  if (res.status === 404) return json({ results: [] });            // aucune espèce reconnue
  if (res.status === 429) return json({ error: "provider_quota" }, 429);
  if (!res.ok) {
    console.error("Pl@ntNet", res.status, await res.text());
    return json({ error: "identification_failed" }, 502);
  }

  const out = await res.json();
  // deno-lint-ignore no-explicit-any
  const results = (out.results ?? []).slice(0, 3).map((r: any) => ({
    score: r.score,
    nomLatin: r.species?.scientificNameWithoutAuthor ?? null,
    genre: r.species?.genus?.scientificNameWithoutAuthor ?? null,
    famille: r.species?.family?.scientificNameWithoutAuthor ?? null,
    nomCommun: (r.species?.commonNames ?? [])[0] ?? null,
  }));
  return json({ results });
});
