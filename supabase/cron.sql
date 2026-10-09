-- =========================================================
-- Rappel quotidien : appelle la fonction send-reminders chaque matin.
-- À exécuter APRÈS avoir déployé la fonction (voir README, étape 5).
-- Remplace VOTRE_REF_PROJET et VOTRE_CRON_SECRET avant d'exécuter.
-- =========================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- pg_cron tourne en UTC : 6h45 UTC = 8h45 à Paris l'été, 7h45 l'hiver.
select cron.unschedule('rappel-maison') where exists (select 1 from cron.job where jobname = 'rappel-maison');
select cron.schedule(
  'rappel-maison',
  '45 6 * * *',
  $$
  select net.http_post(
    url     := 'https://VOTRE_REF_PROJET.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'VOTRE_CRON_SECRET'),
    body    := '{}'::jsonb
  );
  $$
);

-- Vérifier : select * from cron.job;
-- Historique des exécutions : select * from cron.job_run_details order by start_time desc limit 10;
