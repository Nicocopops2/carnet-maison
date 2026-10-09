import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

/* =========================================================
   Carnet de maison — PWA
   Données : Supabase (tables plants, tasks, groceries ; colonne data jsonb)
   Synchro : realtime + rechargement au retour au premier plan
   Hors ligne : dernière copie en localStorage, écritures nécessitant le réseau
   ========================================================= */

const CFG = window.MAISON_CONFIG || {};
const CONFIGURED = CFG.supabaseUrl && !CFG.supabaseUrl.includes("VOTRE-PROJET") && CFG.supabaseAnonKey && !CFG.supabaseAnonKey.includes("VOTRE_");
const sb = CONFIGURED ? createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

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

/* ---------- storage (Supabase + cache local) ---------- */
const TABLES = ["plants", "tasks", "groceries"];
const store = {
  cache: { plants: {}, tasks: {}, groceries: {} },
  channel: null,
  loadLocal() {
    TABLES.forEach(t => { try { this.cache[t] = JSON.parse(localStorage.getItem("maison:" + t) || "{}"); } catch (e) { this.cache[t] = {}; } });
  },
  saveLocal(t) { try { localStorage.setItem("maison:" + t, JSON.stringify(this.cache[t])); } catch (e) { } },
  rows(t) { return Object.entries(this.cache[t]).map(([id, v]) => ({ id, ...v })); },
  emit(t) { this.saveLocal(t); S[t] = this.rows(t); render(); },
  async fetchAll() {
    for (const t of TABLES) {
      const { data, error } = await sb.from(t).select("id,data");
      if (error) throw error;
      this.cache[t] = Object.fromEntries((data || []).map(r => [r.id, r.data]));
      this.emit(t);
    }
  },
  subscribe() {
    if (this.channel) sb.removeChannel(this.channel);
    let ch = sb.channel("maison-db");
    TABLES.forEach(t => {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table: t }, payload => {
        if (payload.eventType === "DELETE") { delete this.cache[t][payload.old.id]; }
        else if (payload.new && payload.new.id) { this.cache[t][payload.new.id] = payload.new.data; }
        this.emit(t);
      });
    });
    this.channel = ch.subscribe(status => setSync(status === "SUBSCRIBED" ? "on" : navigator.onLine ? "wait" : "off"));
  },
  async set(t, id, data) {
    if (!navigator.onLine) throw { code: "offline" };
    const prev = this.cache[t][id];
    this.cache[t][id] = data; this.emit(t);
    const { error } = await sb.from(t).upsert({ id, data });
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
const S = { tab: "home", plants: [], tasks: [], groceries: [], user: null };
let armed = null;

function plantInterval(p) { return isWinter() ? (p.waterWinterDays || Math.round((p.waterEveryDays || 7) * 1.5)) : (p.waterEveryDays || 7); }
function plantDue(p) { const last = p.lastWatered || todayStr(); return diffDays(todayStr(), addDays(last, plantInterval(p))); }
function taskDue(t) { const last = t.lastDone || todayStr(); return diffDays(todayStr(), addDays(last, t.everyDays || 30)); }

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
  renderHome(); renderPlants(); renderTasks(); renderShop();
  const dueCount = S.plants.filter(p => plantDue(p) <= 0).length + S.tasks.filter(t => taskDue(t) <= 0).length;
  const b = $("#badge-home"); b.textContent = dueCount; b.hidden = dueCount === 0;
  if ("setAppBadge" in navigator) { (dueCount ? navigator.setAppBadge(dueCount) : navigator.clearAppBadge()).catch(() => { }); }
}

function plantRow(p) {
  const n = plantDue(p);
  return `<div class="row tap" data-act="open-plant" data-id="${esc(p.id)}">
    <div class="ico">${p.photo ? `<img alt="" src="${esc(p.photo)}">` : icon("leaf")}</div>
    <div class="main"><div class="title">${esc(p.name || "Plante")}</div>
      <div class="meta">${dueChip(n, "Arroser")}<span>${esc(p.room || "")}</span></div></div>
    <button class="btn quiet" data-act="water" data-id="${esc(p.id)}">${icon("drop", 16)}Arrosée</button>
  </div>`;
}
function taskRow(t) {
  const n = taskDue(t);
  return `<div class="row tap" data-act="open-task" data-id="${esc(t.id)}">
    <div class="ico">${icon("tool")}</div>
    <div class="main"><div class="title">${esc(t.title)}</div>
      <div class="meta">${dueChip(n, "À faire")}<span>${esc(every(t.everyDays || 30))}</span></div></div>
    <button class="btn quiet" data-act="done" data-id="${esc(t.id)}">${icon("check", 16)}Fait</button>
  </div>`;
}

