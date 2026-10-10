// Configuration de l'app — à remplir après avoir créé le projet Supabase (voir README.md).
// Ces valeurs sont publiques par nature : la sécurité des données repose sur les règles RLS
// définies dans supabase/schema.sql, pas sur le secret de ces clés.
window.MAISON_CONFIG = {
  // Supabase > Project Settings > API > Project URL
  supabaseUrl: "https://VOTRE-PROJET.supabase.co",
  // Supabase > Project Settings > API > anon public key
  supabaseAnonKey: "VOTRE_CLE_ANON",
  // Clé VAPID publique (générée avec `npx web-push generate-vapid-keys`)
  vapidPublicKey: "VOTRE_CLE_VAPID_PUBLIQUE",
  // true une fois la fonction identify-plant déployée avec ta clé Pl@ntNet (voir README)
  plantIdentification: false,
  // true pour afficher « Créer un compte » sur l'écran de connexion (inscription libre)
  allowSignup: false
};
