// Fiches d'entretien des plantes courantes (intérieur, balcon, aromatiques).
// Recherche par espèce, puis par genre, puis par famille (noms scientifiques).
// Valeurs indicatives pour un intérieur chauffé en France : à ajuster selon le pot,
// la pièce et l'observation de la terre.
// Champs : nom (nom courant), e (arrosage en jours, printemps/été), h (hiver), x (exposition),
// c (conseils), t (animaux).
(function () {
  const SOLEIL = "Plein soleil", VIVE = "Lumière vive indirecte", MI = "Mi-ombre";
  const TOX = "Toxique pour les chats et les chiens en cas d'ingestion.";
  const IRRIT = "Sève irritante : à garder hors de portée des animaux.";
  const OK = "Non toxique pour les chats et les chiens.";
  const SECHE = "Laisse sécher la terre complètement entre deux arrosages.";
  const SOUCOUPE = "Vide la soucoupe 30 minutes après l'arrosage : les racines détestent l'eau stagnante.";

  const GENUS = {
    monstera: { nom: "Monstera", e: 7, h: 12, x: VIVE, t: TOX, c: ["Arrose quand les 3 premiers centimètres de terre sont secs.", SOUCOUPE, "Dépoussière les feuilles avec un chiffon humide.", "Un tuteur en mousse l'aide à faire de grandes feuilles."] },
    epipremnum: { nom: "Pothos", e: 7, h: 12, x: MI, t: TOX, c: ["Arrose quand le haut de la terre est sec ; des feuilles qui tombent signalent la soif.", "Supporte bien la mi-ombre, mais pousse plus vite à la lumière.", "Bouture facilement dans un verre d'eau."] },
    philodendron: { nom: "Philodendron", e: 7, h: 12, x: VIVE, t: TOX, c: ["Arrose quand les 2-3 premiers centimètres sont secs.", "Évite le soleil direct qui brûle les feuilles.", SOUCOUPE] },
    ficus: { nom: "Ficus", e: 7, h: 12, x: VIVE, t: IRRIT, c: ["N'aime pas être déplacé : il perd ses feuilles au moindre changement.", "Arrose quand le dessus de la terre est sec.", "Éloigne-le des radiateurs et des courants d'air."] },
    dracaena: { nom: "Dragonnier", e: 10, h: 15, x: VIVE, t: TOX, c: ["Arrose quand la moitié de la terre est sèche.", "Les pointes brunes viennent souvent de l'eau calcaire : utilise de l'eau de pluie ou filtrée.", SOUCOUPE] },
    sansevieria: { nom: "Sansevière", e: 14, h: 30, x: VIVE, t: TOX, c: [SECHE, "Supporte la mi-ombre et l'oubli : le trop d'eau est son seul vrai ennemi.", "En hiver, un arrosage par mois suffit."] },
    zamioculcas: { nom: "Zamioculcas", e: 14, h: 30, x: MI, t: TOX, c: [SECHE, "Ses rhizomes stockent l'eau : mieux vaut oublier un arrosage qu'en faire trop.", "Pousse lentement, rempotage tous les 2-3 ans."] },
    spathiphyllum: { nom: "Fleur de lune", e: 5, h: 8, x: MI, t: TOX, c: ["Ses feuilles retombent quand elle a soif : elle se redresse dans l'heure après l'arrosage.", "Aime l'humidité : vaporise de temps en temps.", "Coupe les fleurs fanées à la base."] },
    chlorophytum: { nom: "Plante araignée", e: 7, h: 10, x: VIVE, t: OK, c: ["Garde la terre légèrement humide au printemps et en été.", "Les rejets peuvent être replantés directement.", "Pointes brunes : eau trop calcaire ou air trop sec."] },
    phalaenopsis: { nom: "Orchidée papillon", e: 7, h: 12, x: VIVE, t: OK, c: ["Arrose par trempage : 10 minutes dans l'eau, puis égoutte bien.", "Racines argentées = soif ; racines vertes = elle a assez d'eau.", "Après la floraison, coupe la tige au-dessus du 2e nœud pour une nouvelle floraison."] },
    aloe: { nom: "Aloe vera", e: 14, h: 30, x: SOLEIL, t: TOX, c: [SECHE, "Terreau pour cactus et pot percé indispensables.", "Rentre-le avant les premières gelées s'il passe l'été dehors."] },
    crassula: { nom: "Arbre de jade", e: 14, h: 30, x: SOLEIL, t: TOX, c: [SECHE, "Des feuilles ridées indiquent la soif, des feuilles molles l'excès d'eau.", "Un hiver au frais (10-15 °C) favorise la floraison."] },
    echeveria: { nom: "Echeveria", e: 14, h: 30, x: SOLEIL, t: OK, c: [SECHE, "Arrose la terre, pas le cœur de la rosette.", "Manque de lumière : la plante s'étire et pâlit."] },
    haworthia: { nom: "Haworthia", e: 14, h: 30, x: VIVE, t: OK, c: [SECHE, "Préfère une lumière vive sans soleil brûlant.", "Terreau très drainant."] },
    haworthiopsis: { nom: "Haworthia", e: 14, h: 30, x: VIVE, t: OK, c: [SECHE, "Préfère une lumière vive sans soleil brûlant.", "Terreau très drainant."] },
    kalanchoe: { nom: "Kalanchoé", e: 10, h: 20, x: SOLEIL, t: TOX, c: [SECHE, "Pour refleurir, il lui faut des nuits longues (14 h d'obscurité) pendant 6 semaines.", "Retire les fleurs fanées."] },
    goeppertia: { nom: "Calathea", e: 5, h: 8, x: MI, t: OK, c: ["Garde la terre juste humide, jamais détrempée.", "Eau non calcaire de préférence (pluie, filtrée).", "Aime l'humidité : idéale en salle de bain lumineuse."] },
    calathea: { nom: "Calathea", e: 5, h: 8, x: MI, t: OK, c: ["Garde la terre juste humide, jamais détrempée.", "Eau non calcaire de préférence (pluie, filtrée).", "Aime l'humidité : idéale en salle de bain lumineuse."] },
    maranta: { nom: "Maranta", e: 5, h: 8, x: MI, t: OK, c: ["Garde la terre légèrement humide.", "Ses feuilles se replient la nuit : c'est normal.", "Évite le soleil direct qui décolore les feuilles."] },
    pilea: { nom: "Pilea", e: 7, h: 10, x: VIVE, t: OK, c: ["Arrose quand le dessus de la terre est sec.", "Tourne le pot chaque semaine pour une pousse droite.", "Les petits rejets se rempotent facilement."] },
    peperomia: { nom: "Pépéromia", e: 10, h: 14, x: VIVE, t: OK, c: ["Ses feuilles charnues stockent l'eau : laisse sécher entre deux arrosages.", "Petit pot et terreau léger."] },
    hoya: { nom: "Hoya", e: 10, h: 15, x: VIVE, t: OK, c: ["Laisse sécher la terre entre deux arrosages.", "Ne coupe pas les anciennes tiges florales : les fleurs y repoussent.", "Fleurit mieux un peu à l'étroit dans son pot."] },
    strelitzia: { nom: "Oiseau de paradis", e: 7, h: 14, x: SOLEIL, t: IRRIT, c: ["Arrose quand les premiers centimètres sont secs.", "Beaucoup de lumière, idéalement quelques heures de soleil.", "Les feuilles fendues sont naturelles."] },
    aglaonema: { nom: "Aglaonema", e: 7, h: 12, x: MI, t: TOX, c: ["Arrose quand le dessus de la terre est sec.", "Supporte bien les pièces peu lumineuses.", "Craint le froid : au-dessus de 15 °C."] },
    dieffenbachia: { nom: "Dieffenbachia", e: 7, h: 10, x: MI, t: "Très toxique pour les animaux et les enfants (sève irritante).", c: ["Garde la terre légèrement humide.", "Porte des gants pour la tailler.", "Éloigne-la des courants d'air froid."] },
    anthurium: { nom: "Anthurium", e: 7, h: 10, x: VIVE, t: TOX, c: ["Arrose quand le dessus de la terre est sec.", "Aime l'humidité ambiante.", "Coupe les fleurs fanées à la base."] },
    alocasia: { nom: "Alocasia", e: 5, h: 10, x: VIVE, t: TOX, c: ["Terre légèrement humide, jamais détrempée.", "Peut perdre ses feuilles en hiver puis repartir au printemps.", "Aime la chaleur et l'humidité."] },
    begonia: { nom: "Bégonia", e: 5, h: 8, x: VIVE, t: TOX, c: ["Arrose sans mouiller les feuilles (oïdium).", "Garde la terre légèrement humide.", "Retire les fleurs fanées."] },
    nephrolepis: { nom: "Fougère de Boston", e: 3, h: 5, x: MI, t: OK, c: ["Ne laisse jamais sécher la terre complètement.", "Vaporise souvent : elle aime l'air humide.", "Éloigne-la des radiateurs."] },
    adiantum: { nom: "Capillaire", e: 3, h: 4, x: MI, t: OK, c: ["Terre toujours légèrement humide.", "Très sensible à l'air sec : salle de bain lumineuse idéale.", "Coupe les frondes sèches à la base."] },
    chamaedorea: { nom: "Palmier nain", e: 7, h: 12, x: MI, t: OK, c: ["Arrose quand le dessus de la terre est sec.", "Supporte la mi-ombre.", "Vaporise contre les araignées rouges."] },
    howea: { nom: "Kentia", e: 7, h: 12, x: VIVE, t: OK, c: ["Arrose quand les premiers centimètres sont secs.", "Pousse lentement : rempotage rare.", "Dépoussière les palmes."] },
    dypsis: { nom: "Palmier Areca", e: 5, h: 10, x: VIVE, t: OK, c: ["Garde la terre légèrement humide.", "Pointes brunes : air sec ou eau calcaire.", "Lumière vive sans soleil direct."] },
    yucca: { nom: "Yucca", e: 10, h: 20, x: SOLEIL, t: TOX, c: ["Laisse sécher la moitié de la terre entre deux arrosages.", "Beaucoup de lumière.", "Peut passer l'été dehors."] },
    schefflera: { nom: "Schefflera", e: 7, h: 12, x: VIVE, t: TOX, c: ["Arrose quand le dessus de la terre est sec.", "Perd ses feuilles si trop arrosé.", "Taille possible au printemps pour l'étoffer."] },
    heptapleurum: { nom: "Schefflera", e: 7, h: 12, x: VIVE, t: TOX, c: ["Arrose quand le dessus de la terre est sec.", "Perd ses feuilles si trop arrosé.", "Taille possible au printemps pour l'étoffer."] },
    tradescantia: { nom: "Misère", e: 7, h: 10, x: VIVE, t: IRRIT, c: ["Garde la terre légèrement humide.", "Pince les tiges pour une plante plus touffue.", "Bouture très facilement."] },
    hedera: { nom: "Lierre", e: 5, h: 10, x: MI, t: TOX, c: ["Terre légèrement humide en été.", "Préfère la fraîcheur en hiver.", "Vaporise contre les araignées rouges."] },
    saintpaulia: { nom: "Violette africaine", e: 5, h: 7, x: VIVE, t: OK, c: ["Arrose par la soucoupe avec de l'eau à température ambiante.", "Ne mouille jamais les feuilles.", "Lumière vive sans soleil direct."] },
    streptocarpus: { nom: "Violette africaine", e: 5, h: 7, x: VIVE, t: OK, c: ["Arrose par la soucoupe avec de l'eau à température ambiante.", "Ne mouille jamais les feuilles.", "Lumière vive sans soleil direct."] },
    fittonia: { nom: "Fittonia", e: 3, h: 5, x: MI, t: OK, c: ["Terre toujours légèrement humide : elle s'affaisse dès qu'elle a soif.", "Aime l'air humide.", "Pince les tiges pour garder une forme compacte."] },
    cyclamen: { nom: "Cyclamen", e: 4, h: 4, x: VIVE, t: TOX, c: ["Arrose par la soucoupe, jamais sur le tubercule.", "Aime la fraîcheur (12-16 °C) : il fleurit en hiver.", "Retire fleurs et feuilles fanées en tirant d'un coup sec."] },
    senecio: { nom: "Plante collier de perles", e: 14, h: 21, x: VIVE, t: TOX, c: [SECHE, "Perles ridées = soif ; perles molles = excès d'eau.", "Pot suspendu idéal."] },
    curio: { nom: "Plante collier de perles", e: 14, h: 21, x: VIVE, t: TOX, c: [SECHE, "Perles ridées = soif ; perles molles = excès d'eau.", "Pot suspendu idéal."] },
    ceropegia: { nom: "Chaîne des cœurs", e: 10, h: 20, x: VIVE, t: OK, c: [SECHE, "Lumière vive pour garder des feuilles bien marbrées.", "Bouture facilement."] },
    // Aromatiques
    ocimum: { nom: "Basilic", e: 2, h: 3, x: SOLEIL, t: OK, c: ["Garde la terre légèrement humide, sans excès.", "Pince les sommités pour éviter la floraison et l'étoffer.", "Craint le froid : à l'intérieur dès que les nuits passent sous 12 °C."] },
    mentha: { nom: "Menthe", e: 2, h: 4, x: MI, t: "À éviter en grande quantité pour les chats.", c: ["Terre toujours fraîche.", "Très envahissante : cultive-la en pot.", "Coupe régulièrement pour de jeunes feuilles."] },
    salvia: { nom: "Sauge / Romarin", e: 7, h: 14, x: SOLEIL, t: OK, c: ["Laisse sécher la terre entre deux arrosages.", "Plein soleil et terre drainante.", "Taille légère après la floraison."] },
    rosmarinus: { nom: "Romarin", e: 7, h: 14, x: SOLEIL, t: OK, c: ["Laisse sécher la terre entre deux arrosages.", "Plein soleil et terre drainante.", "Taille légère après la floraison."] },
    thymus: { nom: "Thym", e: 7, h: 14, x: SOLEIL, t: OK, c: [SECHE, "Plein soleil, terre pauvre et drainante.", "Taille après la floraison."] },
    petroselinum: { nom: "Persil", e: 2, h: 4, x: MI, t: OK, c: ["Terre toujours fraîche.", "Coupe les tiges extérieures en premier.", "Bisannuel : il monte en graines la 2e année."] },
    allium: { nom: "Ciboulette", e: 3, h: 7, x: SOLEIL, t: TOX, c: ["Terre fraîche.", "Coupe à 2 cm du sol, elle repousse.", "Toxique pour chats et chiens comme les oignons."] },
    // Balcon / extérieur
    pelargonium: { nom: "Géranium", e: 3, h: 14, x: SOLEIL, t: TOX, c: ["Arrose quand la terre est sèche en surface, sans mouiller les feuilles.", "Retire les fleurs fanées pour prolonger la floraison.", "Hiverne hors gel, au sec et à la lumière."] },
    lavandula: { nom: "Lavande", e: 7, h: 21, x: SOLEIL, t: "Légèrement toxique pour les chats et les chiens.", c: [SECHE, "Plein soleil et terre drainante.", "Taille après la floraison sans couper le vieux bois."] },
    hydrangea: { nom: "Hortensia", e: 2, h: 7, x: MI, t: TOX, c: ["Arrose abondamment en été, de préférence avec de l'eau de pluie.", "Mi-ombre : le soleil de l'après-midi le fait faner.", "Taille les fleurs fanées au printemps."] },
    rosa: { nom: "Rosier", e: 3, h: 14, x: SOLEIL, t: "Non toxique, mais attention aux épines.", c: ["Arrose au pied, pas sur les feuilles.", "Retire les fleurs fanées.", "Taille en fin d'hiver."] },
    olea: { nom: "Olivier", e: 7, h: 21, x: SOLEIL, t: OK, c: ["Laisse sécher la terre entre deux arrosages.", "Plein soleil.", "Protège-le des fortes gelées en pot."] },
    citrus: { nom: "Agrume", e: 5, h: 10, x: SOLEIL, t: "Légèrement toxique pour les chats et les chiens.", c: ["Arrose quand le dessus de la terre est sec.", "Engrais spécial agrumes au printemps et en été.", "Hiverne à la lumière et au frais (5-12 °C)."] },
    bougainvillea: { nom: "Bougainvillier", e: 4, h: 14, x: SOLEIL, t: "Épines ; légèrement toxique.", c: ["Arrose quand la terre est sèche en surface.", "Plein soleil et chaleur.", "Hiverne hors gel."] }
  };

  const SPECIES = {
    "dracaena trifasciata": GENUS.sansevieria,
    "sansevieria trifasciata": GENUS.sansevieria,
    "ficus lyrata": { ...GENUS.ficus, nom: "Ficus lyrata" },
    "ficus elastica": { ...GENUS.ficus, nom: "Caoutchouc" },
    "salvia rosmarinus": GENUS.rosmarinus,
    "allium schoenoprasum": GENUS.allium
  };

  const FAMILY = {
    cactaceae: { nom: "Cactus", e: 21, h: 45, x: SOLEIL, t: "Non toxique, mais attention aux épines.", c: [SECHE, "En hiver, presque pas d'eau et un endroit frais favorisent la floraison.", "Terreau spécial cactus."] },
    crassulaceae: { nom: "Succulente", e: 14, h: 30, x: SOLEIL, t: "Toxicité variable selon l'espèce.", c: [SECHE, "Beaucoup de lumière.", "Pot percé et terreau drainant."] },
    orchidaceae: GENUS.phalaenopsis,
    araceae: { nom: "Plante tropicale", e: 7, h: 12, x: VIVE, t: TOX, c: ["Arrose quand les premiers centimètres de terre sont secs.", SOUCOUPE, "Lumière vive sans soleil direct."] },
    marantaceae: GENUS.maranta,
    arecaceae: GENUS.chamaedorea,
    lamiaceae: { nom: "Aromatique", e: 4, h: 7, x: SOLEIL, t: OK, c: ["Arrose quand la terre sèche en surface.", "Soleil et terre drainante.", "Coupe régulièrement pour l'étoffer."] },
    polypodiaceae: GENUS.nephrolepis,
    nephrolepidaceae: GENUS.nephrolepis
  };

  const norm = s => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");

  function toCare(entry, matchedOn) {
    if (!entry) return null;
    return {
      nom: entry.nom, arrosageJours: entry.e, arrosageHiverJours: entry.h,
      exposition: entry.x, conseils: entry.c, toxiciteAnimaux: entry.t, source: matchedOn
    };
  }

  // lookup("Monstera deliciosa") ou lookup({ species, genus, family })
  function lookup(q) {
    const o = typeof q === "string" ? { species: q } : (q || {});
    const sp = norm(o.species).split(" ").slice(0, 2).join(" ");
    if (SPECIES[sp]) return toCare(SPECIES[sp], "espèce");
    const g = norm(o.genus) || sp.split(" ")[0];
    if (GENUS[g]) return toCare(GENUS[g], "genre");
    const f = norm(o.family);
    if (FAMILY[f]) return toCare(FAMILY[f], "famille");
    return null;
  }

  // Suggestions pour l'autocomplétion du champ « Espèce »
  const LIST = Object.entries(GENUS).map(([g, v]) => ({ latin: g.charAt(0).toUpperCase() + g.slice(1), nom: v.nom }))
    .filter((v, i, a) => a.findIndex(x => x.nom === v.nom) === i)
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

  // Recherche aussi par nom courant (« basilic », « orchidée »)
  function lookupByName(text) {
    const n = norm(text).normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (!n) return null;
    const direct = lookup(n);
    if (direct) return direct;
    const hit = LIST.find(x => x.nom.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s*\/\s*/).some(part => part === n || n.startsWith(part) || (n.length >= 4 && part.startsWith(n))));
    return hit ? lookup(hit.latin) : null;
  }

  window.PLANT_CARE = { lookup, lookupByName, LIST };
})();
