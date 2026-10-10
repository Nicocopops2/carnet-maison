# Carnet de maison

Une application web installable (PWA) pour gérer la maison, en trois modules :

- **Plantes** : une fiche par plante (photo, arrosage, exposition, conseils). L'espèce peut être identifiée par photo grâce à Pl@ntNet, et une base de fiches intégrée préremplit l'entretien des plantes courantes. Les arrosages sont espacés automatiquement en hiver.
- **Entretien** : des tâches récurrentes (détartrage, frigo, filtres…), à partir de modèles ou créées par toi.
- **Courses** : une liste qui se remplit au fil de la semaine, rangée par rayon, avec les articles habituels, prête pour le drive.

L'app gère **plusieurs foyers étanches**. Chaque foyer a ses propres données, et on y invite les autres membres avec un code. Chaque matin, une notification rappelle à chaque foyer ce qui est dû.

## Architecture

| Brique | Rôle | Coût |
|---|---|---|
| GitHub Pages | Héberge les fichiers de l'app (HTML/CSS/JS), en HTTPS | Gratuit |
| Supabase (Postgres + Auth + Realtime) | Comptes, foyers, données, synchronisation en direct | Offre gratuite |
| Edge Function `identify-plant` → Pl@ntNet | Identification des plantes par photo | Gratuit (500 par jour) |
| Edge Function `send-reminders` + pg_cron | Rappel push quotidien, par foyer | Gratuit |

**Sécurité** : chaque ligne de données est rattachée à un foyer. Les règles RLS de la base ne laissent lire et écrire que les membres de ce foyer. Ce cloisonnement est garanti par la base elle-même, même si l'app avait un bug.

```
index.html, styles.css, app.js   → l'application
plant-care.js                    → fiches d'entretien des plantes courantes
config.js                        → tes clés publiques et options (à remplir)
sw.js, manifest.webmanifest      → installation, mode hors ligne, notifications
icons/                           → icônes de l'app
supabase/schema.sql              → tables, foyers, sécurité (RLS), quota d'identification
supabase/cron.sql                → planification du rappel quotidien
supabase/functions/              → les deux fonctions serveur
```

---

## Mettre à jour une installation existante (version « foyer unique »)

1. **GitHub** : remplace `app.js`, `sw.js`, `index.html` et `README.md`, et ajoute `plant-care.js`. Garde **ton** `config.js` : tu peux y ajouter les deux nouvelles options (`plantIdentification`, `allowSignup`), mais elles valent `false` par défaut si elles sont absentes. Remplace aussi les fichiers de `supabase/`.
2. **Supabase → SQL Editor** : colle le nouveau `supabase/schema.sql` et clique sur **Run**. Le script crée un foyer « Mon foyer » et y rattache toutes tes données existantes. Les comptes listés dans l'ancienne table `members` en deviennent membres. Rien n'est supprimé.
3. Ouvre l'app et recharge-la une ou deux fois. Ton foyer apparaît dans **Réglages**, avec son code d'invitation. Tu peux le renommer depuis **Table Editor → households**.

---

## Installation neuve

### 1. Créer le projet Supabase

1. Sur supabase.com, crée une organisation (type *Personal*, plan *Free*), puis un projet en région *West EU (Paris)*.
2. Récupère l'**URL** du projet et la **publishable key** (`sb_publishable_…`) : bouton **Connect** en haut du tableau de bord, ou **Project Settings → API Keys**.
   Ne mets **jamais** la `secret key` ni la `service_role` dans l'app.

### 2. Créer les tables

Dans **SQL Editor → New query**, colle tout `supabase/schema.sql` et clique sur **Run**. Résultat attendu : *Success. No rows returned*.

### 3. Les comptes

La connexion se fait par **e-mail + mot de passe**. Deux façons de gérer les comptes :

- **Tu crées les comptes toi-même** (par défaut)
  1. **Authentication → Users → Add user → Create new user**, avec l'e-mail et un mot de passe. Coche **Auto Confirm User**.
  2. **Authentication → Sign In / Providers** : désactive **Allow new users to sign up**.
  3. Mot de passe oublié : clique sur l'utilisateur dans **Users** pour en définir un nouveau.
- **Inscription libre**, si tu veux que ta sœur crée son compte elle-même
  1. Mets `allowSignup: true` dans `config.js`.
  2. Laisse **Allow new users to sign up** activé, ainsi que **Confirm email** : la personne reçoit un lien de confirmation, puis se connecte dans l'app.
  3. Un inconnu qui créerait un compte ne verrait aucune donnée, car il n'est membre d'aucun foyer. Il pourrait seulement consommer du quota d'identification pour son propre foyer (25 par jour et par foyer).

Dans **Authentication → URL Configuration**, mets l'adresse de ton site GitHub Pages dans **Site URL**, et ajoute-la avec `**` à la fin dans **Redirect URLs**.

### 4. Publier sur GitHub Pages

1. Remplis `config.js` avec `supabaseUrl` et `supabaseAnonKey` (la publishable key).
2. Crée un dépôt **public** sur GitHub et envoie-y tous les fichiers, sous-dossiers `icons/` et `supabase/` compris. Le plus simple est de les glisser-déposer dans **Add file → Upload files**.
3. **Settings → Pages** : *Deploy from a branch*, branche `main`, dossier `/ (root)`.
4. L'app est disponible en ligne sur `https://TON-PSEUDO.github.io/NOM-DU-DEPOT/`.

