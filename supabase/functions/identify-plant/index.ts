// Edge Function : identification d'une plante à partir d'une photo, via l'API Claude.
// Secrets requis : ANTHROPIC_API_KEY (et optionnellement ANTHROPIC_MODEL).
// Seuls les membres du foyer connectés peuvent l'appeler.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const PROMPT = `Tu es un botaniste spécialiste des plantes d'intérieur et de balcon en France. La photo montre une plante ou une fleur prise par un particulier chez lui.
Identifie-la et propose une fiche d'entretien pratique. Réponds UNIQUEMENT avec un objet JSON, en français, sans texte autour, de cette forme :
{"nomCommun": string, "nomLatin": string, "confiance": "haute"|"moyenne"|"faible", "arrosageJours": entier (intervalle entre deux arrosages au printemps/été en intérieur), "arrosageHiverJours": entier, "exposition": "Plein soleil"|"Lumière vive indirecte"|"Mi-ombre"|"Ombre", "conseils": [3 à 4 phrases courtes et concrètes : signe qu'il faut arroser, rempotage, engrais, erreur fréquente], "toxiciteAnimaux": phrase courte (chats/chiens)}
Si la photo ne montre pas de plante, mets "confiance": "faible" et "nomCommun": "Non identifiée".`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // 1. Vérifier que l'appelant est un membre du foyer
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: isMember, error: memberErr } = await sb.rpc("is_member");
  if (memberErr || !isMember) return json({ error: "forbidden" }, 403);

  // 2. Lire l'image (base64 JPEG, sans préfixe data:)
  let image = "";
  try { ({ image } = await req.json()); } catch { /* corps invalide */ }
  if (!image || typeof image !== "string") return json({ error: "image_missing" }, 400);
  if (image.length > 7_000_000) return json({ error: "image_too_large" }, 413);

  // 3. Appeler Claude
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "server_not_configured" }, 500);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) {
    console.error("Claude API", res.status, await res.text());
    return json({ error: "identification_failed" }, 502);
  }
  const out = await res.json();
  const text: string = (out.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return json({ error: "unparseable_answer" }, 502);
  try {
    return json(JSON.parse(match[0]));
  } catch {
    return json({ error: "unparseable_answer" }, 502);
  }
});
