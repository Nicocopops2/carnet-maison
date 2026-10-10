import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

/* =========================================================
   Carnet de maison — PWA
   Données : Supabase (tables plants, tasks, groceries ; colonne data jsonb ; une ligne = un foyer)
   Synchro : realtime + rechargement au retour au premier plan
   Hors ligne : dernière copie en localStorage, écritures nécessitant le réseau
   ========================================================= */

const CFG = window.MAISON_CONFIG || {};
const CONFIGURED = CFG.supabaseUrl && !CFG.supabaseUrl.includes("VOTRE-PROJET") && CFG.supabaseAnonKey && !CFG.supabaseAnonKey.includes("VOTRE_");
const sb = CONFIGURED ? createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
const PLANT_ID = CFG.plantIdentification === true;   // identification Pl@ntNet déployée ?
const ALLOW_SIGNUP = CFG.allowSignup === true;        // inscription libre depuis l'app ?

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (id, size = 20) => `<svg width="${size}" height="${size}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, "0");
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toUTC(s) { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); }
function addDays(s, n) { const t = new Date(toUTC(s) + n * 864e5); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; }
function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 864e5); }
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
function shortDate(s) { const [, m, d] = s.split("-").map(Number); return `${d} ${MONTHS[m - 1]}`; }
const isWinter = () => [10, 11, 0, 1].includes(new Date().getMonth());
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function every(days) {
  if (days === 1) return "chaque jour";
  if (days % 365 === 0) return days === 365 ? "chaque année" : `tous les ${days / 365} ans`;
  if (days % 30 === 0) return days === 30 ? "chaque mois" : `tous les ${days / 30} mois`;
  if (days % 7 === 0) return days === 7 ? "chaque semaine" : `toutes les ${days / 7} semaines`;
  return `tous les ${days} jours`;
}
function dueChip(n, verb) {
  if (n < 0) return `<span class="chip late num">En retard · ${-n} j</span>`;
  if (n === 0) return `<span class="chip late">${verb} aujourd'hui</span>`;
  if (n === 1) return `<span class="chip soon">Demain</span>`;
  if (n <= 3) return `<span class="chip soon num">Dans ${n} j</span>`;
  return `<span class="chip num">Le ${shortDate(addDays(todayStr(), n))}</span>`;
}

/* ---------- storage (Supabase + cache local, par foyer) ---------- */
const TABLES = ["plants", "tasks", "todos", "groceries"];
const store = {
  hid: null,
  cache: { plants: {}, tasks: {}, groceries: {} },
  channel: null,
  key(t) { return `maison:${this.hid}:${t}`; },
  loadLocal() {
    TABLES.forEach(t => { try { this.cache[t] = JSON.parse(localStorage.getItem(this.key(t)) || "{}"); } catch (e) { this.cache[t] = {}; } });
    TABLES.forEach(t => { S[t] = this.rows(t); });
  },
  saveLocal(t) { try { localStorage.setItem(this.key(t), JSON.stringify(this.cache[t])); } catch (e) { } },
  rows(t) { return Object.entries(this.cache[t]).map(([id, v]) => ({ id, ...v })); },
  emit(t) { this.saveLocal(t); S[t] = this.rows(t); render(); },
  async fetchAll() {
    const hid = this.hid;
    for (const t of TABLES) {
      const { data, error } = await sb.from(t).select("id,data").eq("household_id", hid);
      if (error) throw error;
      if (hid !== this.hid) return;           // foyer changé entre-temps
      this.cache[t] = Object.fromEntries((data || []).map(r => [r.id, r.data]));
      this.emit(t);
    }
  },
  unsubscribe() { if (this.channel) { sb.removeChannel(this.channel); this.channel = null; } },
  subscribe() {
    this.unsubscribe();
    const hid = this.hid;
    let ch = sb.channel("maison-" + hid);
    TABLES.forEach(t => {
      // ajouts et modifications : filtrés sur le foyer courant
      ch = ch.on("postgres_changes", { event: "INSERT", schema: "public", table: t, filter: `household_id=eq.${hid}` }, p => { this.cache[t][p.new.id] = p.new.data; this.emit(t); });
      ch = ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: t, filter: `household_id=eq.${hid}` }, p => { this.cache[t][p.new.id] = p.new.data; this.emit(t); });
      // suppressions : non filtrables côté Supabase, on ignore les identifiants inconnus
      ch = ch.on("postgres_changes", { event: "DELETE", schema: "public", table: t }, p => { if (p.old && this.cache[t][p.old.id]) { delete this.cache[t][p.old.id]; this.emit(t); } });
    });
    this.channel = ch.subscribe(status => setSync(status === "SUBSCRIBED" ? "on" : navigator.onLine ? "wait" : "off"));
  },
  async set(t, id, data) {
    if (!navigator.onLine) throw { code: "offline" };
    const prev = this.cache[t][id];
    this.cache[t][id] = data; this.emit(t);
    const { error } = await sb.from(t).upsert({ id, data, household_id: this.hid });
    if (error) { if (prev === undefined) delete this.cache[t][id]; else this.cache[t][id] = prev; this.emit(t); throw error; }
  },
  async update(t, id, patch) {
    const cur = this.cache[t][id]; if (!cur) return;
    return this.set(t, id, { ...cur, ...patch });
  },
  async remove(t, id) {
    if (!navigator.onLine) throw { code: "offline" };
    const prev = this.cache[t][id];
    delete this.cache[t][id]; this.emit(t);
    const { error } = await sb.from(t).delete().eq("id", id);
    if (error) { this.cache[t][id] = prev; this.emit(t); throw error; }
  }
};
function guard(p) {
  Promise.resolve(p).catch(e => toast(e && e.code === "offline" ? "Hors ligne : la modification n'a pas été enregistrée." : "L'enregistrement a échoué. Réessaie dans un instant."));
}
function setSync(state) {
  const el = $("#sync"); if (!el) return;
  el.classList.toggle("on", state === "on"); el.classList.toggle("off", state === "off");
  $("#sync-label").textContent = state === "on" ? "Synchronisé" : state === "off" ? "Hors ligne" : "Connexion…";
}

/* ---------- state ---------- */
const S = { tab: "home", plants: [], tasks: [], groceries: [], todos: [], user: null, household: null, households: [], todoDue: "none" };
let armed = null;

function plantInterval(p) { return isWinter() ? (p.waterWinterDays || Math.round((p.waterEveryDays || 7) * 1.5)) : (p.waterEveryDays || 7); }
function plantDue(p) { const last = p.lastWatered || todayStr(); return diffDays(todayStr(), addDays(last, plantInterval(p))); }
function taskDue(t) { const last = t.lastDone || todayStr(); return diffDays(todayStr(), addDays(last, t.everyDays || 30)); }
function todoDue(t) { return t.due ? diffDays(todayStr(), t.due) : null; }   // null = sans date
const doneToday = d => !!d && d.slice(0, 10) === todayStr();

/* Ce qui est à faire aujourd'hui (en retard compris) */
function todayItems() {
  return [
    ...S.plants.filter(p => plantDue(p) <= 0).map(o => ({ kind: "plant", o, n: plantDue(o) })),
    ...S.tasks.filter(t => taskDue(t) <= 0).map(o => ({ kind: "task", o, n: taskDue(o) })),
    ...S.todos.filter(t => !t.done && t.due && todoDue(t) <= 0).map(o => ({ kind: "todo", o, n: todoDue(o) }))
  ].sort((a, b) => a.n - b.n);
}
function doneTodayItems() {
  return [
    ...S.plants.filter(p => p.lastWatered === todayStr()).map(o => ({ kind: "plant", o })),
    ...S.tasks.filter(t => t.lastDone === todayStr()).map(o => ({ kind: "task", o })),
    ...S.todos.filter(t => t.done && doneToday(t.doneAt)).map(o => ({ kind: "todo", o }))
  ];
}

/* Cocher / décocher, même geste partout */
function tick(kind, id) {
  const today = todayStr();
  if (kind === "plant") {
    const p = S.plants.find(x => x.id === id); if (!p) return;
    if (p.lastWatered === today) {
      let back = p.prevWatered && p.prevWatered !== today ? p.prevWatered : addDays(today, -plantInterval(p));
      guard(store.update("plants", id, { lastWatered: back }));
      toast(`${p.name} : remis à arroser`);
    } else {
      const before = p.lastWatered;
      guard(store.update("plants", id, { lastWatered: today, prevWatered: before || null }));
      toast(`${p.name} arrosée · prochaine fois le ${shortDate(addDays(today, plantInterval(p)))}`, () => guard(store.update("plants", id, { lastWatered: before })));
    }
  } else if (kind === "task") {
    const t = S.tasks.find(x => x.id === id); if (!t) return;
    const every = t.everyDays || 30;
    if (taskDue(t) > 0) {
      // déjà à jour → remettre à faire
      const history = [...(t.history || [])];
      let back;
      if (t.lastDone === today) { if (history[history.length - 1] === today) history.pop(); back = t.prevDone && t.prevDone !== today ? t.prevDone : null; }
      if (!back || diffDays(today, addDays(back, every)) > 0) back = addDays(today, -every);
      const before = { lastDone: t.lastDone, history: t.history || [] };
      guard(store.update("tasks", id, { lastDone: back, history }));
      toast(`« ${t.title} » remis à faire`, () => guard(store.update("tasks", id, before)));
    } else {
      const before = { lastDone: t.lastDone, history: t.history || [], prevDone: t.prevDone || null };
      const history = [...(t.history || []).filter(d => d !== today), today].slice(-12);
      guard(store.update("tasks", id, { lastDone: today, prevDone: t.lastDone || null, history }));
      toast(`Fait · prochaine fois le ${shortDate(addDays(today, every))}`, () => guard(store.update("tasks", id, before)));
    }
  } else if (kind === "todo") {
    const t = S.todos.find(x => x.id === id); if (!t) return;
    const done = !t.done;
    guard(store.update("todos", id, { done, doneAt: done ? new Date().toISOString() : null }));
    toast(done ? "C'est fait !" : `« ${t.title} » remis à faire`, () => guard(store.update("todos", id, { done: t.done, doneAt: t.doneAt || null })));
  }
}