> `config.js` ne contient que des valeurs publiques par conception. Les données sont protégées par les règles RLS. N'écris jamais d'adresse e-mail ni de clé secrète dans les fichiers du dépôt.

### 5. Premier lancement

Connecte-toi. L'app te propose de **créer ton foyer**, par exemple « Appart de Lyon ». Dans **Réglages**, tu trouves le **code d'invitation** à donner aux autres membres du foyer. Ils créent ou reçoivent leur compte, se connectent, puis saisissent ce code.

- Une personne peut appartenir à plusieurs foyers. Elle passe de l'un à l'autre dans **Réglages**.
- « Nouveau code » rend l'ancien code inutilisable, sans exclure les membres déjà présents.
- « Quitter ce foyer » : si tu en es le dernier membre, le foyer et toutes ses données sont supprimés.

### 6. Installer sur le téléphone

- **iPhone** : ouvre l'URL dans **Safari**, puis **Partager → Sur l'écran d'accueil**. Ouvre ensuite l'app depuis l'icône : la connexion est à refaire une fois, car l'app installée et Safari ne partagent pas la même session.
- **Android** : ouvre l'URL dans **Chrome**, puis menu **⋮ → Installer l'application**.

---

## Identification des plantes (optionnelle, gratuite)

Sans cette étape, l'app fonctionne normalement. La photo illustre la fiche, et le champ « Espèce » propose une liste de plantes courantes avec un bouton **Appliquer** qui remplit l'arrosage et l'exposition.

1. **Clé Pl@ntNet** : crée un compte sur [my.plantnet.org](https://my.plantnet.org), puis récupère ta clé API dans ton espace (*API key*). L'offre gratuite donne droit à 500 identifications par jour. La mention de Pl@ntNet est requise, et l'app l'affiche déjà.
2. **Supabase → Edge Functions → Secrets** : ajoute `PLANTNET_API_KEY` avec ta clé.
3. **Edge Functions → Deploy a new function → Via Editor** :
   - nomme-la exactement `identify-plant` ;
   - colle le contenu de `supabase/functions/identify-plant/index.ts`, puis clique sur **Deploy** ;
   - dans les réglages de la fonction, désactive **Enforce JWT Verification**. La fonction vérifie elle-même que l'appelant est connecté et membre du foyer, et applique un quota de 25 identifications par foyer et par jour.
4. Dans `config.js`, mets `plantIdentification: true`, puis commite.

Pl@ntNet reconnaît l'espèce. L'app cherche ensuite la fiche d'entretien correspondante dans `plant-care.js`, par espèce, puis par genre, puis par famille. Si la plante n'y figure pas, seul le nom est rempli. Tu peux enrichir `plant-care.js` à volonté.

---

## Rappels quotidiens (optionnels)

1. **Clés VAPID** : ouvre la console du navigateur (F12 → Console) et exécute :
   ```js
   const k = await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
   const pub = new Uint8Array(await crypto.subtle.exportKey("raw",k.publicKey));
   const jwk = await crypto.subtle.exportKey("jwk",k.privateKey);
   const b64u = a => btoa(String.fromCharCode(...a)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
   console.log("Public Key :", b64u(pub)); console.log("Private Key:", jwk.d);
   ```
   La **clé publique** va dans `config.js` (`vapidPublicKey`). La **clé privée** ne va que dans les secrets Supabase.
2. **Un secret pour la planification** : invente une longue chaîne aléatoire, ce sera ton `CRON_SECRET`.
3. **Edge Functions → Secrets** : ajoute `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:ton.adresse@…`) et `CRON_SECRET`.
4. **Deploy a new function → Via Editor** : nomme-la `send-reminders`, colle `supabase/functions/send-reminders/index.ts`, déploie, puis désactive **Enforce JWT Verification**.
5. **SQL Editor** : colle `supabase/cron.sql`, remplace `VOTRE_REF_PROJET` (le sous-domaine de ton URL Supabase) et `VOTRE_CRON_SECRET`, puis clique sur **Run**. Le rappel part chaque jour vers 8 h 45 (7 h 45 l'hiver).
6. Dans l'app : **Réglages → Activer** les rappels, sur chaque appareil.

Pour tester sans attendre le lendemain :
```bash
curl -X POST "https://VOTRE_REF_PROJET.supabase.co/functions/v1/send-reminders?force=1" -H "x-cron-secret: VOTRE_CRON_SECRET"
```
Si la réponse signale `service key missing`, ajoute un secret `SERVICE_KEY` avec ta clé `sb_secret_…`.

---

## Mettre à jour l'app

Modifie les fichiers et incrémente `VERSION` dans `sw.js` (`maison-v4`, etc.), puis commite. Les appareils récupèrent la nouvelle version à la réouverture de l'app (parfois à la deuxième).

## Points d'attention

- **Mise en pause Supabase** : sur l'offre gratuite, un projet inactif pendant une semaine est mis en pause. Il se réactive en un clic depuis le tableau de bord.
- **Hors ligne** : l'app s'ouvre avec la dernière copie des données. Les modifications nécessitent une connexion.
- **Photos** : elles sont stockées en miniature (360 px) dans les données. Pour des centaines de plantes, il vaudrait mieux passer à Supabase Storage.
- **Drive** : aucune enseigne ne propose d'API de panier. « Copier la liste » partage la liste rangée par rayon.
