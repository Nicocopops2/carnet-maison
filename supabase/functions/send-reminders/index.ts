// Edge Function : rappel quotidien par foyer (appelée chaque matin par pg_cron, voir supabase/cron.sql).
// Pour chaque foyer : plantes à arroser + tâches dues → une notification aux appareils de ses membres.
// Une personne membre de deux foyers reçoit deux notifications distinctes.
// Secrets requis : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...), CRON_SECRET.
// Déployer avec la vérification JWT désactivée : l'accès est protégé par l'en-tête x-cron-secret.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const TZ = "Europe/Paris";
const todayParis = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
const monthParis = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, month: "numeric" }).format(new Date()));
const toUTC = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const daysUntil = (from: string, interval: number, today: string) =>
  Math.round((toUTC(from) + interval * 864e5 - toUTC(today)) / 864e5);
const list = (names: string[], max = 3) =>
  names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} et ${names.length - max} autre${names.length - max > 1 ? "s" : ""}`;

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("forbidden", { status: 403 });
  const force = new URL(req.url).searchParams.get("force") === "1";

  // Clé serveur : injectée automatiquement par Supabase ; SERVICE_KEY en secours (clé sb_secret_… ajoutée à la main).
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_KEY");
  if (!serviceKey) return Response.json({ error: "service key missing" }, { status: 500 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const today = todayParis();
  const winter = [11, 12, 1, 2].includes(monthParis());

  const [hh, mem, pl, tk, sub] = await Promise.all([
    sb.from("households").select("id,name"),
    sb.from("household_members").select("household_id,user_id"),
    sb.from("plants").select("household_id,data"),
    sb.from("tasks").select("household_id,data"),
    sb.from("push_subscriptions").select("endpoint,subscription,user_id"),
  ]);
  const err = hh.error ?? mem.error ?? pl.error ?? tk.error ?? sub.error;
  if (err) return Response.json({ error: err.message }, { status: 500 });

  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

  let sent = 0;
  const expired = new Set<string>();
  const report: Record<string, unknown>[] = [];

  for (const h of hh.data ?? []) {
    // deno-lint-ignore no-explicit-any
    const duePlants = (pl.data ?? []).filter((r: any) => r.household_id === h.id).filter(({ data: p }: any) => {
      const base = p.waterEveryDays || 7;
      const interval = winter ? (p.waterWinterDays || Math.round(base * 1.5)) : base;
      return daysUntil(p.lastWatered || today, interval, today) <= 0;
    // deno-lint-ignore no-explicit-any
    }).map((r: any) => r.data.name || "Plante");
    // deno-lint-ignore no-explicit-any
    const dueTasks = (tk.data ?? []).filter((r: any) => r.household_id === h.id)
      // deno-lint-ignore no-explicit-any
      .filter(({ data: t }: any) => daysUntil(t.lastDone || today, t.everyDays || 30, today) <= 0)
      // deno-lint-ignore no-explicit-any
      .map((r: any) => r.data.title);

    const count = duePlants.length + dueTasks.length;
    if (count === 0 && !force) continue;

    const userIds = new Set((mem.data ?? []).filter(m => m.household_id === h.id).map(m => m.user_id));
    const targets = (sub.data ?? []).filter(s => userIds.has(s.user_id));
    if (!targets.length) continue;

    const parts: string[] = [];
    if (duePlants.length) parts.push(`Arroser : ${list(duePlants)}`);
    if (dueTasks.length) parts.push(list(dueTasks, 2));
    const payload = JSON.stringify({
      title: count === 0 ? h.name : `${h.name} · ${count === 1 ? "1 chose" : `${count} choses`} à faire`,
      body: parts.length ? parts.join(" · ") : "Rien d'urgent aujourd'hui (notification de test).",
      url: `./?tab=home&foyer=${h.id}`,
      tag: `rappel-${h.id}-${today}`,
      count,
    });

    await Promise.all(targets.map(async (s) => {
      try { await webpush.sendNotification(s.subscription, payload, { TTL: 60 * 60 * 12 }); sent++; }
      // deno-lint-ignore no-explicit-any
      catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) expired.add(s.endpoint);
        else console.error("push", e?.statusCode, e?.body ?? e);
      }
    }));
    report.push({ foyer: h.name, plantes: duePlants.length, taches: dueTasks.length, appareils: targets.length });
  }

  if (expired.size) await sb.from("push_subscriptions").delete().in("endpoint", [...expired]);
  return Response.json({ sent, expired: expired.size, foyers: report });
});
