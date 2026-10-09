# Carnet de maison

Une application web installable (PWA) pour le foyer, en trois modules :

- **Plantes** : tu prends une photo, l'espèce est identifiée et la fiche d'arrosage se remplit toute seule. Les arrosages sont automatiquement espacés en hiver.
- **Entretien** : des tâches récurrentes (détartrage, frigo, filtres…), à partir de modèles ou créées par toi.
- **Courses** : une liste qui se remplit au fil de la semaine, rangée par rayon, avec tes articles habituels, prête pour le drive.

Chaque matin, une notification te rappelle ce qui est dû. Les données sont synchronisées entre tous les appareils des membres du foyer.

## Architecture

| Brique | Rôle | Coût |
|---|---|---|
| GitHub Pages | Héberge les fichiers statiques (HTML/CSS/JS), en HTTPS | Gratuit |
| Supabase (Postgres + Auth + Realtime) | Données, connexion par code e-mail, synchronisation en direct | Offre gratuite |
| Supabase Edge Function `identify-plant` | Envoie la photo à l'API Claude sans exposer la clé | Facturé à l'usage par Anthropic, de l'ordre du centime par photo |
| Supabase Edge Function `send-reminders` + pg_cron | Calcule les échéances et envoie les notifications push chaque matin | Gratuit |

Il n'y a ni étape de build ni dépendance à installer pour le site : ce sont des fichiers statiques. La librairie Supabase est chargée depuis jsDelivr.

```
index.html, styles.css, app.js   → l'application
config.js                        → tes clés publiques (à remplir)
sw.js, manifest.webmanifest      → installation, mode hors ligne, notifications
icons/                           → icônes de l'app
supabase/schema.sql              → tables, sécurité (RLS), membres du foyer
supabase/cron.sql                → planification du rappel quotidien
supabase/functions/              → les deux fonctions serveur
```

---

## Mise en place (environ 30 minutes)