function renderHome() {
  const plantsNow = S.plants.filter(p => plantDue(p) <= 0).sort((a, b) => plantDue(a) - plantDue(b));
  const tasksNow = S.tasks.filter(t => taskDue(t) <= 0).sort((a, b) => taskDue(a) - taskDue(b));
  const soon = [
    ...S.plants.filter(p => { const n = plantDue(p); return n > 0 && n <= 7; }).map(p => ({ k: "p", n: plantDue(p), o: p })),
    ...S.tasks.filter(t => { const n = taskDue(t); return n > 0 && n <= 7; }).map(t => ({ k: "t", n: taskDue(t), o: t }))
  ].sort((a, b) => a.n - b.n);
  const inList = S.groceries.filter(g => g.inList);
  const now = [...plantsNow.map(plantRow), ...tasksNow.map(taskRow)];
  $("#v-home").innerHTML = `
    ${isWinter() ? `<div class="season">${icon("snow", 18)}<span>Rythme d'hiver : les arrosages sont espacés automatiquement jusqu'à fin février.</span></div>` : ""}
    <div class="stats">
      <button class="stat" data-act="tab" data-tab="plants"><b>${S.plants.length}</b><span>plantes</span></button>
      <button class="stat" data-act="tab" data-tab="tasks"><b>${S.tasks.length}</b><span>tâches suivies</span></button>
      <button class="stat" data-act="tab" data-tab="shop"><b>${inList.length}</b><span>dans la liste</span></button>
    </div>
    <div class="section-h"><h2>À faire maintenant</h2><span class="label num">${now.length}</span></div>
    <div class="list">${now.length ? now.join("") : `<div class="empty">Rien d'urgent. Les plantes sont arrosées et l'entretien est à jour.</div>`}</div>
    <div class="section-h"><h2>Dans les 7 prochains jours</h2><span class="label num">${soon.length}</span></div>
    <div class="list">${soon.length ? soon.map(x => x.k === "p" ? plantRow(x.o) : taskRow(x.o)).join("") : `<div class="empty">Rien de prévu cette semaine.</div>`}</div>`;
}

function renderPlants() {
  const ps = [...S.plants].sort((a, b) => plantDue(a) - plantDue(b));
  $("#v-plants").innerHTML = `
    <div class="section-h"><p class="hint">${ps.length} plante${ps.length > 1 ? "s" : ""} · triées par prochain arrosage</p>
      <button class="btn" data-act="new-plant">${icon("cam", 16)}Ajouter</button></div>
    ${ps.length ? `<div class="grid">${ps.map(p => {
      const n = plantDue(p);
      return `<div class="pcard" role="button" tabindex="0" data-act="open-plant" data-id="${esc(p.id)}">
        <div class="ph">${p.photo ? `<img alt="" src="${esc(p.photo)}">` : icon("leaf", 40)}${dueChip(n, "Arroser")}</div>
        <div class="bd"><div class="nm">${esc(p.name || "Plante")}</div><div class="sp">${esc(p.species || "Espèce inconnue")}</div>
          <div class="ft"><small>${esc(every(plantInterval(p)))}</small>
          <button class="water" aria-label="Marquer ${esc(p.name)} comme arrosée" data-act="water" data-id="${esc(p.id)}">${icon("drop", 18)}</button></div></div>
      </div>`;
    }).join("")}</div>`
      : `<div class="list"><div class="empty"><b style="color:var(--ink)">Aucune plante pour l'instant.</b>Prends une photo : l'espèce est reconnue et la fiche d'arrosage se remplit toute seule.<button class="btn" data-act="new-plant">${icon("cam", 16)}Ajouter une plante</button></div></div>`}`;
}