/* ---------- aisles ---------- */
const AISLES = [
  ["Hygiène & entretien", /\b(papier toilette|essuie.?tout|lessive|liquide vaisselle|pastilles?|dentifrice|shampo\w*|gel douche|savon|eponges?|sacs? poubelle|javel|nettoyant|deodorant|coton)\b/],
  ["Surgelés", /\b(surgel\w*|glaces?|frites|poelee)\b/],
  ["Boissons", /\b(eaux?|jus|vins?|bieres?|sodas?|sirop|limonade)\b/],
  ["Boulangerie", /\b(pain|baguettes?|brioches?|croissants?|pain de mie)\b/],
  ["Fruits & légumes", /\b(pommes?|bananes?|tomates?|salades?|carottes?|oignons?|ail|citrons?|courgettes?|pommes de terre|avocats?|poireaux?|champignons?|fruits?|legumes?|poivrons?|concombres?|oranges?|fraises?|raisins?|herbes|persil|basilic|epinards?|aubergines?)\b/],
  ["Crèmerie", /\b(lait|beurre|yaourts?|fromages?|creme|oeufs?|emmental|comte|mozzarella|parmesan|skyr|faisselle)\b/],
  ["Boucherie & poisson", /\b(poulet|boeuf|steaks?|jambon|saumon|poissons?|lardons|viandes?|dinde|porc|saucisses?|thon|crevettes?)\b/],
  ["Épicerie", /\b(pates|riz|farine|sucre|huile|cafe|the|cereales|conserves?|sauce|sel|poivre|chocolat|biscuits?|confiture|miel|lentilles|pois chiches|semoule|vinaigre|moutarde|epices?)\b/]
];
const AISLE_NAMES = [...AISLES.map(a => a[0]), "Autre"];
const norm = s => s.toLowerCase().replace(/œ/g, "oe").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
function guessAisle(name) { const n = norm(name); for (const [a, re] of AISLES) if (re.test(n)) return a; return "Autre"; }

/* ---------- templates ---------- */
const TEMPLATES = [
  { title: "Détartrer la machine à café", room: "Cuisine", everyDays: 30 },
  { title: "Nettoyer le filtre du lave-vaisselle", room: "Cuisine", everyDays: 30 },
  { title: "Lancer un cycle de nettoyage du lave-vaisselle", room: "Cuisine", everyDays: 90 },
  { title: "Nettoyer le frigo", room: "Cuisine", everyDays: 90 },
  { title: "Dégivrer le congélateur", room: "Cuisine", everyDays: 180 },
  { title: "Laver les filtres de la hotte", room: "Cuisine", everyDays: 60 },
  { title: "Nettoyer le joint et le bac du lave-linge", room: "Buanderie", everyDays: 30 },
  { title: "Vider le filtre de vidange du lave-linge", room: "Buanderie", everyDays: 90 },
  { title: "Détartrer la bouilloire", room: "Cuisine", everyDays: 30 },
  { title: "Changer la cartouche de la carafe filtrante", room: "Cuisine", everyDays: 30 },
  { title: "Tester les détecteurs de fumée", room: "Toute la maison", everyDays: 30 },
  { title: "Purger les radiateurs", room: "Toute la maison", everyDays: 365 }
];
const ROOMS = ["Cuisine", "Salle de bain", "Buanderie", "Salon", "Chambre", "Bureau", "Extérieur", "Toute la maison"];
const LIGHTS = ["Plein soleil", "Lumière vive indirecte", "Mi-ombre", "Ombre"];

/* ---------- render ---------- */
function render() {
  if ($("#app").hidden) return;
  renderHome(); renderPlants(); renderTasks(); renderTodos(); renderShop();
  const dueCount = todayItems().length;
  const b = $("#badge-home"); b.textContent = dueCount; b.hidden = dueCount === 0;
  if ("setAppBadge" in navigator) { (dueCount ? navigator.setAppBadge(dueCount) : navigator.clearAppBadge()).catch(() => { }); }
}

const tickBtn = (kind, id, on, label) =>
  `<button class="tick${on ? " on" : ""}" data-act="tick" data-kind="${kind}" data-id="${esc(id)}" aria-pressed="${on}" aria-label="${esc(label)}">${icon("check", 18)}</button>`;

function lateChip(n, todayLabel = "Aujourd'hui") {
  if (n == null) return "";
  if (n < 0) return `<span class="chip late num">En retard · ${-n} j</span>`;
  if (n === 0) return `<span class="chip soon">${todayLabel}</span>`;
  if (n === 1) return `<span class="chip">Demain</span>`;
  return `<span class="chip num">${n <= 6 ? new Date(toUTC(addDays(todayStr(), n))).toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" }) : "Le " + shortDate(addDays(todayStr(), n))}</span>`;
}

/* Une ligne générique : case à cocher + contenu (ouvre la fiche) */
function itemRow(it, on) {
  const o = it.o;
  if (it.kind === "plant") return `<div class="row trow${on ? " isdone" : ""}">
      ${tickBtn("plant", o.id, on, on ? `Remettre ${o.name} à arroser` : `${o.name} arrosée`)}
      <button class="main rowbtn" data-act="open-plant" data-id="${esc(o.id)}"><span class="title">Arroser ${esc(o.name || "la plante")}</span>
        <span class="meta"><span class="kind">${icon("leaf", 13)}Plante</span>${on ? "" : lateChip(it.n)}${o.room ? `<span>${esc(o.room)}</span>` : ""}</span></button>
      <div class="ico sm">${o.photo ? `<img alt="" src="${esc(o.photo)}">` : icon("drop", 18)}</div></div>`;
  if (it.kind === "task") return `<div class="row trow${on ? " isdone" : ""}">
      ${tickBtn("task", o.id, on, on ? `Remettre « ${o.title} » à faire` : `« ${o.title} » fait`)}
      <button class="main rowbtn" data-act="open-task" data-id="${esc(o.id)}"><span class="title">${esc(o.title)}</span>
        <span class="meta"><span class="kind">${icon("tool", 13)}Entretien</span>${on ? "" : lateChip(it.n)}${o.room ? `<span>${esc(o.room)}</span>` : ""}</span></button></div>`;
  return `<div class="row trow${on ? " isdone" : ""}">
      ${tickBtn("todo", o.id, on, on ? `Remettre « ${o.title} » à faire` : `« ${o.title} » fait`)}
      <button class="main rowbtn" data-act="open-todo" data-id="${esc(o.id)}"><span class="title">${esc(o.title)}</span>
        <span class="meta"><span class="kind">${icon("list", 13)}To-do</span>${on ? "" : lateChip(it.n)}${o.notes ? `<span class="trunc">${esc(o.notes)}</span>` : ""}</span></button></div>`;
}

