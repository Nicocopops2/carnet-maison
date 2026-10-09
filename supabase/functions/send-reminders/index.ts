// Edge Function : rappel quotidien (appelée chaque matin par pg_cron, voir supabase/cron.sql).
// Calcule les plantes à arroser et les tâches dues, puis envoie une notification push
// à tous les appareils abonnés du foyer.
// Secrets requis : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...), CRON_SECRET.
// Déployer avec --no-verify-jwt : l'accès est protégé par l'en-tête x-cron-secret.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type Row = { id: string; data: Record<string, any> };

const TZ = "Europe/Paris";
const todayParis = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
const monthParis = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, month: "numeric" }).format(new Date()));
const toUTC = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const daysUntil = (from: string, interval: number, today: string) =>
  Math.round((toUTC(from) + interval * 864e5 - toUTC(today)) / 864e5);

function list(names: string[], max = 3) {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} et ${names.length - max} autre${names.length - max > 1 ? "s" : ""}`;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  const force = new URL(req.url).searchParams.get("force") === "1";

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = todayParis();
  const winter = [11, 12, 1, 2].includes(monthParis());

  const [{ data: plants }, { data: tasks }, { data: subs }] = await Promise.all([
    sb.from("plants").select("id,data"),
    sb.from("tasks").select("id,data"),
    sb.from("push_subscriptions").select("endpoint,subscription"),
  ]);

  const duePlants = ((plants ?? []) as Row[]).filter(({ data: p }) => {
    const base = p.waterEveryDays || 7;
    const interval = winter ? (p.waterWinterDays || Math.round(base * 1.5)) : base;
    return daysUntil(p.lastWatered || today, interval, today) <= 0;
  }).map(r => r.data.name || "Plante");

  const dueTasks = ((tasks ?? []) as Row[]).filter(({ data: t }) =>
    daysUntil(t.lastDone || today, t.everyDays || 30, today) <= 0
  ).map(r => r.data.title);

  const count = duePlants.length + dueTasks.length;
  if (count === 0 && !force) return Response.json({ sent: 0, reason: "rien à faire" });
  if (!subs || subs.length === 0) return Response.json({ sent: 0, reason: "aucun appareil abonné" });

  const parts: string[] = [];
  if (duePlants.length) parts.push(`Arroser : ${list(duePlants)}`);
  if (dueTasks.length) parts.push(list(dueTasks, 2));
  const payload = JSON.stringify({
    title: count === 0 ? "Carnet de maison" : count === 1 ? "1 chose à faire aujourd'hui" : `${count} choses à faire aujourd'hui`,
    body: parts.length ? parts.join(" · ") : "Rien d'urgent aujourd'hui (notification de test).",
    url: "./?tab=home",
    tag: `rappel-${today}`,
    count,
  });

  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT")!,
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  let sent = 0;
  const expired: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, payload, { TTL: 60 * 60 * 12 });
      sent++;
    } catch (e: any) {
      // 404/410 : l'appareil s'est désabonné ou l'app a été supprimée
      if (e?.statusCode === 404 || e?.statusCode === 410) expired.push(s.endpoint);
      else console.error("push", e?.statusCode, e?.body ?? e);
    }
  }));
  if (expired.length) await sb.from("push_subscriptions").delete().in("endpoint", expired);

  return Response.json({ sent, expired: expired.length, plants: duePlants.length, tasks: dueTasks.length });
});