function renderTasks() {
  const ts = [...S.tasks].sort((a, b) => taskDue(a) - taskDue(b));
  $("#v-tasks").innerHTML = `
    <div class="section-h"><p class="hint">Chaque tâche revient après sa dernière réalisation.</p>
      <button class="btn" data-act="new-task">${icon("plus", 16)}Nouvelle</button></div>
    ${ts.length ? `<div class="list">${ts.map(taskRow).join("")}</div>`
      : `<div class="list"><div class="empty"><b style="color:var(--ink)">Aucune tâche suivie.</b>Pars d'un modèle (détartrage, frigo, filtres…) ou crée la tienne.<button class="btn" data-act="new-task">${icon("plus", 16)}Ajouter une tâche</button></div></div>`}`;
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
  draft = { photo: p.photo || null };
  const care = !isNew && (p.light || (p.tips && p.tips.length) || p.toxic) ? `<div class="care">
      ${p.light ? `<div><span class="label">Exposition</span><br>${esc(p.light)}</div>` : ""}
      ${p.tips && p.tips.length ? `<div><span class="label">Conseils</span><ul>${p.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
      ${p.toxic ? `<div><span class="label">Animaux</span><br>${esc(p.toxic)}</div>` : ""}
    </div>` : "";
  openSheet(`
    <div class="sheet-head"><h2>${isNew ? "Nouvelle plante" : esc(p.name)}</h2><button class="icobtn" data-act="close" aria-label="Fermer">${icon("x")}</button></div>
    ${!isNew ? `<button class="btn wide" data-act="water" data-id="${esc(p.id)}" data-close="1">${icon("drop", 16)}Arrosée aujourd'hui</button>` : ""}
    <label class="photo-drop">
      <div class="pv" id="pv">${p.photo ? `<img alt="" src="${esc(p.photo)}">` : icon("cam", 30)}</div>
      <div><b>${isNew ? "Prendre ou choisir une photo" : "Changer la photo"}</b><span class="hint">La plante est identifiée automatiquement.</span></div>
      <input type="file" id="f-photo" accept="image/*">
    </label>
    <div id="id-status" class="status" hidden></div>
    ${care}
    <form id="plant-form" class="view" style="padding:0" data-id="${esc(p.id || "")}">
      <div class="two"><label class="field"><span>Nom</span><input type="text" id="f-name" required value="${esc(p.name || "")}" placeholder="Monstera du salon"></label>
        <label class="field"><span>Pièce</span><select id="f-room">${ROOMS.map(r => `<option ${r === (p.room || "Salon") ? "selected" : ""}>${r}</option>`).join("")}</select></label></div>
      <label class="field"><span>Espèce</span><input type="text" id="f-species" value="${esc(p.species || "")}" placeholder="Monstera deliciosa"></label>
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
async function onPhoto(e) {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  const st = $("#id-status");
  let img;
  try { img = await loadImage(file); }
  catch (err) { st.hidden = false; st.className = "status err"; st.textContent = "Impossible de lire cette image. Essaie une photo JPEG ou PNG."; return; }
  const thumb = scaled(img, 360, .72);
  draft.photo = thumb; $("#pv").innerHTML = `<img alt="" src="${thumb}">`;
  if (!navigator.onLine) { st.hidden = false; st.className = "status err"; st.textContent = "Hors ligne : l'identification se fera quand tu seras connecté. Tu peux remplir la fiche à la main."; return; }
  const base64 = scaled(img, 1024, .84).split(",")[1];
  st.hidden = false; st.className = "status"; st.innerHTML = `<span class="spin"></span>Identification de la plante…`;
  try {
    const { data: r, error } = await sb.functions.invoke("identify-plant", { body: { image: base64 } });
    if (error) throw error;
    if (!document.body.contains(st)) return;
    if (!r || !r.nomCommun || r.nomCommun === "Non identifiée") { st.className = "status err"; st.textContent = "Je n'ai pas reconnu de plante sur cette photo. Cadre les feuilles de plus près, ou remplis la fiche à la main."; return; }
    const set = (id, v) => { const el = $("#" + id); if (el && v != null && v !== "") el.value = v; };
    if (!$("#f-name").value) set("f-name", r.nomCommun);
    set("f-species", r.nomLatin); set("f-every", parseInt(r.arrosageJours) || ""); set("f-winter", parseInt(r.arrosageHiverJours) || "");
    if (LIGHTS.includes(r.exposition)) set("f-light", r.exposition);
    if (Array.isArray(r.conseils)) set("f-tips", r.conseils.join("\n"));
    set("f-toxic", r.toxiciteAnimaux);
    st.className = "status ok";
    st.innerHTML = `Identifiée : <b>${esc(r.nomCommun)}</b> <i>${esc(r.nomLatin || "")}</i> · confiance ${esc(r.confiance || "?")}. Vérifie la fiche puis enregistre.`;
  } catch (err) {
    if (!document.body.contains(st)) return;
    st.className = "status err";
    st.textContent = "L'identification n'a pas abouti. Remplis la fiche à la main ou réessaie avec une autre photo.";
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
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) return "on";
  return Notification.permission === "denied" ? "denied" : "off";
}
async function settingsSheet() {
  const ps = await pushState();
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
    <div class="settings-row"><div class="main"><span class="label">Compte</span><span>${esc(S.user?.email || "")}</span></div></div>
    <div class="settings-row"><div class="main"><b>${pushText[0]}</b><span class="hint">${pushText[1]}</span></div>
      ${ps === "off" ? `<button class="btn" data-act="push-on">${icon("bell", 16)}Activer</button>` : ps === "on" ? `<button class="btn ghost" data-act="push-off">Désactiver</button>` : ""}</div>
    ${ps === "on" ? `<button class="btn quiet wide" data-act="push-test">Envoyer une notification de test</button>` : ""}
    ${!isStandalone() ? `<div class="settings-row"><div class="main"><b>Installer sur l'écran d'accueil</b><span class="hint">${isIOS() ? "Safari : bouton Partager, puis « Sur l'écran d'accueil »." : "Chrome : menu ⋮, puis « Installer l'application »."}</span></div></div>` : ""}
    <button class="btn danger wide" data-act="logout">Se déconnecter</button>`);
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
const TITLES = { home: "Aujourd'hui", plants: "Plantes", tasks: "Entretien", shop: "Courses" };
function setTab(t) {
  S.tab = t; document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  ["home", "plants", "tasks", "shop"].forEach(v => { $("#v-" + v).hidden = v !== t; });
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
    case "water": {
      const p = S.plants.find(x => x.id === id); if (!p) break; const before = p.lastWatered;
      guard(store.update("plants", id, { lastWatered: todayStr() })); if (el.dataset.close) closeSheet();
      toast(`${p.name} arrosée · prochaine fois le ${shortDate(addDays(todayStr(), plantInterval(p)))}`, () => guard(store.update("plants", id, { lastWatered: before })));
      break;
    }
    case "new-task": taskSheet(null); break;
    case "open-task": { const t = S.tasks.find(x => x.id === id); if (t) taskSheet(t); break; }
    case "tpl": {
      const tp = TEMPLATES[+el.dataset.i]; $("#t-title").value = tp.title; $("#t-room").value = tp.room;
      const [n, u] = unitOf(tp.everyDays); $("#t-n").value = n; $("#t-u").value = u; break;
    }
    case "done": {
      const t = S.tasks.find(x => x.id === id); if (!t) break; const before = { lastDone: t.lastDone, history: t.history || [] };
      const history = [...(t.history || []), todayStr()].slice(-12);
      guard(store.update("tasks", id, { lastDone: todayStr(), history }));
      toast(`Fait · prochaine fois le ${shortDate(addDays(todayStr(), t.everyDays || 30))}`, () => guard(store.update("tasks", id, before)));
      break;
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
  else if (e.target.id === "g-form") { const i = $("#g-name"); addGrocery(i.value); i.value = ""; i.focus(); }
  else if (e.target.id === "login-form") signIn(e.target);
});
document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
$("#btn-settings").addEventListener("click", settingsSheet);

/* ---------- login (e-mail + mot de passe ; comptes créés dans Supabase > Authentication > Users) ---------- */
let loginEmail = "";
function showLogin(msg = "") {
  $("#app").hidden = true; $("#login").hidden = false;
  if (!CONFIGURED) {
    $("#login").innerHTML = `<div class="card"><div class="logo">${icon("home", 30)}</div><h1>Configuration requise</h1>
      <p class="hint">Renseigne l'URL et la clé de ton projet Supabase dans <code>config.js</code>, puis redéploie. Le README détaille chaque étape.</p></div>`;
    return;
  }
  $("#login").innerHTML = `
    <form class="card" id="login-form">
      <div class="logo">${icon("home", 30)}</div>
      <h1>Carnet de maison</h1>
      <p class="hint">Plantes, entretien et courses du foyer.</p>
      <label class="field"><span>Adresse e-mail</span><input type="email" id="l-email" required autocomplete="username" inputmode="email" value="${esc(loginEmail)}"></label>
      <label class="field"><span>Mot de passe</span><input type="password" id="l-pass" required autocomplete="current-password"></label>
      ${msg ? `<div class="status err">${esc(msg)}</div>` : ""}
      <button class="btn wide" type="submit">Se connecter</button>
      <p class="hint">Mot de passe oublié ? La personne qui gère l'app peut le réinitialiser depuis Supabase.</p>
    </form>`;
  const first = loginEmail ? $("#l-pass") : $("#l-email"); if (first) first.focus();
}
async function signIn(form) {
  loginEmail = $("#l-email").value.trim().toLowerCase();
  const password = $("#l-pass").value;
  const btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Connexion…";
  const { error } = await sb.auth.signInWithPassword({ email: loginEmail, password });
  if (error) showLogin(error.status === 429 ? "Trop de tentatives. Patiente une minute." : !navigator.onLine ? "Pas de connexion internet." : "E-mail ou mot de passe incorrect.");
}

/* ---------- boot ---------- */
async function startApp(user) {
  S.user = user;
  const { data: isMember, error } = await sb.rpc("is_member");
  if (error && navigator.onLine) { console.error(error); }
  if (navigator.onLine && !error && !isMember) {
    $("#app").hidden = true; $("#login").hidden = false;
    $("#login").innerHTML = `<div class="card"><div class="logo">${icon("home", 30)}</div><h1>Accès non autorisé</h1>
      <p class="hint">Le compte <b>${esc(user.email)}</b> ne fait pas partie de ce foyer. Demande à la personne qui gère l'app d'ajouter ton adresse.</p>
      <button class="btn ghost wide" id="l-out">Utiliser une autre adresse</button></div>`;
    $("#l-out").onclick = () => sb.auth.signOut();
    return;
  }
  $("#login").hidden = true; $("#app").hidden = false;
  try { const t = localStorage.getItem("maison:tab"); if (t && TITLES[t]) setTab(t); } catch (e) { }
  store.loadLocal(); TABLES.forEach(t => S[t] = store.rows(t)); render();
  if (navigator.onLine) {
    try { await store.fetchAll(); } catch (e) { toast("Chargement impossible. Les données affichées peuvent dater."); }
    store.subscribe();
  } else setSync("off");
}

$("#today-label").textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(err => console.warn("SW", err));
  navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.tab && TITLES[e.data.tab]) setTab(e.data.tab); });
}