function renderHome() {
  const now = todayItems(), done = doneTodayItems();
  const soonCount = [...S.plants.filter(p => { const n = plantDue(p); return n > 0 && n <= 7; }),
    ...S.tasks.filter(t => { const n = taskDue(t); return n > 0 && n <= 7; }),
    ...S.todos.filter(t => !t.done && t.due && todoDue(t) > 0 && todoDue(t) <= 7)].length;
  $("#v-home").innerHTML = `
    <span class="label">Ajouter</span>
    <div class="shortcuts">
      <button class="sc" data-act="new-todo">${icon("list", 22)}<span>To-do</span></button>
      <button class="sc" data-act="quick-shop">${icon("basket", 22)}<span>Courses</span></button>
      <button class="sc" data-act="new-task">${icon("tool", 22)}<span>Entretien</span></button>
      <button class="sc" data-act="new-plant">${icon("leaf", 22)}<span>Plante</span></button>
    </div>
    <div class="section-h"><h2>À faire aujourd'hui</h2><span class="label num">${now.length}</span></div>
    <div class="list">${now.length ? now.map(it => itemRow(it, false)).join("")
      : `<div class="empty"><b style="color:var(--ink)">Rien à faire aujourd'hui.</b>${soonCount ? `${soonCount} chose${soonCount > 1 ? "s" : ""} prévue${soonCount > 1 ? "s" : ""} dans les 7 prochains jours.` : "Profites-en !"}</div>`}</div>
    ${done.length ? `<div class="section-h"><h2 class="muted-h">Déjà fait aujourd'hui</h2><span class="label num">${done.length}</span></div>
      <div class="list">${done.map(it => itemRow(it, true)).join("")}</div>` : ""}
    ${isWinter() ? `<div class="season">${icon("snow", 18)}<span>Rythme d'hiver : les arrosages sont espacés automatiquement jusqu'à fin février.</span></div>` : ""}`;
}

let plantSort = (() => { try { return localStorage.getItem("maison:plantSort") || "room"; } catch (e) { return "room"; } })();
function plantCard(p) {
  const n = plantDue(p);
  return `<div class="pcard" role="button" tabindex="0" data-act="open-plant" data-id="${esc(p.id)}">
    <div class="ph">${p.photo ? `<img alt="" src="${esc(p.photo)}">` : icon("leaf", 40)}${dueChip(n, "Arroser")}</div>
    <div class="bd"><div class="nm">${esc(p.name || "Plante")}</div><div class="sp">${esc(p.species || "Espèce inconnue")}</div>
      <div class="ft"><small>${esc(every(plantInterval(p)))}</small>
      <button class="water${p.lastWatered === todayStr() ? " on" : ""}" aria-label="${p.lastWatered === todayStr() ? `Annuler l'arrosage de ${esc(p.name)}` : `Marquer ${esc(p.name)} comme arrosée`}" data-act="tick" data-kind="plant" data-id="${esc(p.id)}">${icon(p.lastWatered === todayStr() ? "check" : "drop", 18)}</button></div></div>
  </div>`;
}
function renderPlants() {
  const ps = [...S.plants].sort((a, b) => plantDue(a) - plantDue(b));
  let body = "";
  if (plantSort === "room") {
    const groups = {}; ps.forEach(p => { (groups[p.room || "Autre"] ||= []).push(p); });
    const order = [...ROOMS.filter(r => groups[r]), ...Object.keys(groups).filter(r => !ROOMS.includes(r))];
    body = order.map(r => `<div class="section-h room-h"><h2>${esc(r)}</h2><span class="label num">${groups[r].length}</span></div>
      <div class="grid">${groups[r].map(plantCard).join("")}</div>`).join("");
  } else body = `<div class="grid">${ps.map(plantCard).join("")}</div>`;
  $("#v-plants").innerHTML = `
    <div class="section-h">
      <div class="seg" role="group" aria-label="Trier les plantes">
        <button data-act="plant-sort" data-v="room" aria-pressed="${plantSort === "room"}">Par pièce</button>
        <button data-act="plant-sort" data-v="water" aria-pressed="${plantSort === "water"}">Par arrosage</button>
      </div>
      <button class="btn" data-act="new-plant">${icon("cam", 16)}Ajouter</button></div>
    ${ps.length ? body
      : `<div class="list"><div class="empty"><b style="color:var(--ink)">Aucune plante pour l'instant.</b>Ajoute ta première plante, avec une photo si tu veux.<button class="btn" data-act="new-plant">${icon("cam", 16)}Ajouter une plante</button></div></div>`}`;
}

function taskLine(t) {
  const n = taskDue(t), on = n > 0;
  return `<div class="row trow">
    ${tickBtn("task", t.id, on, on ? `Remettre « ${t.title} » à faire` : `« ${t.title} » fait`)}
    <button class="main rowbtn" data-act="open-task" data-id="${esc(t.id)}"><span class="title">${esc(t.title)}</span>
      <span class="meta">${on ? `<span>Prochaine fois le ${shortDate(addDays(todayStr(), n))}</span>` : lateChip(n, "À faire aujourd'hui")}<span>${esc(every(t.everyDays || 30))}</span>${t.room ? `<span>${esc(t.room)}</span>` : ""}</span></button></div>`;
}
function renderTasks() {
  const ts = [...S.tasks].sort((a, b) => taskDue(a) - taskDue(b));
  const todo = ts.filter(t => taskDue(t) <= 0), ok = ts.filter(t => taskDue(t) > 0);
  $("#v-tasks").innerHTML = `
    <div class="section-h"><p class="hint">Coche quand c'est fait : la tâche revient toute seule à la bonne date.</p>
      <button class="btn" data-act="new-task">${icon("plus", 16)}Nouvelle</button></div>
    ${ts.length ? `
      <div class="section-h"><h2>À faire</h2><span class="label num">${todo.length}</span></div>
      <div class="list">${todo.length ? todo.map(taskLine).join("") : `<div class="empty">Tout l'entretien est à jour.</div>`}</div>
      ${ok.length ? `<div class="section-h"><h2 class="muted-h">À jour</h2><span class="label num">${ok.length}</span></div>
      <div class="list">${ok.map(taskLine).join("")}</div>` : ""}`
      : `<div class="list"><div class="empty"><b style="color:var(--ink)">Aucune tâche d'entretien.</b>Pars d'un modèle (détartrage, frigo, filtres…) ou crée la tienne.<button class="btn" data-act="new-task">${icon("plus", 16)}Ajouter une tâche</button></div></div>`}`;
}

/* ---------- to-do ---------- */
function nextSaturday() { const d = new Date(); const add = (6 - d.getDay() + 7) % 7; return addDays(todayStr(), add); }
function dueFromChoice(c) {
  if (c === "today") return todayStr();
  if (c === "tomorrow") return addDays(todayStr(), 1);
  if (c === "weekend") return nextSaturday();
  if (c === "date") { const v = $("#td-date") && $("#td-date").value; return v || null; }
  return null;
}
function todoLine(t) {
  const on = !!t.done;
  return itemRow({ kind: "todo", o: t, n: todoDue(t) }, on);
}
function renderTodos() {
  const open = S.todos.filter(t => !t.done);
  const late = open.filter(t => t.due && todoDue(t) < 0).sort((a, b) => a.due.localeCompare(b.due));
  const today = open.filter(t => t.due && todoDue(t) === 0);
  const later = open.filter(t => t.due && todoDue(t) > 0).sort((a, b) => a.due.localeCompare(b.due));
  const nodate = open.filter(t => !t.due).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  const done = S.todos.filter(t => t.done).sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
  const focused = document.activeElement && document.activeElement.id === "td-name";
  const draftTxt = $("#td-name") ? $("#td-name").value : "";
  const dateVal = $("#td-date") ? $("#td-date").value : "";
  const chip = (v, l) => `<button type="button" class="fav${S.todoDue === v ? " sel" : ""}" data-act="td-due" data-v="${v}" aria-pressed="${S.todoDue === v}">${l}</button>`;
  const sec = (title, arr, cls = "") => arr.length ? `<div class="section-h"><h2 class="${cls}">${title}</h2><span class="label num">${arr.length}</span></div><div class="list">${arr.map(todoLine).join("")}</div>` : "";
  $("#v-todo").innerHTML = `
    <form class="quickadd" id="td-form" autocomplete="off">
      <input type="text" id="td-name" placeholder="Réserver, acheter, appeler…" aria-label="Chose à faire" value="${esc(draftTxt)}" enterkeyhint="done">
      <button class="btn" type="submit">${icon("plus", 16)}Ajouter</button>
    </form>
    <div class="chips">${chip("none", "Sans date")}${chip("today", "Aujourd'hui")}${chip("tomorrow", "Demain")}${chip("weekend", "Ce week-end")}${chip("date", "Date…")}
      ${S.todoDue === "date" ? `<input type="date" id="td-date" class="chipdate" value="${esc(dateVal || addDays(todayStr(), 7))}" min="${todayStr()}" aria-label="Échéance">` : ""}</div>
    ${open.length ? sec("En retard", late, "late-h") + sec("Aujourd'hui", today) + sec("À venir", later) + sec("Sans date", nodate)
      : `<div class="list"><div class="empty"><b style="color:var(--ink)">Rien sur la liste.</b>Ajoute ici ce qui n'est pas de l'entretien : billets de train, réservations, démarches, cadeaux…</div></div>`}
    ${done.length ? `<details class="done-box"${S.showDone ? " open" : ""}><summary><span>Fait</span><span class="label num">${done.length}</span></summary>
      <div class="list">${done.slice(0, 30).map(todoLine).join("")}</div>
      <button class="btn ghost wide" data-act="td-clear">Effacer les tâches faites</button></details>` : ""}`;
  const det = $("#v-todo details"); if (det) det.addEventListener("toggle", () => { S.showDone = det.open; });
  if (focused) $("#td-name").focus();
}
function addTodo(title) {
  title = title.trim(); if (!title) return;
  const due = dueFromChoice(S.todoDue);
  guard(store.set("todos", uid("d"), { title: title.charAt(0).toUpperCase() + title.slice(1), due, notes: "", done: false, doneAt: null, createdAt: new Date().toISOString() }));
  toast(due ? `Ajouté pour ${due === todayStr() ? "aujourd'hui" : due === addDays(todayStr(), 1) ? "demain" : "le " + shortDate(due)}` : "Ajouté");
}
function todoSheet(t) {
  const isNew = !t; t = t || { due: null };
  openSheet(`
    <div class="sheet-head"><h2>${isNew ? "Nouvelle chose à faire" : "Modifier"}</h2><button class="icobtn" data-act="close" aria-label="Fermer">${icon("x")}</button></div>
    <form id="todo-form" class="view" style="padding:0" data-id="${esc(t.id || "")}">
      <label class="field"><span>Quoi ?</span><input type="text" id="tf-title" required value="${esc(t.title || "")}" placeholder="Acheter les billets de train pour Noël"></label>
      <label class="field"><span>Pour quand ? (facultatif)</span><input type="date" id="tf-due" value="${esc(t.due || "")}"></label>
      <div class="chips">
        <button type="button" class="fav" data-act="tf-set" data-v="${todayStr()}">Aujourd'hui</button>
        <button type="button" class="fav" data-act="tf-set" data-v="${addDays(todayStr(), 1)}">Demain</button>
        <button type="button" class="fav" data-act="tf-set" data-v="${nextSaturday()}">Ce week-end</button>
        <button type="button" class="fav" data-act="tf-set" data-v="${addDays(todayStr(), 7)}">Dans une semaine</button>
        <button type="button" class="fav" data-act="tf-set" data-v="">Sans date</button>
      </div>
      <label class="field"><span>Notes</span><textarea id="tf-notes" placeholder="Référence, lien, numéro…">${esc(t.notes || "")}</textarea></label>
      <button class="btn wide" type="submit">Enregistrer</button>
      ${!isNew ? `<button class="btn ghost wide" type="button" data-act="tick" data-kind="todo" data-id="${esc(t.id)}" data-close="1">${t.done ? "Remettre à faire" : `${icon("check", 16)}Marquer comme fait`}</button>
        <button class="btn danger wide" type="button" data-act="del" data-col="todos" data-id="${esc(t.id)}">Supprimer</button>` : ""}
    </form>`);
  if (isNew) setTimeout(() => { const i = $("#tf-title"); if (i) i.focus(); }, 50);
}
function saveTodo(form) {
  const id = form.dataset.id || uid("d"); const prev = store.cache.todos[id] || {};
  const title = $("#tf-title").value.trim(); if (!title) return;
  guard(store.set("todos", id, { ...prev, title, due: $("#tf-due").value || null, notes: $("#tf-notes").value.trim(),
    done: !!prev.done, doneAt: prev.doneAt || null, createdAt: prev.createdAt || new Date().toISOString() }));
  closeSheet(); toast(prev.title ? "Modifié" : "Ajouté");
}

function renderShop() {
  const list = S.groceries.filter(g => g.inList);
  const favs = S.groceries.filter(g => g.fav && !g.inList).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const groups = {}; list.forEach(g => { (groups[g.aisle || "Autre"] ||= []).push(g); });
  const ordered = AISLE_NAMES.filter(a => groups[a]);
  const checked = list.filter(g => g.checked).length;
  const focused = document.activeElement && document.activeElement.id === "g-name";
  const draftTxt = $("#g-name") ? $("#g-name").value : "";
  $("#v-shop").innerHTML = `
    <form class="quickadd" id="g-form" autocomplete="off">
      <input type="text" id="g-name" placeholder="Il manque… (ex. lait, lessive)" aria-label="Article à ajouter" value="${esc(draftTxt)}" enterkeyhint="done">
      <button class="btn" type="submit">${icon("plus", 16)}Ajouter</button>
    </form>
    ${favs.length ? `<div class="section-h"><span class="label">Habituels · un tap pour ajouter</span></div>
      <div class="chips">${favs.map(g => `<button class="fav" data-act="g-readd" data-id="${esc(g.id)}">${icon("plus", 14)}${esc(g.name)}</button>`).join("")}</div>` : ""}
    <div class="section-h"><h2>Liste du prochain drive</h2><span class="label num">${list.length} article${list.length > 1 ? "s" : ""}${checked ? ` · ${checked} au panier` : ""}</span></div>
    <div class="list">${ordered.length ? ordered.map(a => `<div class="aisle">${esc(a)}</div>` + groups[a].sort((x, y) => x.name.localeCompare(y.name, "fr")).map(g => `
      <div class="gitem${g.checked ? " checked" : ""}">
        <input type="checkbox" id="chk-${esc(g.id)}" data-act="g-check" data-id="${esc(g.id)}" ${g.checked ? "checked" : ""} aria-label="Mis au panier : ${esc(g.name)}">
        <label class="nm" for="chk-${esc(g.id)}">${esc(g.name)}</label>
        <button class="icobtn${g.fav ? " on" : ""}" data-act="g-fav" data-id="${esc(g.id)}" aria-label="${g.fav ? "Retirer des habituels" : "Ajouter aux habituels"}">${icon(g.fav ? "star" : "stare", 18)}</button>
        <button class="icobtn" data-act="g-remove" data-id="${esc(g.id)}" aria-label="Retirer de la liste">${icon("x", 16)}</button>
      </div>`).join("")).join("")
      : `<div class="empty">La liste est vide. Ajoute un article dès qu'il manque quelque chose : elle sera prête le jour de la commande.</div>`}</div>
    ${list.length ? `<div class="actions">
      <button class="btn ghost" data-act="g-copy">Copier la liste</button>
      <button class="btn" data-act="g-ordered">Commande passée</button></div>
      <p class="hint">« Commande passée » vide la liste. Les articles étoilés restent dans tes habituels.</p>` : ""}`;
  if (focused) $("#g-name").focus();
}

/* ---------- sheets ---------- */
let draft = null;
function openSheet(html) {
  $("#sheet-root").innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  document.body.style.overflow = "hidden";
}
function closeSheet() { $("#sheet-root").innerHTML = ""; document.body.style.overflow = ""; draft = null; armed = null; }

function plantSheet(p) {
  const isNew = !p; p = p || {};
  draft = { photo: p.photo || null, results: [] };
  const care = !isNew && (p.light || (p.tips && p.tips.length) || p.toxic) ? `<div class="care">
      ${p.light ? `<div><span class="label">Exposition</span><br>${esc(p.light)}</div>` : ""}
      ${p.tips && p.tips.length ? `<div><span class="label">Conseils</span><ul>${p.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
      ${p.toxic ? `<div><span class="label">Animaux</span><br>${esc(p.toxic)}</div>` : ""}
    </div>` : "";
  const species = (window.PLANT_CARE && window.PLANT_CARE.LIST) || [];
  openSheet(`
    <div class="sheet-head"><h2>${isNew ? "Nouvelle plante" : esc(p.name)}</h2><button class="icobtn" data-act="close" aria-label="Fermer">${icon("x")}</button></div>
    ${!isNew ? `<button class="btn wide" data-act="water" data-id="${esc(p.id)}" data-close="1">${icon("drop", 16)}Arrosée aujourd'hui</button>` : ""}
    <label class="photo-drop">
      <div class="pv" id="pv">${p.photo ? `<img alt="" src="${esc(p.photo)}">` : icon("cam", 30)}</div>
      <div><b>${isNew ? "Prendre ou choisir une photo" : "Changer la photo"}</b><span class="hint">${PLANT_ID ? "La plante est identifiée automatiquement." : "La photo illustre la fiche de la plante."}</span></div>
      <input type="file" id="f-photo" accept="image/*">
    </label>
    <div id="id-status" class="status" hidden></div>
    ${care}
    <form id="plant-form" class="view" style="padding:0" data-id="${esc(p.id || "")}">
      <div class="two"><label class="field"><span>Nom</span><input type="text" id="f-name" required value="${esc(p.name || "")}" placeholder="Monstera du salon"></label>
        <label class="field"><span>Pièce</span><select id="f-room">${ROOMS.map(r => `<option ${r === (p.room || "Salon") ? "selected" : ""}>${r}</option>`).join("")}</select></label></div>
      <label class="field"><span>Espèce</span><input type="text" id="f-species" list="species-list" autocomplete="off" value="${esc(p.species || "")}" placeholder="Monstera, basilic, orchidée…"></label>
      <datalist id="species-list">${species.map(x => `<option value="${esc(x.latin)}">${esc(x.nom)}</option>`).join("")}</datalist>
      <div id="care-suggest" hidden></div>
      <div class="two"><label class="field"><span>Arroser tous les (jours)</span><input type="number" min="1" max="90" id="f-every" value="${esc(p.waterEveryDays || 7)}"></label>
        <label class="field"><span>En hiver (jours)</span><input type="number" min="1" max="120" id="f-winter" value="${esc(p.waterWinterDays || "")}" placeholder="auto"></label></div>
      <div class="two"><label class="field"><span>Exposition</span><select id="f-light">${LIGHTS.map(l => `<option ${l === (p.light || "Lumière vive indirecte") ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="field"><span>Dernier arrosage</span><input type="date" id="f-last" value="${esc(p.lastWatered || todayStr())}" max="${todayStr()}"></label></div>
      <label class="field"><span>Conseils (un par ligne)</span><textarea id="f-tips">${esc((p.tips || []).join("\n"))}</textarea></label>
      <input type="hidden" id="f-toxic" value="${esc(p.toxic || "")}">
      <button class="btn wide" type="submit">Enregistrer</button>
      ${!isNew ? `<button class="btn danger wide" type="button" data-act="del" data-col="plants" data-id="${esc(p.id)}">Supprimer la plante</button>` : ""}
    </form>`);
  $("#f-photo").addEventListener("change", onPhoto);
  $("#f-species").addEventListener("input", updateCareSuggest);
  $("#f-name").addEventListener("change", () => { if (!$("#f-species").value) updateCareSuggest(); });
}

/* Fiches d'entretien intégrées (plant-care.js) */
function careFor(q) { return window.PLANT_CARE ? (typeof q === "string" ? window.PLANT_CARE.lookupByName(q) : window.PLANT_CARE.lookup(q)) : null; }
function applyCare(care) {
  if (!care) return;
  const set = (id, v) => { const el = $("#" + id); if (el && v != null && v !== "") el.value = v; };
  set("f-every", care.arrosageJours); set("f-winter", care.arrosageHiverJours);
  if (LIGHTS.includes(care.exposition)) set("f-light", care.exposition);
  set("f-tips", (care.conseils || []).join("\n")); set("f-toxic", care.toxiciteAnimaux);
  if (!$("#f-name").value) set("f-name", care.nom);
}
function updateCareSuggest() {
  const box = $("#care-suggest"); if (!box) return;
  const care = careFor($("#f-species").value || $("#f-name").value);
  if (!care) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  box.className = "settings-row";
  box.innerHTML = `<div class="main"><b>Fiche « ${esc(care.nom)} » disponible</b><span class="hint">Arrosage ${esc(every(care.arrosageJours))}, ${esc(care.exposition.toLowerCase())}.</span></div>
    <button class="btn quiet" type="button" data-act="apply-care">Appliquer</button>`;
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode(); return img; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
function scaled(img, max, q) {
  const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const PLANTNET_CREDIT = `<span class="hint">Identification : <a href="https://plantnet.org" target="_blank" rel="noopener">Pl@ntNet</a></span>`;

function useResult(i) {
  const r = draft && draft.results && draft.results[i]; if (!r) return;
  const care = careFor({ species: r.nomLatin, genus: r.genre, family: r.famille });
  const name = cap(r.nomCommun) || (care && care.nom) || r.nomLatin;
  $("#f-name").value = name;
  $("#f-species").value = r.nomLatin || "";
  if (care) applyCare(care);
  updateCareSuggest();
  const conf = r.score >= .5 ? "haute" : r.score >= .2 ? "moyenne" : "faible";
  const others = draft.results.map((x, j) => ({ x, j })).filter(o => o.j !== i);
  const st = $("#id-status");
  st.className = "status ok";
  st.innerHTML = `Identifiée : <b>${esc(name)}</b> <i>${esc(r.nomLatin || "")}</i> · confiance ${conf} (${Math.round(r.score * 100)} %).
    ${care ? "Fiche d'entretien appliquée, vérifie-la puis enregistre." : "Pas de fiche connue pour cette espèce : complète l'arrosage à la main."}
    ${others.length && r.score < .6 ? `<div class="chips" style="margin-top:8px"><span class="hint">Ou peut-être :</span>${others.map(o => `<button type="button" class="fav" data-act="pick-species" data-i="${o.j}">${esc(cap(o.x.nomCommun) || o.x.nomLatin)}</button>`).join("")}</div>` : ""}
    <div style="margin-top:6px">${PLANTNET_CREDIT}</div>`;
}

async function onPhoto(e) {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  const st = $("#id-status");
  let img;
  try { img = await loadImage(file); }
  catch (err) { st.hidden = false; st.className = "status err"; st.textContent = "Impossible de lire cette image. Essaie une photo JPEG ou PNG."; return; }
  const thumb = scaled(img, 360, .72);
  draft.photo = thumb; $("#pv").innerHTML = `<img alt="" src="${thumb}">`;
  if (!PLANT_ID) return;
  if (!navigator.onLine) { st.hidden = false; st.className = "status err"; st.textContent = "Hors ligne : remplis la fiche à la main, ou reprends la photo une fois connecté."; return; }
  const base64 = scaled(img, 1280, .85).split(",")[1];
  st.hidden = false; st.className = "status"; st.innerHTML = `<span class="spin"></span>Identification de la plante…`;
  try {
    const { data, error } = await sb.functions.invoke("identify-plant", { body: { image: base64, household_id: store.hid } });
    if (error) throw error;
    if (!document.body.contains(st)) return;
    draft.results = (data && data.results) || [];
    if (!draft.results.length) {
      st.className = "status err";
      st.innerHTML = `Aucune espèce reconnue. Photographie une feuille ou une fleur de près, sur fond neutre, ou remplis la fiche à la main.<div style="margin-top:6px">${PLANTNET_CREDIT}</div>`;
      return;
    }
    useResult(0);
  } catch (err) {
    if (!document.body.contains(st)) return;
    let code = "", status = "";
    try { status = err.context && err.context.status ? String(err.context.status) : ""; code = (await err.context.json()).error || ""; } catch (e2) { }
    const detail = [err.name, status, code].filter(Boolean).join(" · ");
    st.className = "status err";
    st.textContent = code === "quota_exceeded" ? "Limite quotidienne d'identifications atteinte pour ce foyer. Remplis la fiche à la main ou réessaie demain."
      : code === "not_configured" ? "L'identification n'est pas encore configurée sur le serveur (clé Pl@ntNet manquante)."
      : code === "provider_quota" ? "Le service Pl@ntNet a atteint sa limite du jour. Réessaie demain."
      : code === "forbidden" ? "Accès refusé par le serveur : vérifie que tu es bien membre d'un foyer, puis reconnecte-toi."
      : err.name === "FunctionsFetchError" ? "Le serveur d'identification est injoignable : vérifie que la fonction s'appelle exactement « identify-plant » et qu'elle est déployée."
      : "L'identification n'a pas abouti. Remplis la fiche à la main ou réessaie avec une autre photo.";
    if (detail) st.insertAdjacentHTML("beforeend", `<div class="hint" style="margin-top:4px">Détail : ${esc(detail)}</div>`);
    console.error(err);
  }
}

function savePlant(form) {
  const id = form.dataset.id || uid("p");
  const prev = store.cache.plants[id] || {};
  const tips = $("#f-tips").value.split("\n").map(s => s.trim()).filter(Boolean);
  const winter = parseInt($("#f-winter").value);
  const data = {
    name: $("#f-name").value.trim() || "Plante", species: $("#f-species").value.trim(), room: $("#f-room").value,
    waterEveryDays: Math.max(1, parseInt($("#f-every").value) || 7), waterWinterDays: winter > 0 ? winter : null,
    light: $("#f-light").value, lastWatered: $("#f-last").value || todayStr(), tips, toxic: $("#f-toxic").value,
    photo: (draft && draft.photo) || null, createdAt: prev.createdAt || new Date().toISOString()
  };
  guard(store.set("plants", id, data));
  closeSheet(); toast(prev.name ? "Fiche mise à jour" : "Plante ajoutée");
}

function unitOf(d) { return d % 365 === 0 ? [d / 365, 365] : d % 30 === 0 ? [d / 30, 30] : d % 7 === 0 ? [d / 7, 7] : [d, 1]; }
function taskSheet(t) {
  const isNew = !t; t = t || { everyDays: 30, room: "Cuisine" };
  const [n, u] = unitOf(t.everyDays || 30);
  openSheet(`
    <div class="sheet-head"><h2>${isNew ? "Nouvelle tâche" : "Modifier la tâche"}</h2><button class="icobtn" data-act="close" aria-label="Fermer">${icon("x")}</button></div>
    ${isNew ? `<span class="label">Partir d'un modèle</span><div class="tpls">${TEMPLATES.filter(tp => !S.tasks.some(x => x.title === tp.title)).map(tp => `<button class="tpl" data-act="tpl" data-i="${TEMPLATES.indexOf(tp)}">${esc(tp.title)}<small>${esc(every(tp.everyDays))}</small></button>`).join("")}</div><span class="label">Ou la créer</span>` :
      `${t.history && t.history.length ? `<div class="care"><span class="label">Historique</span><div class="num">${t.history.slice(-6).reverse().map(shortDate).join(" · ")}</div></div>` : ""}`}
    <form id="task-form" class="view" style="padding:0" data-id="${esc(t.id || "")}">
      <label class="field"><span>Tâche</span><input type="text" id="t-title" required value="${esc(t.title || "")}" placeholder="Nettoyer le grille-pain"></label>
      <div class="two"><label class="field"><span>Répéter tous les</span><div class="inline"><input type="number" id="t-n" min="1" max="99" value="${n}" style="width:5.5em"><select id="t-u">
        <option value="1" ${u === 1 ? "selected" : ""}>jours</option><option value="7" ${u === 7 ? "selected" : ""}>semaines</option><option value="30" ${u === 30 ? "selected" : ""}>mois</option><option value="365" ${u === 365 ? "selected" : ""}>ans</option></select></div></label>
        <label class="field"><span>Pièce</span><select id="t-room">${ROOMS.map(r => `<option ${r === t.room ? "selected" : ""}>${r}</option>`).join("")}</select></label></div>
      <label class="field"><span>Dernière fois</span><input type="date" id="t-last" value="${esc(t.lastDone || todayStr())}" max="${todayStr()}"></label>
      <label class="field"><span>Notes</span><textarea id="t-notes" placeholder="Produit, référence du filtre…">${esc(t.notes || "")}</textarea></label>
      <button class="btn wide" type="submit">Enregistrer</button>
      ${!isNew ? `<button class="btn danger wide" type="button" data-act="del" data-col="tasks" data-id="${esc(t.id)}">Supprimer la tâche</button>` : ""}
    </form>`);
}
function saveTask(form) {
  const id = form.dataset.id || uid("t"); const prev = store.cache.tasks[id] || {};
  const data = {
    title: $("#t-title").value.trim(), room: $("#t-room").value,
    everyDays: Math.max(1, (parseInt($("#t-n").value) || 1) * parseInt($("#t-u").value)),
    lastDone: $("#t-last").value || todayStr(), notes: $("#t-notes").value.trim(), history: prev.history || []
  };
  if (!data.title) return;
  guard(store.set("tasks", id, data)); closeSheet(); toast(prev.title ? "Tâche mise à jour" : "Tâche ajoutée");
}

/* ---------- settings & push ---------- */
function b64ToUint8(b64) {
  const p = "=".repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
async function pushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 2500))]);
  if (!reg) return "unsupported";
  const sub = await reg.pushManager.getSubscription();
  if (sub) return "on";
  return Notification.permission === "denied" ? "denied" : "off";
}
async function settingsSheet() {
  const ps = await pushState();
  const h = S.household || {};
  const pushText = {
    on: ["Rappels activés", "Une notification chaque matin s'il y a des plantes à arroser ou des tâches dues."],
    off: ["Rappels désactivés", "Active-les pour recevoir une notification le matin."],
    denied: ["Notifications bloquées", "Autorise les notifications pour cette app dans les réglages du téléphone."],
    unsupported: isIOS() && !isStandalone()
      ? ["Installe d'abord l'app", "Sur iPhone, les notifications ne marchent qu'une fois l'app ajoutée à l'écran d'accueil (Partager → Sur l'écran d'accueil)."]
      : ["Non disponible", "Ce navigateur ne prend pas en charge les notifications."]
  }[ps];
  openSheet(`
    <div class="sheet-head"><h2>Réglages</h2><button class="icobtn" data-act="close" aria-label="Fermer">${icon("x")}</button></div>

    <span class="label">Foyer</span>
    ${S.households.length > 1 ? `<label class="field"><span>Foyer affiché</span><select id="hh-switch">${S.households.map(x => `<option value="${esc(x.id)}" ${x.id === h.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : ""}
    <div class="settings-row"><div class="main"><b>${esc(h.name || "")}</b><span class="hint" id="hh-members">Chargement des membres…</span></div></div>
    <div class="settings-row"><div class="main"><span class="label">Code d'invitation</span>
        <span class="num" style="font-family:var(--display);font-size:24px;letter-spacing:.18em" id="hh-code">${esc(h.invite_code || "")}</span>
        <span class="hint">Donne ce code à une personne de ton foyer : elle le saisit après s'être connectée pour partager tes plantes, tâches et courses.</span></div>
      <button class="btn quiet" data-act="hh-copy">Copier</button></div>
    <div class="actions">
      <button class="btn ghost" data-act="hh-regen">Nouveau code</button>
      <button class="btn ghost" data-act="hh-other">Autre foyer</button>
    </div>
    <button class="btn danger wide" data-act="hh-leave">Quitter ce foyer</button>

    <span class="label">Notifications</span>
    <div class="settings-row"><div class="main"><b>${pushText[0]}</b><span class="hint">${pushText[1]}</span></div>
      ${ps === "off" ? `<button class="btn" data-act="push-on">${icon("bell", 16)}Activer</button>` : ps === "on" ? `<button class="btn ghost" data-act="push-off">Désactiver</button>` : ""}</div>
    ${ps === "on" ? `<button class="btn quiet wide" data-act="push-test">Envoyer une notification de test</button>` : ""}
    ${!isStandalone() ? `<div class="settings-row"><div class="main"><b>Installer sur l'écran d'accueil</b><span class="hint">${isIOS() ? "Safari : bouton Partager, puis « Sur l'écran d'accueil »." : "Chrome : menu ⋮, puis « Installer l'application »."}</span></div></div>` : ""}

    <span class="label">Compte</span>
    <div class="settings-row"><div class="main"><span>${esc(S.user?.email || "")}</span>${PLANT_ID ? `<span class="hint">Identification des plantes par <a href="https://plantnet.org" target="_blank" rel="noopener">Pl@ntNet</a>.</span>` : ""}</div></div>
    <button class="btn danger wide" data-act="logout">Se déconnecter</button>`);
  const sw = $("#hh-switch"); if (sw) sw.addEventListener("change", () => { closeSheet(); switchHousehold(sw.value); });
  if (h.id && navigator.onLine) {
    const { data, error } = await sb.rpc("household_member_list", { h: h.id });
    const el = $("#hh-members");
    if (el) el.textContent = error ? "" : (data || []).map(m => m.is_me ? `${m.email} (toi)` : m.email).join(" · ");
  }
}
async function enablePush() {
  try {
    if (!CFG.vapidPublicKey || CFG.vapidPublicKey.includes("VOTRE_")) { toast("Clé VAPID manquante dans config.js"); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Notifications refusées"); settingsSheet(); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(CFG.vapidPublicKey) });
    const json = sub.toJSON();
    const { error } = await sb.from("push_subscriptions").upsert({ endpoint: json.endpoint, subscription: json, user_agent: navigator.userAgent.slice(0, 200) });
    if (error) throw error;
    toast("Rappels activés"); settingsSheet();
  } catch (e) { console.error(e); toast("Impossible d'activer les rappels sur cet appareil."); }
}
async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
    if (sub) { await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
    toast("Rappels désactivés"); settingsSheet();
  } catch (e) { toast("La désactivation a échoué."); }
}
async function testPush() {
  const reg = await navigator.serviceWorker.ready;
  reg.showNotification("Carnet de maison", { body: "Les notifications fonctionnent sur cet appareil.", icon: "./icons/icon-192.png", badge: "./icons/badge-72.png", tag: "test" });
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, undo) {
  clearTimeout(toastTimer);
  $("#toast-root").innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${undo ? '<button id="undo">Annuler</button>' : ""}</div>`;
  if (undo) $("#undo").onclick = () => { undo(); $("#toast-root").innerHTML = ""; };
  toastTimer = setTimeout(() => { $("#toast-root").innerHTML = ""; }, undo ? 5000 : 2600);
}

/* ---------- tabs & actions ---------- */
const TITLES = { home: "Aujourd'hui", plants: "Plantes", tasks: "Entretien", todo: "To-do", shop: "Courses" };
function setTab(t) {
  S.tab = t; document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  Object.keys(TITLES).forEach(v => { $("#v-" + v).hidden = v !== t; });
  $("#view-title").textContent = TITLES[t]; window.scrollTo(0, 0);
  try { localStorage.setItem("maison:tab", t); } catch (e) { }
}

function addGrocery(name) {
  name = name.trim(); if (!name) return;
  const ex = S.groceries.find(g => norm(g.name) === norm(name));
  if (ex) { if (!ex.inList) guard(store.update("groceries", ex.id, { inList: true, checked: false })); else toast("Déjà dans la liste"); return; }
  guard(store.set("groceries", uid("g"), { name: name.charAt(0).toUpperCase() + name.slice(1), aisle: guessAisle(name), inList: true, checked: false, fav: false, addedAt: new Date().toISOString() }));
}

document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  if (act === "scrim") { if (e.target === el) closeSheet(); return; }
  if (act !== "g-check") e.stopPropagation();
  switch (act) {
    case "tab": setTab(el.dataset.tab); break;
    case "close": closeSheet(); break;
    case "new-plant": plantSheet(null); break;
    case "open-plant": { const p = S.plants.find(x => x.id === id); if (p) plantSheet(p); break; }
    case "water": tick("plant", id); if (el.dataset.close) closeSheet(); break;
    case "tick": tick(el.dataset.kind, id); if (el.dataset.close) closeSheet(); break;
    case "plant-sort": plantSort = el.dataset.v; try { localStorage.setItem("maison:plantSort", plantSort); } catch (err) { } renderPlants(); break;
    case "new-todo": todoSheet(null); break;
    case "open-todo": { const t = S.todos.find(x => x.id === id); if (t) todoSheet(t); break; }
    case "quick-shop": setTab("shop"); setTimeout(() => { const i = $("#g-name"); if (i) i.focus(); }, 60); break;
    case "td-due": S.todoDue = el.dataset.v; renderTodos(); if (S.todoDue === "date") { const d = $("#td-date"); if (d) { try { d.showPicker(); } catch (err) { d.focus(); } } } break;
    case "tf-set": $("#tf-due").value = el.dataset.v; break;
    case "td-clear": {
      if (armed !== el) { armed = el; el.classList.add("danger", "armed"); el.textContent = "Confirmer : effacer les tâches faites"; break; }
      armed = null;
      (async () => { for (const t of S.todos.filter(x => x.done)) { try { await store.remove("todos", t.id); } catch (err) { guard(Promise.reject(err)); return; } } toast("Tâches faites effacées"); })();
      break;
    }
    case "new-task": taskSheet(null); break;
    case "open-task": { const t = S.tasks.find(x => x.id === id); if (t) taskSheet(t); break; }
    case "tpl": {
      const tp = TEMPLATES[+el.dataset.i]; $("#t-title").value = tp.title; $("#t-room").value = tp.room;
      const [n, u] = unitOf(tp.everyDays); $("#t-n").value = n; $("#t-u").value = u; break;
    }
    case "del": {
      if (armed !== el) { armed = el; el.classList.add("armed"); el.textContent = "Confirmer la suppression"; break; }
      guard(store.remove(el.dataset.col, id)); closeSheet(); toast("Supprimé"); break;
    }
    case "g-readd": guard(store.update("groceries", id, { inList: true, checked: false })); break;
    case "g-fav": { const g = S.groceries.find(x => x.id === id); if (g) guard(store.update("groceries", id, { fav: !g.fav })); break; }
    case "g-remove": {
      const g = S.groceries.find(x => x.id === id); if (!g) break;
      if (g.fav) guard(store.update("groceries", id, { inList: false, checked: false })); else guard(store.remove("groceries", id)); break;
    }
    case "g-check": { const g = S.groceries.find(x => x.id === id); if (g) guard(store.update("groceries", id, { checked: el.checked })); break; }
    case "g-copy": {
      const list = S.groceries.filter(g => g.inList); const groups = {}; list.forEach(g => { (groups[g.aisle || "Autre"] ||= []).push(g.name); });
      const text = AISLE_NAMES.filter(a => groups[a]).map(a => `${a}\n${groups[a].map(n => "- " + n).join("\n")}`).join("\n\n");
      if (navigator.share && isStandalone()) { navigator.share({ title: "Liste de courses", text }).catch(() => { }); break; }
      const fallback = () => { openSheet(`<div class="sheet-head"><h2>Ta liste</h2><button class="icobtn" data-act="close" aria-label="Fermer">${icon("x")}</button></div><p class="hint">Sélectionne le texte puis copie-le.</p><textarea id="copy-area" rows="12" readonly>${esc(text)}</textarea>`); const a = $("#copy-area"); a.focus(); a.select(); };
      try { navigator.clipboard.writeText(text).then(() => toast("Liste copiée"), fallback); } catch (err) { fallback(); }
      break;
    }
    case "g-ordered": {
      if (armed !== el) { armed = el; el.classList.add("danger", "armed"); el.textContent = "Confirmer : vider la liste"; break; }
      armed = null;
      const now = new Date().toISOString();
      (async () => {
        for (const g of S.groceries.filter(x => x.inList)) {
          try { if (g.fav) await store.update("groceries", g.id, { inList: false, checked: false, lastBought: now }); else await store.remove("groceries", g.id); }
          catch (err) { guard(Promise.reject(err)); return; }
        }
        toast("Liste vidée, bonne commande !");
      })();
      break;
    }
    case "apply-care": { applyCare(careFor($("#f-species").value || $("#f-name").value)); toast("Fiche appliquée"); break; }
    case "pick-species": useResult(+el.dataset.i); break;
    case "hh-copy": {
      const code = S.household && S.household.invite_code; if (!code) break;
      try { navigator.clipboard.writeText(code).then(() => toast("Code copié"), () => toast(`Code : ${code}`)); } catch (err) { toast(`Code : ${code}`); }
      break;
    }
    case "hh-regen": {
      if (armed !== el) { armed = el; el.textContent = "Confirmer : l'ancien code ne marchera plus"; break; }
      armed = null;
      (async () => {
        const { data: code, error } = await sb.rpc("regenerate_invite", { h: S.household.id });
        if (error) { toast("Impossible de générer un nouveau code."); return; }
        S.household.invite_code = code; LS.set("households", S.households);
        const c = $("#hh-code"); if (c) c.textContent = code;
        el.textContent = "Nouveau code"; toast("Nouveau code généré");
      })();
      break;
    }
    case "hh-other": closeSheet(); showOnboarding(true); break;
    case "hh-leave": {
      if (armed !== el) { armed = el; el.classList.add("armed"); el.textContent = "Confirmer : quitter ce foyer (supprimé si tu en es le dernier membre)"; break; }
      armed = null; leaveHousehold(); break;
    }
    case "push-on": enablePush(); break;
    case "push-off": disablePush(); break;
    case "push-test": testPush(); break;
    case "logout": closeSheet(); sb.auth.signOut(); break;
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && $("#sheet-root").innerHTML) closeSheet();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".pcard")) { e.preventDefault(); e.target.click(); }
});
document.addEventListener("submit", e => {
  e.preventDefault();
  if (e.target.id === "plant-form") savePlant(e.target);
  else if (e.target.id === "task-form") saveTask(e.target);
  // on vide le champ AVANT l'ajout : l'ajout redessine la liste et recopie le contenu du champ
  else if (e.target.id === "g-form") { const v = $("#g-name").value; $("#g-name").value = ""; addGrocery(v); const i = $("#g-name"); if (i) { i.value = ""; i.focus(); } }
  else if (e.target.id === "td-form") { const v = $("#td-name").value; $("#td-name").value = ""; addTodo(v); const i = $("#td-name"); if (i) { i.value = ""; i.focus(); } }
  else if (e.target.id === "todo-form") saveTodo(e.target);
  else if (e.target.id === "login-form") signIn(e.target);
  else if (e.target.id === "signup-form") signUp(e.target);
  else if (e.target.id === "hh-create-form") createHousehold(e.target);
  else if (e.target.id === "hh-join-form") joinHousehold(e.target);
});
document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
$("#btn-settings").addEventListener("click", settingsSheet);

/* ---------- login (e-mail + mot de passe) ---------- */
let loginEmail = "";
function showLogin(msg = "", mode = "login", info = "") {
  $("#app").hidden = true; $("#login").hidden = false;
  if (!CONFIGURED) {
    $("#login").innerHTML = `<div class="card"><div class="logo">${icon("home", 30)}</div><h1>Configuration requise</h1>
      <p class="hint">Renseigne l'URL et la clé de ton projet Supabase dans <code>config.js</code>, puis redéploie. Le README détaille chaque étape.</p></div>`;
    return;
  }
  const signup = mode === "signup" && ALLOW_SIGNUP;
  $("#login").innerHTML = `
    <form class="card" id="${signup ? "signup-form" : "login-form"}">
      <div class="logo">${icon("home", 30)}</div>
      <h1>${signup ? "Créer un compte" : "Carnet de maison"}</h1>
      <p class="hint">${signup ? "Ensuite, tu pourras créer ton foyer ou rejoindre celui d'un proche." : "Plantes, entretien et courses du foyer."}</p>
      <label class="field"><span>Adresse e-mail</span><input type="email" id="l-email" required autocomplete="username" inputmode="email" value="${esc(loginEmail)}"></label>
      <label class="field"><span>Mot de passe${signup ? " (8 caractères minimum)" : ""}</span><input type="password" id="l-pass" required ${signup ? 'minlength="8" autocomplete="new-password"' : 'autocomplete="current-password"'}></label>
      ${msg ? `<div class="status err">${esc(msg)}</div>` : ""}
      ${info ? `<div class="status ok">${esc(info)}</div>` : ""}
      <button class="btn wide" type="submit">${signup ? "Créer mon compte" : "Se connecter"}</button>
      ${ALLOW_SIGNUP ? `<button class="btn ghost wide" type="button" id="l-mode">${signup ? "J'ai déjà un compte" : "Créer un compte"}</button>` : ""}
      ${signup ? "" : `<p class="hint">Mot de passe oublié ? La personne qui gère l'app peut le réinitialiser depuis Supabase.</p>`}
    </form>`;
  const m = $("#l-mode"); if (m) m.onclick = () => { loginEmail = $("#l-email").value.trim().toLowerCase(); showLogin("", signup ? "login" : "signup"); };
  const first = loginEmail ? $("#l-pass") : $("#l-email"); if (first) first.focus();
}
async function signIn(form) {
  loginEmail = $("#l-email").value.trim().toLowerCase();
  const password = $("#l-pass").value;
  const btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Connexion…";
  const { error } = await sb.auth.signInWithPassword({ email: loginEmail, password });
  if (error) showLogin(error.status === 429 ? "Trop de tentatives. Patiente une minute." : !navigator.onLine ? "Pas de connexion internet."
    : /confirm/i.test(error.message || "") ? "Adresse pas encore confirmée : clique sur le lien reçu par e-mail." : "E-mail ou mot de passe incorrect.");
}
async function signUp(form) {
  loginEmail = $("#l-email").value.trim().toLowerCase();
  const password = $("#l-pass").value;
  const btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Création…";
  const { data, error } = await sb.auth.signUp({ email: loginEmail, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) { showLogin(/registered|exists/i.test(error.message || "") ? "Un compte existe déjà avec cette adresse." : /signups? not allowed|disabled/i.test(error.message || "") ? "La création de compte est désactivée. Demande à la personne qui gère l'app." : "La création du compte a échoué. Réessaie.", "signup"); return; }
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) { showLogin("Un compte existe déjà avec cette adresse.", "login"); return; }
  if (!data.session) showLogin("", "login", "Compte créé. Confirme ton adresse avec le lien reçu par e-mail, puis connecte-toi ici.");
  // sinon : onAuthStateChange prend le relais
}

/* ---------- foyers ---------- */
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem("maison:" + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem("maison:" + k, JSON.stringify(v)); } catch (e) { } }
};
async function loadHouseholds() {
  const { data, error } = await sb.from("households").select("id,name,invite_code,created_at").order("created_at");
  if (error) throw error;
  S.households = data || []; LS.set("households", S.households);
  return S.households;
}
function showApp() {
  $("#login").hidden = true; $("#app").hidden = false;
  try { const t = localStorage.getItem("maison:tab"); if (t && TITLES[t]) setTab(t); } catch (e) { }
}
function switchHousehold(id) {
  const h = S.households.find(x => x.id === id) || S.households[0]; if (!h) return;
  S.household = h; LS.set("hid", h.id);
  store.unsubscribe(); store.hid = h.id; store.loadLocal();
  $("#today-label").textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) + " · " + h.name;
  showApp(); render();
  if (navigator.onLine) {
    store.fetchAll().catch(() => toast("Chargement impossible. Les données affichées peuvent dater."));
    store.subscribe();
  } else setSync("off");
}
function showOnboarding(canCancel = false, msg = "") {
  $("#app").hidden = true; $("#login").hidden = false;
  $("#login").innerHTML = `<div class="card">
      <div class="logo">${icon("home", 30)}</div>
      <h1>${canCancel ? "Autre foyer" : "Bienvenue !"}</h1>
      <p class="hint">Crée le foyer de ta maison, ou rejoins celui d'un proche avec son code d'invitation. Chaque foyer a ses propres plantes, tâches et courses.</p>
      <form id="hh-create-form" class="view" style="padding:0">
        <label class="field"><span>Nom du foyer</span><input type="text" id="hh-name" required maxlength="60" placeholder="Appart de Lyon"></label>
        <button class="btn wide" type="submit">Créer le foyer</button>
      </form>
      <div class="label" style="text-align:center">ou</div>
      <form id="hh-join-form" class="view" style="padding:0">
        <label class="field"><span>Code d'invitation</span><input type="text" id="hh-code-in" class="code-input" required maxlength="8" autocapitalize="characters" autocomplete="off" placeholder="ABC234"></label>
        <button class="btn ghost wide" type="submit">Rejoindre ce foyer</button>
      </form>
      ${msg ? `<div class="status err">${esc(msg)}</div>` : ""}
      <button class="btn quiet wide" type="button" id="hh-back">${canCancel ? "Retour" : "Se déconnecter"}</button>
    </div>`;
  $("#hh-back").onclick = () => canCancel ? showApp() : sb.auth.signOut();
}
async function createHousehold(form) {
  const name = $("#hh-name").value.trim(); if (!name) return;
  const btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Création…";
  const { data: id, error } = await sb.rpc("create_household", { p_name: name });
  if (error) { showOnboarding(!!S.households.length, "La création du foyer a échoué. Vérifie ta connexion et réessaie."); return; }
  await loadHouseholds().catch(() => { });
  switchHousehold(id); toast(`Foyer « ${name} » créé`);
}
async function joinHousehold(form) {
  const code = $("#hh-code-in").value;
  const btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Vérification…";
  const { data: id, error } = await sb.rpc("join_household", { p_code: code });
  if (error) { showOnboarding(!!S.households.length, /invalid_code/.test(error.message || "") ? "Code inconnu. Vérifie-le auprès de la personne qui t'invite (il change si elle en génère un nouveau)." : "Impossible de rejoindre ce foyer. Vérifie ta connexion."); return; }
  await loadHouseholds().catch(() => { });
  switchHousehold(id); toast(`Bienvenue dans « ${S.household.name} »`);
}
async function leaveHousehold() {
  const h = S.household; if (!h) return;
  const { error } = await sb.rpc("leave_household", { h: h.id });
  if (error) { toast("Impossible de quitter le foyer pour l'instant."); return; }
  TABLES.forEach(t => { try { localStorage.removeItem(`maison:${h.id}:${t}`); } catch (e) { } });
  closeSheet();
  await loadHouseholds().catch(() => { S.households = S.households.filter(x => x.id !== h.id); });
  store.unsubscribe(); store.hid = null; S.household = null;
  if (S.households.length) { switchHousehold(S.households[0].id); toast(`Tu as quitté « ${h.name} »`); }
  else showOnboarding(false);
}

/* ---------- boot ---------- */
async function startApp(user) {
  S.user = user;
  S.households = LS.get("households") || [];
  if (navigator.onLine) {
    try { await loadHouseholds(); }
    catch (e) { console.error(e); if (!S.households.length) { showOnboarding(false, "Impossible de charger tes foyers. Vérifie ta connexion, puis recharge l'app."); return; } }
  }
  if (!S.households.length) { showOnboarding(false); return; }
  const wanted = new URLSearchParams(location.search).get("foyer") || LS.get("hid");
  switchHousehold(wanted);
}

$("#today-label").textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

/* Pas d'auto-remplissage (adresse, contacts…) dans les champs de l'app, sauf la connexion.
   iOS ignore parfois autocomplete="off" : on donne aussi un nom neutre au champ. */
function noAutofill(root) {
  root.querySelectorAll('input:not([type=checkbox]):not([type=file]):not([type=date]):not([type=hidden]):not([data-af]), textarea:not([data-af])').forEach(el => {
    el.setAttribute("data-af", "1");
    if (el.id === "l-email" || el.id === "l-pass") return;
    el.setAttribute("autocomplete", "off");
    el.setAttribute("name", "f-" + (el.id || "x") + "-" + Math.random().toString(36).slice(2, 6));
    el.setAttribute("data-1p-ignore", ""); el.setAttribute("data-lpignore", "true"); el.setAttribute("data-form-type", "other");
    if (el.type !== "number" && !el.classList.contains("code-input")) { el.setAttribute("autocapitalize", "sentences"); el.setAttribute("autocorrect", "on"); }
  });
}
new MutationObserver(() => noAutofill(document.body)).observe(document.body, { childList: true, subtree: true });
noAutofill(document.body);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(err => console.warn("SW", err));
  navigator.serviceWorker.addEventListener("message", e => {
    const d = e.data || {};
    if (d.foyer && d.foyer !== store.hid && S.households.some(x => x.id === d.foyer)) switchHousehold(d.foyer);
    if (d.tab && TITLES[d.tab]) setTab(d.tab);
  });
}

if (!CONFIGURED) showLogin();
else {
  let started = false;
  sb.auth.onAuthStateChange((event, session) => {
    // setTimeout : ne pas appeler d'autres méthodes Supabase directement dans ce callback (risque de blocage côté supabase-js)
    if (session && session.user && !started) { started = true; setTimeout(() => startApp(session.user), 0); }
    if (!session && event === "SIGNED_OUT") {
      started = false; S.user = null; S.household = null; S.households = [];
      store.unsubscribe(); store.hid = null;
      try { Object.keys(localStorage).filter(k => k.startsWith("maison:") && k !== "maison:tab").forEach(k => localStorage.removeItem(k)); } catch (e) { }
      showLogin();
    }
  });
  sb.auth.getSession().then(({ data }) => { if (!data.session) showLogin(); });
}

window.addEventListener("online", () => { if (S.user && store.hid) { store.fetchAll().catch(() => { }); store.subscribe(); } });
window.addEventListener("offline", () => setSync("off"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.user && store.hid && navigator.onLine) { store.fetchAll().catch(() => { }); render(); }
});
setInterval(() => { const d = todayStr(); if (d !== window.__d) { window.__d = d; render(); } }, 60000); window.__d = todayStr();
// URL ?tab=courses depuis une notification ou un raccourci
const qtab = new URLSearchParams(location.search).get("tab");
if (qtab && TITLES[qtab]) try { localStorage.setItem("maison:tab", qtab); } catch (e) { }