Prérequis : un compte GitHub, un compte [Supabase](https://supabase.com), une clé API [Anthropic](https://console.anthropic.com) pour l'identification des plantes, et Node.js installé sur ton ordinateur (pour les commandes `npx`).

### 1. Créer le projet Supabase

1. Sur supabase.com, clique sur **New project**. Choisis la région *West EU (Paris)*.
2. Dans **Project Settings → API**, note :
   - l'**URL** du projet (`https://xxxx.supabase.co`) ; la partie `xxxx` est ta *référence projet* ;
   - la clé **anon public**.

### 2. Créer les tables

1. Ouvre `supabase/schema.sql`. Tout en bas, remplace `ton.adresse@exemple.fr` par ton adresse. Ajoute celle de ta compagne si elle doit utiliser l'app.
2. Dans Supabase, va dans **SQL Editor → New query**, colle tout le fichier, puis clique sur **Run**.

> Pour ajouter quelqu'un plus tard :
> `insert into members (email) values ('nouvelle@adresse.fr');`

### 3. Configurer la connexion par code

L'app se connecte avec un **code à 6 chiffres** reçu par e-mail, et non avec un lien magique. Sur iPhone, l'app installée et Safari ne partagent pas la même session : un lien magique ouvrirait Safari au lieu de l'app.

1. Va dans **Authentication → Email Templates**. Dans les deux modèles **Magic Link** et **Confirm signup**, remplace le contenu par exemple par :
   ```html
   <h2>Ton code de connexion</h2>
   <p>Saisis ce code dans le Carnet de maison :</p>
   <p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
   ```
2. Dans **Authentication → URL Configuration**, mets ton futur site GitHub Pages (étape 7) dans **Site URL**, par exemple `https://ton-pseudo.github.io/carnet-maison/`.

> L'envoi d'e-mails intégré à Supabase est limité à quelques messages par heure. C'est suffisant pour un foyer. Si ça bloque, branche ton propre SMTP dans **Authentication → SMTP Settings**.

### 4. Générer les clés de notification (VAPID)

Sur ton ordinateur :

```bash
npx web-push generate-vapid-keys
openssl rand -hex 24      # ton CRON_SECRET
```

Garde les trois valeurs : la clé publique, la clé privée et le secret.

### 5. Déployer les fonctions serveur

Lance ces commandes depuis le dossier du projet :

```bash
npx supabase login
npx supabase link --project-ref VOTRE_REF_PROJET

npx supabase secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  VAPID_PUBLIC_KEY=... \
  VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:ton.adresse@exemple.fr \
  CRON_SECRET=...

npx supabase functions deploy identify-plant
npx supabase functions deploy send-reminders --no-verify-jwt
```

`identify-plant` vérifie elle-même que l'appelant est connecté et membre du foyer. `send-reminders` est protégée par l'en-tête `x-cron-secret`.

Par défaut, l'identification utilise `claude-sonnet-5-5`. Pour réduire le coût, tu peux passer à `claude-haiku-5-5` :
`npx supabase secrets set ANTHROPIC_MODEL=claude-haiku-5-5`.

### 6. Planifier le rappel du matin

Dans `supabase/cron.sql`, remplace `VOTRE_REF_PROJET` et `VOTRE_CRON_SECRET`, puis exécute le fichier dans le **SQL Editor**. Le rappel part chaque jour à 8 h 45 l'été, 7 h 45 l'hiver.

Pour tester tout de suite, même s'il n'y a rien à faire :

```bash
curl -X POST "https://VOTRE_REF_PROJET.supabase.co/functions/v1/send-reminders?force=1" \
  -H "x-cron-secret: VOTRE_CRON_SECRET"
```

### 7. Publier sur GitHub Pages

1. Remplis `config.js` avec l'URL Supabase, la clé anon et la clé VAPID **publique**.
2. Crée un dépôt GitHub (par exemple `carnet-maison`) et pousse-y tous les fichiers :
   ```bash
   git init && git add . && git commit -m "Carnet de maison"
   git branch -M main
   git remote add origin https://github.com/TON-PSEUDO/carnet-maison.git
   git push -u origin main
   ```
3. Sur GitHub, va dans **Settings → Pages → Build and deployment**, choisis *Deploy from a branch*, puis la branche `main` et le dossier `/ (root)`.
4. Au bout d'une minute, l'app est disponible sur `https://TON-PSEUDO.github.io/carnet-maison/`.

> **Dépôt public ou privé ?** GitHub Pages depuis un dépôt privé nécessite un abonnement payant. Un dépôt public ne pose pas de problème : `config.js` ne contient que des clés publiques par conception, et les données sont protégées par les règles RLS. Ne commite **jamais** la clé `service_role`, la clé Anthropic ni la clé VAPID privée : elles vivent uniquement dans les secrets Supabase. Si tu préfères un dépôt privé, Netlify ou Cloudflare Pages l'hébergent gratuitement.

### 8. Installer sur le téléphone

- **iPhone** : ouvre l'URL dans **Safari**, appuie sur **Partager**, puis **Sur l'écran d'accueil**. Ouvre ensuite l'app depuis l'icône, connecte-toi, puis va dans **Réglages → Activer** les rappels. Sur iPhone, les notifications ne fonctionnent que depuis l'app installée (iOS 16.4 ou plus récent).
- **Android** : ouvre l'URL dans **Chrome**, menu ⋮, puis **Installer l'application**.

Pour partager l'app avec quelqu'un, ajoute son adresse dans `members` (étape 2) et envoie-lui l'URL.

---

## Mettre à jour l'app

Modifie les fichiers, **incrémente `VERSION` dans `sw.js`** (par exemple `maison-v2`), puis commite et pousse. Les appareils récupèrent la nouvelle version à l'ouverture suivante de l'app, parfois à la deuxième.

## Points d'attention

- **Mise en pause Supabase** : sur l'offre gratuite, un projet sans activité pendant une semaine est mis en pause. Une utilisation quotidienne de l'app suffit en principe à l'éviter. Sinon, il se réactive en un clic depuis le tableau de bord.
- **Hors ligne** : l'app s'ouvre et affiche la dernière copie des données. Les modifications nécessitent une connexion : un message s'affiche si l'enregistrement échoue.
- **Photos** : elles sont stockées en miniature (360 px) directement dans les données. Cela suffit pour quelques dizaines de plantes. Au-delà, il vaudra mieux passer à Supabase Storage.
- **Un seul foyer** : tous les membres voient les mêmes données. Pour héberger plusieurs foyers, il faudrait ajouter une colonne `household_id` et adapter les règles RLS.
- **Drive** : aucune enseigne ne propose d'API publique de panier. « Copier la liste » ouvre le partage natif depuis l'app installée, ou copie la liste rangée par rayon.