if (!CONFIGURED) showLogin();
else {
  let started = false;
  sb.auth.onAuthStateChange((event, session) => {
    // setTimeout : ne pas appeler d'autres méthodes Supabase directement dans ce callback (risque de blocage côté supabase-js)
    if (session && session.user && !started) { started = true; setTimeout(() => startApp(session.user), 0); }
    if (!session && event === "SIGNED_OUT") {
      started = false; S.user = null;
      if (store.channel) { sb.removeChannel(store.channel); store.channel = null; } TABLES.forEach(t => { try { localStorage.removeItem("maison:" + t); } catch (e) { } }); showLogin(); }
  });
  sb.auth.getSession().then(({ data }) => { if (!data.session) showLogin(); });
}

window.addEventListener("online", () => { if (S.user) { store.fetchAll().catch(() => { }); store.subscribe(); } });
window.addEventListener("offline", () => setSync("off"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.user && navigator.onLine) { store.fetchAll().catch(() => { }); render(); }
});
setInterval(() => { const d = todayStr(); if (d !== window.__d) { window.__d = d; render(); } }, 60000); window.__d = todayStr();
// URL ?tab=courses depuis une notification ou un raccourci
const qtab = new URLSearchParams(location.search).get("tab");
if (qtab && TITLES[qtab]) try { localStorage.setItem("maison:tab", qtab); } catch (e) { }
