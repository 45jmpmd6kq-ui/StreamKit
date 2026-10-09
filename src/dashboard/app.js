// Dashboard StreamKit — logique de la page.
//
// Aucune dépendance, aucun build : le fichier est servi tel quel. Le streamer
// n'installe rien, et une mise à jour ne demande pas de recompiler quoi que ce
// soit.

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// La vue d'ensemble est un ecran a part entiere, pas un module : on lui donne
// un identifiant reserve plutot qu'un faux module dans le registre.
const ACCUEIL = '__accueil__';
const CONNECTEURS = '__connecteurs__';
const ACTIVITE = '__activite__';

const etat = {
  modules: [],
  sante: null,
  connecteurs: null,
  selection: ACCUEIL,
  general: null,
  pause: false,
  lignes: [],
  filtres: { source: '', niveau: 'info', recherche: '' },
  erreurs: 0,
};

const RANG = { debug: 0, info: 1, succes: 2, avert: 3, erreur: 4 };

// ---------------------------------------------------------------- utilitaires

async function api(chemin, options) {
  const r = await fetch(chemin, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options?.corps ? JSON.stringify(options.corps) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.erreur || 'erreur ' + r.status), { data });
  return data;
}

let minuteurToast;
function toast(message, ko = false) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.toggle('ko', ko);
  t.classList.add('visible');
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => t.classList.remove('visible'), 3200);
}

function echapper(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// La couleur d'une pastille d'etat. « attention » s'affiche en « attente » :
// la classe CSS porte le nom de la couleur, pas celui de l'etat.
function classePastille(etat) {
  return etat === 'ok' ? 'ok' : etat === 'ko' ? 'ko' : etat === 'attention' ? 'attente' : '';
}

async function copier(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    toast('Copié ✓');
  } catch {
    toast('Copie impossible — sélectionne le texte à la main', true);
  }
}

// --------------------------------------------------------- le panneau central

// Le module affiché, lu AU MOMENT où on en a besoin. Un gestionnaire qui
// garderait le module de son dessin travaillerait sur une copie périmée dès le
// rafraîchissement suivant.
const moduleAffiche = () => etat.modules.find((m) => m.id === etat.selection);

// Un champ a-t-il été touché depuis qu'il a été dessiné ? defaultValue garde la
// valeur écrite dans le HTML, value celle que le streamer a tapée.
function estModifie(champ) {
  if (champ.tagName !== 'SELECT') return champ.value !== champ.defaultValue;
  const initial = [...champ.options].findIndex((o) => o.defaultSelected);
  return champ.selectedIndex !== Math.max(initial, 0);
}

// Redessine le panneau central sans effacer ce que le streamer est en train
// d'y faire.
//
// Le dashboard se reconstruit par innerHTML, et le rafraîchissement général
// tourne toutes les 5 secondes. Sans précaution, chaque tour effaçait la saisie
// sous les doigts : l'ID client collé dans l'écran Connecteurs disparaissait
// (corrigé en 0.14.1), et le formulaire d'un module revenait à ses valeurs
// enregistrées dès qu'un AUTRE module changeait d'état.
//
// Seuls les champs MODIFIÉS depuis le dernier dessin sont repris : un champ
// auquel on n'a pas touché montre ce que dit StreamKit, y compris quand ça vient
// de changer. Et seulement quand c'est la même vue qu'on redessine : les champs
// de deux modules différents peuvent porter le même identifiant. Suivent aussi
// le champ actif, la position du curseur et les messages de retour (« Enregistré »).
//
// Renvoie vrai si c'est la même vue qui vient d'être redessinée.
function redessinerDetail(html) {
  const cible = $('#detail');
  const memeVue = cible.dataset.vue === etat.selection;

  const saisies = new Map();
  const bascules = new Map();
  const messages = new Map();
  let focus = null;
  if (memeVue) {
    for (const champ of cible.querySelectorAll('input[id], textarea[id], select[id]')) {
      if (estModifie(champ)) saisies.set(champ.id, champ.value);
    }
    for (const b of cible.querySelectorAll('.bascule[data-cle]')) {
      const valeur = b.getAttribute('aria-checked');
      if (valeur !== b.dataset.initial) bascules.set(b.dataset.cle, valeur);
    }
    for (const m of cible.querySelectorAll('.etat-sauvegarde[id]')) {
      if (m.textContent) messages.set(m.id, [m.className, m.textContent]);
    }
    const actif = document.activeElement;
    if (actif?.id && cible.contains(actif)) {
      focus = { id: actif.id, debut: actif.selectionStart, fin: actif.selectionEnd };
    }
  }

  cible.innerHTML = html;
  cible.dataset.vue = etat.selection;

  for (const [id, valeur] of saisies) {
    const champ = document.getElementById(id);
    if (champ) champ.value = valeur;
  }
  for (const [cle, valeur] of bascules) {
    cible.querySelector(`.bascule[data-cle="${cle}"]`)?.setAttribute('aria-checked', valeur);
  }
  for (const [id, [classe, texte]] of messages) {
    const m = document.getElementById(id);
    if (m) Object.assign(m, { className: classe, textContent: texte });
  }
  // Un nuancier suit son champ texte : sans ça, une couleur reprise s'afficherait
  // dans le champ mais pas dans le carré.
  for (const nuancier of cible.querySelectorAll('[data-couleur]')) {
    const texte = cible.querySelector(`[data-cle="${nuancier.dataset.couleur}"]`);
    if (texte && /^#[0-9a-f]{6}$/i.test(texte.value)) nuancier.value = texte.value;
  }
  if (focus) {
    const champ = document.getElementById(focus.id);
    if (champ) {
      champ.focus();
      try {
        champ.setSelectionRange(focus.debut ?? champ.value.length, focus.fin ?? champ.value.length);
      } catch {
        /* tous les types de champ n'acceptent pas une selection */
      }
    }
  }
  return memeVue;
}

// Ce qui vient d'être enregistré n'est plus une saisie en cours : le prochain
// dessin doit montrer ce que StreamKit a retenu, pas ce qui avait été tapé.
function marquerEnregistre(zone) {
  for (const champ of zone.querySelectorAll('input, textarea')) champ.defaultValue = champ.value;
  for (const option of zone.querySelectorAll('option')) option.defaultSelected = option.selected;
  for (const b of zone.querySelectorAll('.bascule[data-cle]'))
    b.dataset.initial = b.getAttribute('aria-checked');
}

// ------------------------------------------------------------------ bandeau haut

async function rafraichirEtat() {
  try {
    etat.general = await api('/api/etat');
  } catch {
    majPastilleTwitch({ pret: false, raison: 'StreamKit ne répond pas' });
    return;
  }
  const g = etat.general;

  $('#version').textContent = g.version;
  majPastilleTwitch(g.twitch, g);

  if (g.dossierDonnees) $('#chemin-donnees').textContent = g.dossierDonnees;

  // Le démarrage avec Windows n'existe que dans l'application Electron : lancé
  // en ligne de commande, l'option est simplement masquée plutôt que grisée.
  const bloc = $('#bloc-demarrage-auto');
  if (g.demarrageAuto?.disponible) {
    bloc.hidden = false;
    $('#in-demarrage-auto').setAttribute('aria-checked', String(!!g.demarrageAuto.actif));
  } else {
    bloc.hidden = true;
  }
}

function majPastilleTwitch(t, g) {
  const point = $('#point-twitch');
  const texte = $('#texte-twitch');

  if (t.pret && t.chatConnecte) {
    point.className = 'point ok';
    texte.textContent = 'Twitch • ' + t.channel;
  } else if (t.pret) {
    point.className = 'point attente';
    texte.textContent = 'Twitch • connexion…';
  } else {
    point.className = 'point ko';
    texte.textContent = t.raison || 'Twitch non connecté';
  }

  // « Autorisation à renouveler » n'a de sens que si une autorisation existe
  // déjà. Twitch pas encore configuré, tous les droits manquent forcément :
  // afficher « à renouveler » enverrait le streamer chercher un bouton de
  // reconnexion au lieu de lui dire de faire la configuration initiale.
  if (t.pret && g?.droitsManquants?.length) {
    point.className = 'point attente';
    texte.textContent = 'Autorisation à renouveler';
  }
}

// Lance la mise à jour. Partagé par le bouton de la barre et la fenêtre.
async function lancerMaj(bouton) {
  const texteOrigine = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = 'Mise à jour…';
  try {
    const r = await api('/api/maj/appliquer', { method: 'POST' });
    if (r.ok) {
      toast('StreamKit redémarre avec la version ' + r.derniere);
    } else {
      toast(r.raison || 'Mise à jour impossible', true);
      bouton.disabled = false;
      bouton.textContent = texteOrigine;
    }
  } catch (e) {
    toast(e.message, true);
    bouton.disabled = false;
    bouton.textContent = texteOrigine;
  }
}

// « Plus tard » vaut pour CETTE version : on ne represente pas la même fenêtre
// à chaque ouverture, mais une version suivante s'annonce bien.
function majRepoussee(version) {
  try {
    return localStorage.getItem('streamkit.majRepoussee') === version;
  } catch {
    return false;
  }
}

function repousserMaj(version) {
  try {
    localStorage.setItem('streamkit.majRepoussee', version);
  } catch {
    /* pas de stockage : la fenêtre reviendra, ce n'est pas grave */
  }
}

// Les notes de version arrivent déjà découpées par le socle (core/notes.js),
// qu'elles viennent de `latest.yml` (Markdown) ou de la release GitHub (HTML) :
// ici on ne fait que les afficher, en texte, jamais en innerHTML.
const RUBRIQUES_MAJ = [
  ['nouveautes', '✨ Nouveautés'],
  ['corrections', '🐛 Corrections'],
  ['autres', 'Au programme'],
];

function dessinerNotes(blocs) {
  $('#maj-blocs').replaceChildren(
    ...RUBRIQUES_MAJ.filter(([cle]) => blocs?.[cle]?.length).map(([cle, titre]) => {
      const bloc = document.createElement('div');
      bloc.className = 'maj-bloc';
      const h = document.createElement('h3');
      h.textContent = titre;
      const ul = document.createElement('ul');
      for (const point of blocs[cle]) {
        const li = document.createElement('li');
        li.textContent = point;
        ul.append(li);
      }
      bloc.append(h, ul);
      return bloc;
    })
  );
  return $('#maj-blocs').childElementCount > 0;
}

function dateCourte(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const jour = (x) => x.toISOString().slice(0, 10);
  if (jour(d) === jour(new Date())) return "aujourd'hui";
  return 'le ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function ouvrirModaleMaj(info) {
  $('#maj-entete').classList.remove('faite');
  $('#maj-surtitre').textContent = 'MISE À JOUR DISPONIBLE';
  $('#maj-titre').textContent = 'StreamKit ' + info.derniere;
  const publiee = info.publieeLe ? dateCourte(info.publieeLe) : '';
  $('#maj-sous').textContent = 'tu es en ' + info.actuelle + (publiee ? ' · publiée ' + publiee : '');

  // Les notes découpées ; à défaut le texte brut, s'il y en a un.
  const notes = $('#maj-notes');
  if (dessinerNotes(info.blocs)) {
    notes.hidden = true;
  } else {
    const texte = String(info.notes ?? '').trim();
    notes.hidden = !texte;
    notes.textContent = texte;
  }

  $('#maj-texte').hidden = false;
  // Un module démarré = quelque chose tourne peut-être en direct. On ne bloque
  // pas, on prévient : c'est au streamer de juger.
  $('#maj-en-live').hidden = !(etat.general?.modules?.demarres > 0);
  $('#btn-maj-plus-tard').hidden = false;
  $('#btn-maj-maintenant').hidden = false;
  $('#btn-maj-vu').hidden = true;

  $('#modale-maj').showModal();
}

// Après une mise à jour, la version installée dit ce qu'elle apporte. C'est le
// seul moment où le streamer lit vraiment les notes : au redémarrage, il a la
// fenêtre sous les yeux. Lu dans l'application, sans réseau.
async function montrerNouveautes() {
  const version = etat.general?.version;
  if (!version) return;

  let vue;
  try {
    vue = localStorage.getItem('streamkit.versionVue');
    localStorage.setItem('streamkit.versionVue', version);
  } catch {
    return; // pas de mémoire locale : on ne saurait pas quand s'arrêter
  }
  // Rien à raconter : version déjà vue, ou toute première installation.
  if (!vue || vue === version) return;

  let r;
  try {
    r = await api('/api/maj/notes');
  } catch {
    return;
  }
  if (r.version !== version || !dessinerNotes(r.blocs) || $('#modale-maj').open) return;

  $('#maj-entete').classList.add('faite');
  $('#maj-surtitre').textContent = 'MISE À JOUR INSTALLÉE';
  $('#maj-titre').textContent = 'StreamKit ' + version;
  $('#maj-sous').textContent = 'ce qui a changé';
  $('#maj-notes').hidden = true;
  $('#maj-texte').hidden = true;
  $('#maj-en-live').hidden = true;
  $('#btn-maj-plus-tard').hidden = true;
  $('#btn-maj-maintenant').hidden = true;
  $('#btn-maj-vu').hidden = false;

  $('#modale-maj').showModal();
}

async function verifierMaj() {
  let info;
  try {
    info = await api('/api/maj/verifier', { method: 'POST' });
  } catch {
    return;
  }

  const btn = $('#btn-maj');
  if (!info.ok || !info.dispo) {
    btn.hidden = true;
    return;
  }

  // Le bouton de la barre reste : c'est l'accès permanent, même après « Plus tard ».
  btn.hidden = false;
  btn.className = 'btn petit primaire';
  btn.textContent = 'Mettre à jour → ' + info.derniere;
  btn.onclick = () => ouvrirModaleMaj(info);

  if (!majRepoussee(info.derniere) && !$('#modale-maj').open) {
    ouvrirModaleMaj(info);
  }

  $('#btn-maj-plus-tard').onclick = () => {
    repousserMaj(info.derniere);
    $('#modale-maj').close();
  };
  $('#btn-maj-maintenant').onclick = (e) => lancerMaj(e.currentTarget);
}

// ------------------------------------------------------------------- les modules

async function chargerModules() {
  etat.modules = await api('/api/modules');
  // On reste sur la vue d ensemble : c est l ecran d accueil.
  dessinerRail();
  dessinerDetail();
  remplirFiltreSources();
}

// Taille à donner à la source Navigateur dans OBS. Sans taille déclarée,
// l'overlay prend toute la scène et se place tout seul dans son coin.
function tailleOverlay(t) {
  if (t)
    return `<div class="taille">Taille dans OBS : <b>${Number(t.largeur)} × ${Number(t.hauteur)}</b></div>`;
  return '<div class="taille">Taille dans OBS : <b>1920 × 1080</b> — celle de ta scène</div>';
}

function pointDeModule(m) {
  if (!m.actif) return '<span class="point"></span>';
  if (m.etat === 'demarre') return '<span class="point ok"></span>';
  if (m.etat === 'incomplet') return '<span class="point attente"></span>';
  return '<span class="point ko"></span>';
}

// Catégories repliées, mémorisées d'une session à l'autre. C'est une commodité
// d'affichage propre à ce poste : localStorage suffit, et son absence (fenêtre
// privée, données effacées) ne doit rien casser — d'où les try/catch.
function lireReplis() {
  try {
    return new Set(JSON.parse(localStorage.getItem('streamkit.replis') || '[]'));
  } catch {
    return new Set();
  }
}

function ecrireReplis(replis) {
  try {
    localStorage.setItem('streamkit.replis', JSON.stringify([...replis]));
  } catch {
    /* pas de stockage disponible : on garde juste l'état en mémoire */
  }
}

let replis = lireReplis();

// Regroupe les modules par catégorie, en respectant l'ordre du catalogue et en
// n'affichant que les catégories qui ont au moins un module.
// Les modules de développement sont des outils de diagnostic, pas des
// fonctionnalités : masqués par défaut, révélés depuis les réglages. Un module
// de dev déjà activé reste visible — sinon on ne pourrait plus le désactiver.
function lireModulesDev() {
  try {
    return localStorage.getItem('streamkit.modulesDev') === '1';
  } catch {
    return false;
  }
}

let modulesDevVisibles = lireModulesDev();

function modulesAffiches() {
  return etat.modules.filter((m) => !m.developpement || modulesDevVisibles || m.actif);
}

function grouperParCategorie() {
  const groupes = new Map();
  for (const m of modulesAffiches()) {
    const c = m.categorie ?? { id: 'outils', label: 'Outils', icone: '🧰', ordre: 90 };
    if (!groupes.has(c.id)) groupes.set(c.id, { categorie: c, modules: [] });
    groupes.get(c.id).modules.push(m);
  }
  return [...groupes.values()].sort((a, b) => a.categorie.ordre - b.categorie.ordre);
}

function dessinerRail() {
  $('#entree-accueil').classList.toggle('actif', etat.selection === ACCUEIL);
  $('#entree-connecteurs').classList.toggle('actif', etat.selection === CONNECTEURS);
  $('#entree-activite').classList.toggle('actif', etat.selection === ACTIVITE);
  const groupes = grouperParCategorie();

  $('#liste-modules').innerHTML = groupes
    .map(({ categorie, modules }) => {
      const replie = replis.has(categorie.id);
      const demarres = modules.filter((m) => m.etat === 'demarre').length;
      // La pastille de la catégorie reprend le pire état de ses modules : replié
      // ou non, un module en erreur doit rester visible.
      const enErreur = modules.some((m) => m.actif && (m.etat === 'erreur' || m.etat === 'incomplet'));
      const point = enErreur ? 'ko' : demarres ? 'ok' : '';

      return `
        <div class="groupe ${replie ? 'replie' : ''}">
          <button class="entete-groupe" data-categorie="${categorie.id}">
            <span class="fleche">${replie ? '▸' : '▾'}</span>
            <span class="icone">${categorie.icone}</span>
            <span class="nom">${echapper(categorie.label)}</span>
            <span class="point ${point}"></span>
            <span class="compte">${demarres}/${modules.length}</span>
          </button>
          <div class="modules-groupe">
            ${modules
              .map(
                (m) => `
              <button class="entree ${m.id === etat.selection ? 'actif' : ''}" data-module="${m.id}">
                ${pointDeModule(m)}
                <span class="icone">${m.icone}</span>
                <span class="nom">${echapper(m.nom)}</span>
              </button>${(m.pages ?? [])
                .filter((p) => p.raccourci)
                .map(
                  // Raccourci vers une interface du module, juste sous lui : elle
                  // s'ouvre dans le navigateur, comme son bouton « Ouvrir ».
                  (p) => `
              <a class="entree sous-entree" href="${p.url}" target="_blank" rel="noreferrer"
                 title="${echapper(p.description)}">
                <span class="icone">${echapper(p.icone || '↗')}</span>
                <span class="nom">${echapper(p.nom)}</span>
                <span class="ouvre">↗</span>
              </a>`
                )
                .join('')}`
              )
              .join('')}
          </div>
        </div>`;
    })
    .join('');
}

// Un seul écouteur pour tout le rail, posé une fois au démarrage (audit U8) :
// le rail est redessiné sans cesse, et rebrancher chaque bouton à chaque dessin
// ne coûtait que du code et des occasions d'oublier.
function brancherRail() {
  $('#liste-modules').addEventListener('click', (e) => {
    const entree = e.target.closest('[data-module]');
    if (entree) {
      etat.selection = entree.dataset.module;
      dessinerRail();
      dessinerDetail();
      return;
    }

    const groupe = e.target.closest('[data-categorie]');
    if (groupe) {
      const id = groupe.dataset.categorie;
      if (replis.has(id)) replis.delete(id);
      else replis.add(id);
      ecrireReplis(replis);
      dessinerRail();
    }
  });
}

// --- Vue d'ensemble : cockpit -----------------------------------------------

// Tableau de bord de supervision (maquette « cockpit » choisie par le user le
// 09/10/2026, face a celle de Claude Design) : ce qui est branche, ce qui
// tourne, ce qui demande une action -- avant de lancer son live.
//
// Les compteurs d'usage (clips crees, victoires…) n'y sont plus, a sa demande :
// cet ecran dit l'ETAT, pas l'activite.
//
// Tout est derive : un nouveau module apparait dans son univers, un nouvel
// univers prend un panneau, sans toucher a cette page.
//
// Un etat parmi : ok, attention, ko, off (desactive). « inactif » (connexion
// pas configuree) s'affiche comme off : ce n'est pas une panne.
const GRAVITE_CK = { ko: 3, attention: 2, ok: 1, off: 0, inactif: 0 };
const pire = (etats) => etats.reduce((a, e) => (GRAVITE_CK[e] > GRAVITE_CK[a] ? e : a), 'off');
const PASTILLE = { ok: 'ok', attente: 'av', attention: 'av', ko: 'ko', off: 'of', inactif: 'of' };

// Ce qu'on affiche d'un module : son etat, une phrase, ses sous-modules.
// Les sous-modules sont ses lignes de sante, quand il en declare plusieurs.
function etatModule(m, s) {
  const lignes = s.connexions.flatMap((g) => g.lignes).filter((l) => l.moduleId === m.id);
  // Les overlays n'y sont plus (choix du user le 09/10/2026) : ils sont deja
  // listes dans la colonne « Overlays OBS », et les cartes en devenaient hautes.
  const sous = lignes.length > 1 ? lignes.map((l) => ({ nom: l.nom, etat: l.etat, titre: l.detail })) : [];

  if (!m.actif) return { etat: 'off', detail: 'Désactivé', aide: '', sous };
  if (m.etat === 'erreur') return { etat: 'ko', detail: m.erreur || 'En erreur', aide: '', sous };
  if (m.etat === 'incomplet')
    return {
      etat: 'attention',
      detail: m.manque?.length ? 'À compléter : ' + m.manque.join(', ') : m.erreur || 'Réglages à compléter',
      aide: '',
      sous,
    };
  if (m.etat !== 'demarre') return { etat: 'attention', detail: 'Démarrage…', aide: '', sous };

  const e = lignes.length ? pire(lignes.map((l) => l.etat)) : 'ok';
  // Demarre mais sans rien a suivre (jeu ou client ferme, pas de partie) : le
  // module attend. Pastille orange (choix du user le 09/10/2026), mais ce n'est
  // pas une alerte -- un jeu ferme avant le live est la norme.
  const enAttente = GRAVITE_CK[e] <= GRAVITE_CK.ok && lignes.length && !lignes.some((x) => x.etat === 'ok');
  // La phrase de la ligne la plus grave : c'est elle qui explique la couleur.
  const l = lignes.find((x) => x.etat === e) ?? lignes[0];
  return {
    etat: GRAVITE_CK[e] > GRAVITE_CK.ok ? e : enAttente ? 'attente' : 'ok',
    detail: l?.detail || 'En marche',
    aide: l?.aide || '',
    // La ligne qui donne la couleur : si c'est une connexion (Spotify pour le
    // bot musique), l'alerte est deja portee par la connexion.
    source: l?.id,
    sous,
  };
}

function dessinerAccueil() {
  const s = etat.sante;
  $('#pied-detail').hidden = true;

  if (!s) {
    redessinerDetail('<div class="vide">Lecture de l’état des connexions…</div>');
    return;
  }

  const socle = s.connexions.find((g) => g.id === 'groupe:connexions')?.lignes ?? [];
  const groupes = grouperParCategorie().map(({ categorie, modules }) => ({
    categorie,
    modules: modules.map((m) => ({ m, ...etatModule(m, s) })),
  }));
  const tous = groupes.flatMap((g) => g.modules);
  const actifs = tous.filter((x) => x.m.actif);

  // Les alertes : une connexion ou un module ACTIF qui ne va pas. Une connexion
  // pas configuree n'en est pas une (un streamer Valorant n'a que faire de
  // Spotify), un module eteint non plus.
  // Un module dont le souci vient d'une connexion n'est pas repete : une panne,
  // une alerte.
  const soucisSocle = socle.filter((l) => l.etat === 'ko' || l.etat === 'attention');
  const dejaDit = new Set(soucisSocle.map((l) => l.id));
  const alertes = [
    ...soucisSocle.map((l) => ({
      etat: l.etat,
      titre: l.nom,
      texte: l.detail,
      aide: l.aide,
      connexion: l.id,
    })),
    ...actifs
      .filter((x) => (x.etat === 'ko' || x.etat === 'attention') && !dejaDit.has(x.source))
      .map((x) => ({ etat: x.etat, titre: x.m.nom, texte: x.detail, aide: x.aide, module: x.m.id })),
  ].sort((a, b) => GRAVITE_CK[b.etat] - GRAVITE_CK[a.etat]);

  // La jauge : la part de ce qui est en service (connexions configurees +
  // modules actifs) qui va bien. Un « a surveiller » compte pour moitie.
  const connVues = socle.filter((l) => l.etat !== 'inactif');
  const connOk = connVues.filter((l) => l.etat === 'ok').length;
  const elements = connVues.length + actifs.length;
  const points =
    connOk +
    actifs.filter((x) => x.etat === 'ok' || x.etat === 'attente').length +
    0.5 * alertes.filter((a) => a.etat === 'attention').length;
  const pourcent = elements ? Math.round((points / elements) * 100) : 0;
  const sources = Object.values(s.overlays ?? {})
    .flat()
    .reduce((n, o) => n + o.sources, 0);

  const ko = alertes.some((a) => a.etat === 'ko');
  const ton = !actifs.length ? 'off' : ko ? 'ko' : alertes.length ? 'attention' : 'ok';
  const titre = !actifs.length
    ? 'Aucun module actif'
    : ko
      ? 'Pas prêt pour le live'
      : alertes.length
        ? 'Presque prêt pour le live'
        : 'Prêt pour le live';
  const phrase = !actifs.length
    ? 'Active un module avec son interrupteur pour commencer.'
    : alertes.length
      ? alertes.length +
        ' point' +
        (alertes.length > 1 ? 's' : '') +
        ' à régler — ' +
        alertes
          .slice(0, 2)
          .map((a) => a.titre + ' : ' + a.texte)
          .join(' · ')
      : 'Tout est branché. Bon stream.';

  redessinerDetail(
    `<div class="cockpit">
      ${dessinerHero({
        ton,
        titre,
        phrase,
        pourcent,
        actifs: actifs.length,
        total: tous.length,
        connOk,
        connTotal: connVues.length,
        sources,
        alertes: alertes.length,
        enDirect: s.enDirect,
      })}
      <div class="ck-titre">Connexions</div>
      <div class="ck-conns">${socle.map(dessinerConnexion).join('')}</div>
      <div class="ck-titre">Modules par univers</div>
      <div class="ck-corps">
        <div class="ck-univers">${enService(groupes).map(dessinerUniversCockpit).join('')}</div>
        <aside class="ck-cote">
          ${dessinerAlertes(alertes)}
          ${dessinerOverlays(actifs, s)}
        </aside>
      </div>
    </div>`
  );
  caserUnivers();
}

// Chaque panneau reserve autant de rangees de 4 px que sa hauteur reelle (voir
// .ck-univers). A refaire apres chaque dessin et quand la fenetre change de
// largeur : les etiquettes passent a la ligne et les hauteurs changent.
function caserUnivers() {
  for (const u of document.querySelectorAll('.ck-univers .ck-u')) {
    u.style.gridRowEnd = '';
    const marge = parseFloat(getComputedStyle(u).marginBottom) || 0;
    u.style.gridRowEnd = 'span ' + Math.ceil((u.offsetHeight + marge) / 4);
  }
}
window.addEventListener('resize', () => {
  if (etat.selection === ACCUEIL) caserUnivers();
});

// Les univers en service d'abord, ceux sans module actif a la fin : avant un
// live, on regarde ce qui tourne. Dans chaque paquet, l'ordre du catalogue est
// garde.
function enService(groupes) {
  const actif = (g) => g.modules.some((x) => x.m.actif);
  return [...groupes.filter(actif), ...groupes.filter((g) => !actif(g))];
}

function dessinerHero(h) {
  const couleur = {
    ok: 'var(--succes)',
    attention: 'var(--avert)',
    ko: 'var(--erreur)',
    off: 'var(--bordure-vive)',
  }[h.ton];
  // Cercle de rayon 36 : circonference 226.
  const plein = Math.round((226 * h.pourcent) / 100);
  const live = h.enDirect
    ? '<span class="ck-live direct"><span class="d ko"></span>En direct</span>'
    : '<span class="ck-live"><span class="d of"></span>Hors ligne</span>';
  return `
    <section class="ck-hero ${h.ton}">
      <svg width="86" height="86" viewBox="0 0 86 86" aria-hidden="true">
        <circle cx="43" cy="43" r="36" fill="none" stroke="var(--bordure)" stroke-width="9"/>
        <circle cx="43" cy="43" r="36" fill="none" stroke="${couleur}" stroke-width="9" stroke-linecap="round"
          stroke-dasharray="${plein} 226" transform="rotate(-90 43 43)"/>
        <text x="43" y="49" text-anchor="middle" class="ck-pourcent">${h.ton === 'off' ? '—' : h.pourcent + '%'}</text>
      </svg>
      <div class="ck-hero-texte">
        <h1>${echapper(h.titre)} ${live}</h1>
        <p>${echapper(h.phrase)}</p>
      </div>
      <div class="ck-stats">
        <div class="ck-stat"><b>${h.actifs}<small> / ${h.total}</small></b><span>modules actifs</span></div>
        <div class="ck-stat"><b>${h.connOk}<small> / ${h.connTotal}</small></b><span>connexions OK</span></div>
        <div class="ck-stat"><b>${h.sources}</b><span>sources OBS</span></div>
        <div class="ck-stat ${h.alertes ? 'alerte' : ''}"><b>${h.alertes}</b><span>alerte${h.alertes > 1 ? 's' : ''}</span></div>
      </div>
    </section>`;
}

function dessinerConnexion(l) {
  const e = l.etat === 'inactif' ? 'off' : l.etat;
  return `
    <button class="ck-cx ${e}" data-ck-connexion="${echapper(l.id)}" title="${echapper(l.aide || '')}">
      <span class="ic">${echapper(l.icone || '🔌')}</span>
      <span class="n">${echapper(l.nom)}</span>
      <span class="d ${PASTILLE[e]}"></span>
      <span class="s">${echapper(l.detail || '')}</span>
    </button>`;
}

function dessinerUniversCockpit({ categorie, modules }) {
  const actifs = modules.filter((x) => x.m.actif);
  const segments = modules.map((x) => `<i class="${PASTILLE[x.etat]}"></i>`).join('');
  const n = modules.length;
  // Toujours deplie, meme sans module actif (choix du user le 10/10/2026) : on
  // active un module d'un clic sur son interrupteur, sans deplier d'abord.
  const corps = modules.map(dessinerLigneModule).join('');
  return `
    <div class="ck-u" style="--univers:${echapper(categorie.couleur || '#8b93a7')}">
      <div class="ck-uh">
        <span class="ic">${echapper(categorie.icone)}</span>
        <span class="n">${echapper(categorie.label)}</span>
        <span class="ck-ratio">${actifs.length}/${n}</span>
        <div class="ck-seg">${segments}</div>
      </div>
      ${corps}
    </div>`;
}

function dessinerLigneModule(x) {
  const { m } = x;
  const sous = x.sous.length
    ? `<div class="ck-sous">${x.sous
        .map(
          (o) =>
            `<span class="ck-sb" title="${echapper(o.titre || '')}"><span class="d ${PASTILLE[o.etat]}"></span>${echapper(o.nom)}</span>`
        )
        .join('')}</div>`
    : '';
  return `
    <div class="ck-m ${x.etat}" data-ck-module="${m.id}" title="${echapper(x.aide || '')}">
      <span class="d ${PASTILLE[x.etat]}"></span>
      <span class="n">${echapper(m.icone)} ${echapper(m.nom)}</span>
      <button class="ck-sw ${m.actif ? 'on' : ''}" data-ck-basculer="${m.id}" role="switch"
        aria-checked="${m.actif}" aria-label="${m.actif ? 'Désactiver' : 'Activer'} ${echapper(m.nom)}"></button>
      <span class="e">${echapper(x.detail)}</span>
      ${sous}
    </div>`;
}

function dessinerAlertes(alertes) {
  const corps = alertes.length
    ? alertes
        .map(
          (a) => `
      <div class="ck-al">
        <span class="d ${PASTILLE[a.etat]}"></span>
        <span class="t">${echapper(a.titre)}</span>
        <span class="x">${echapper(a.texte)}${a.aide ? `<span class="aide">${echapper(a.aide)}</span>` : ''}</span>
        ${
          a.module
            ? `<button class="ck-btn" data-ck-module="${a.module}">Ouvrir le module</button>`
            : a.connexion !== 'obs'
              ? `<button class="ck-btn" data-ck-connexion="${echapper(a.connexion)}">Voir la connexion</button>`
              : ''
        }
      </div>`
        )
        .join('')
    : '<div class="ck-rien">Rien à signaler.</div>';
  return `<div class="ck-box"><h3>Alertes <span class="${alertes.length ? 'rouge' : ''}">${alertes.length}</span></h3>${corps}</div>`;
}

// L'univers en abrege (RL, LoL, VLR…) a sa couleur : deux overlays « Moments
// forts » ne se confondent plus.
function etiquetteUnivers(c) {
  if (!c) return '';
  return `<span class="ck-tag" style="--univers:${echapper(c.couleur || '#8b93a7')}">${echapper(c.court || c.label)}</span>`;
}

// Les overlays des modules actifs : ceux deja branches dans OBS, puis combien
// attendent encore leur source.
function dessinerOverlays(actifs, s) {
  const liste = actifs.flatMap((x) => (s.overlays?.[x.m.id] ?? []).map((o) => ({ ...o, module: x.m })));
  if (!liste.length) return '';
  const branches = liste.filter((o) => o.sources);
  const reste = liste.length - branches.length;
  return `
    <div class="ck-box"><h3>Overlays OBS <span>${branches.length} / ${liste.length}</span></h3>
      ${branches
        .map(
          (o) =>
            `<button class="ck-obs" data-ck-module="${o.module.id}">${etiquetteUnivers(o.module.categorie)}<span class="nom">${echapper(o.module.icone)} ${echapper(o.module.nom)}${
              o.nom === o.module.nom ? '' : ' · ' + echapper(o.nom)
            }</span><span class="d ok"></span></button>`
        )
        .join('')}
      ${reste ? `<div class="ck-obs faible">${reste} pas encore dans OBS</div>` : ''}
    </div>`;
}

// --- Activité récente ---------------------------------------------------------

// Fil chronologique d'une journée (maquette A choisie par le user le 10/10/2026),
// du plus récent au plus ancien. On change de jour avec les flèches, les
// raccourcis « Aujourd'hui / Hier » ou le calendrier ; on filtre par univers ; et
// « + technique » y mêle le journal du même jour.
const vueActivite = {
  jour: null, // null = aujourd'hui, suivi d'un jour à l'autre si la page reste ouverte
  univers: 'tout',
  technique: false,
  recherche: '',
  donnees: null,
};

// Les sources qui ne sont pas des modules : le live lui-même, et le socle
// (seulement avec « + technique »).
const SOURCE_LIVE = { id: 'twitch', court: 'Twitch', label: 'Twitch', couleur: '#9146ff' };
const SOURCE_SOCLE = { id: 'streamkit', court: 'StreamKit', label: 'StreamKit', couleur: '#8b93a7' };

function origineEvenement(e) {
  const m = etat.modules.find((x) => x.id === e.source);
  if (m) return { categorie: m.categorie, icone: m.icone, nom: m.nom };
  if (e.source === 'live') return { categorie: SOURCE_LIVE, icone: '🔴', nom: 'Live' };
  return { categorie: SOURCE_SOCLE, icone: '⚙️', nom: e.source };
}

async function chargerActivite() {
  const p = new URLSearchParams();
  if (vueActivite.jour) p.set('jour', vueActivite.jour);
  if (vueActivite.technique) p.set('technique', '1');
  try {
    vueActivite.donnees = await api('/api/activite?' + p);
  } catch {
    vueActivite.donnees = null;
  }
  if (etat.selection === ACTIVITE) dessinerActivitePage();
}

// « jeudi 9 octobre » : la date telle qu'on la dit.
function dateLisible(jour) {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(a, m - 1, j).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function decalerJour(jour, n) {
  const [a, m, j] = jour.split('-').map(Number);
  const d = new Date(a, m - 1, j + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dessinerActivitePage() {
  $('#pied-detail').hidden = true;
  const d = vueActivite.donnees;
  if (!d) {
    redessinerDetail('<div class="vide">Lecture de l’activité…</div>');
    return;
  }

  const jour = d.jour;
  const hier = decalerJour(d.aujourdhui, -1);
  const libelleJour = jour === d.aujourdhui ? 'Aujourd’hui' : jour === hier ? 'Hier' : dateLisible(jour);

  // Les univers proposés : ceux des modules installés, dans l'ordre du rail.
  const univers = grouperParCategorie().map((g) => g.categorie);
  const q = vueActivite.recherche.trim().toLowerCase();
  const evenements = d.evenements
    .map((e) => ({ ...e, ...origineEvenement(e) }))
    .filter((e) => vueActivite.univers === 'tout' || e.categorie?.id === vueActivite.univers)
    .filter((e) => !q || e.message.toLowerCase().includes(q) || e.nom.toLowerCase().includes(q))
    .reverse();

  // Aujourd'hui, pendant un live : le live d'abord, le reste de la journée
  // ensuite. Les autres jours, un seul bloc.
  const s = etat.sante;
  const debutLive = jour === d.aujourdhui && s?.enDirect && s.directDepuis ? new Date(s.directDepuis) : null;
  const blocs = [];
  if (debutLive) {
    const p = (x) => String(x).padStart(2, '0');
    const hh = p(debutLive.getHours()) + ':' + p(debutLive.getMinutes());
    blocs.push({
      titre: 'Ce live · depuis ' + hh,
      lignes: evenements.filter((e) => new Date(e.t) >= debutLive),
    });
    blocs.push({
      titre: 'Plus tôt aujourd’hui',
      lignes: evenements.filter((e) => new Date(e.t) < debutLive),
    });
  } else {
    blocs.push({
      titre: libelleJour === 'Aujourd’hui' || libelleJour === 'Hier' ? libelleJour : 'Ce jour-là',
      lignes: evenements,
    });
  }

  const chip = (attr, valeur, texte, actif) =>
    `<button class="act-chip ${actif ? 'on' : ''}" ${attr}="${echapper(valeur)}">${texte}</button>`;

  const corps = evenements.length
    ? blocs
        .filter((b) => b.lignes.length)
        .map(
          (b) => `
        <div class="act-jour">${echapper(b.titre)}</div>
        <div class="act-liste">${b.lignes.map(dessinerEvenement).join('')}</div>`
        )
        .join('')
    : `<div class="act-vide">${
        d.evenements.length
          ? 'Rien ne correspond à ces filtres.'
          : 'Rien de noté ce jour-là. Les clips, matchs, sondages et demandes de musique apparaîtront ici.'
      }</div>`;

  redessinerDetail(`
    <div class="activite">
      <div class="titre-module"><span style="font-size:1.6rem">🕒</span><h1>Activité récente</h1></div>
      <p class="act-sous">Ce qui s’est passé sur ton live, du plus récent au plus ancien.</p>

      <div class="act-barre">
        <div class="act-dates">
          <button class="act-fleche" data-act-decaler="-1" title="Jour précédent">‹</button>
          <span class="act-date">${echapper(libelleJour)}${
            libelleJour === 'Aujourd’hui' || libelleJour === 'Hier'
              ? ` <small>${echapper(dateLisible(jour))}</small>`
              : ''
          }</span>
          <button class="act-fleche" data-act-decaler="1" title="Jour suivant" ${jour >= d.aujourdhui ? 'disabled' : ''}>›</button>
          ${chip('data-act-jour', d.aujourdhui, 'Aujourd’hui', jour === d.aujourdhui)}
          ${chip('data-act-jour', hier, 'Hier', jour === hier)}
          <input type="date" id="act-calendrier" class="act-calendrier" value="${jour}" max="${d.aujourdhui}"
            title="Choisir une date">
        </div>
        <input type="search" id="act-recherche" class="act-recherche" placeholder="Rechercher…"
          value="${echapper(vueActivite.recherche)}">
      </div>

      <div class="act-filtres">
        ${chip('data-act-univers', 'tout', 'Tout', vueActivite.univers === 'tout')}
        ${univers.map((c) => chip('data-act-univers', c.id, echapper(c.court || c.label), vueActivite.univers === c.id)).join('')}
        <span class="act-sep"></span>
        ${chip('data-act-technique', '0', 'Événements', !vueActivite.technique)}
        ${chip('data-act-technique', '1', '+ technique', vueActivite.technique)}
      </div>

      ${corps}
    </div>`);
}

const PASTILLE_NIVEAU = { succes: 'ok', info: 'in', avert: 'av', erreur: 'ko' };

function dessinerEvenement(e) {
  return `
    <div class="act-ev ${e.technique ? 'technique' : ''} ${e.niveau}">
      <time>${echapper(String(e.h).slice(0, 5))}</time>
      <span class="act-d ${PASTILLE_NIVEAU[e.niveau] || 'in'}"></span>
      ${etiquetteUnivers(e.categorie)}
      <span class="act-txt"><b>${echapper(e.icone || '')} ${echapper(e.nom)}</b> <span>${echapper(e.message)}</span></span>
    </div>`;
}

function brancherActivite() {
  const zone = $('#detail');
  zone.addEventListener('click', (e) => {
    if (etat.selection !== ACTIVITE) return;
    const b = e.target.closest(
      '[data-act-decaler], [data-act-jour], [data-act-univers], [data-act-technique]'
    );
    if (!b) return;
    const d = b.dataset;
    const courant = vueActivite.donnees?.jour;
    if (d.actDecaler && courant) {
      const cible = decalerJour(courant, Number(d.actDecaler));
      vueActivite.jour = cible >= vueActivite.donnees.aujourdhui ? null : cible;
      return chargerActivite();
    }
    if (d.actJour) {
      vueActivite.jour = d.actJour === vueActivite.donnees?.aujourdhui ? null : d.actJour;
      return chargerActivite();
    }
    if (d.actUnivers) {
      vueActivite.univers = d.actUnivers;
      return dessinerActivitePage();
    }
    if (d.actTechnique) {
      vueActivite.technique = d.actTechnique === '1';
      return chargerActivite();
    }
  });
  zone.addEventListener('change', (e) => {
    if (etat.selection !== ACTIVITE || e.target.id !== 'act-calendrier' || !e.target.value) return;
    vueActivite.jour = e.target.value >= vueActivite.donnees?.aujourdhui ? null : e.target.value;
    chargerActivite();
  });
  zone.addEventListener('input', (e) => {
    if (etat.selection !== ACTIVITE || e.target.id !== 'act-recherche') return;
    vueActivite.recherche = e.target.value;
    dessinerActivitePage();
  });
}

async function chargerSante() {
  try {
    etat.sante = await api('/api/sante');
  } catch {
    etat.sante = null;
  }
  // La pastille du rail reprend le pire état : un souci reste visible même
  // quand on est sur l'écran d'un module.
  const pire = etat.sante?.connexions?.some((c) => c.etat === 'ko')
    ? 'ko'
    : etat.sante?.connexions?.some((c) => c.etat === 'attention')
      ? 'attente'
      : 'ok';
  $('#point-accueil').className = 'point ' + (etat.sante ? pire : '');
  if (etat.selection === ACCUEIL) dessinerAccueil();
}

// --- Connecteurs ------------------------------------------------------------
// Un service se configure UNE fois ici : identifiants d'application et
// autorisation de compte au même endroit, pour Twitch comme pour Spotify.

const deplies = new Set();

// Amene sur l'ecran Connecteurs avec une carte ouverte. C'est ce que fait
// l'indicateur du bandeau : il pointe le service a brancher, sans obliger le
// streamer a le retrouver dans la liste.
async function ouvrirConnecteur(id) {
  etat.selection = CONNECTEURS;
  deplies.add(id);
  dessinerRail();
  dessinerConnecteurs();
  // Au premier clic la liste n'est pas encore chargee : on redessine apres.
  if (!etat.connecteurs) {
    await chargerConnecteurs();
    if (etat.selection === CONNECTEURS) dessinerConnecteurs();
  }
  $('.detail')?.scrollTo({ top: 0 });
}

function dessinerConnecteurs() {
  $('#pied-detail').hidden = true;

  const liste = etat.connecteurs;
  if (!liste) {
    redessinerDetail('<div class="vide">Lecture des connecteurs…</div>');
    return;
  }

  // Ce panneau se redessine tout seul pendant que le streamer y colle ses
  // identifiants : redessinerDetail garde ce qu'il a tapé.
  redessinerDetail(
    '<div class="titre-module"><span style="font-size:1.6rem">🔌</span><h1>Connecteurs</h1></div>' +
      '<p class="resume-accueil">Chaque service se configure ici, une seule fois. ' +
      'Les modules qui en ont besoin y puisent tout seuls.</p>' +
      liste.map(carteConnecteur).join('')
  );
}

function carteConnecteur(c) {
  const ouvert = deplies.has(c.id);
  const pastille = classePastille(c.etat);

  const corps = ouvert
    ? `
      <div class="conn-corps">
        <p class="conn-desc">${echapper(c.description || '')}</p>
        ${
          c.demandePar?.length
            ? `<p class="conn-desc">Utilisé par : <b>${echapper(c.demandePar.join(', '))}</b></p>`
            : c.demandePar
              ? '<p class="conn-desc">Aucun module actif n’en a besoin pour l’instant.</p>'
              : ''
        }

        <ol class="etapes">
          ${(c.etapes || []).map((e) => `<li>${echapper(e)}</li>`).join('')}
        </ol>

        <div class="champ large">
          <label>Adresse de retour à coller dans l’application</label>
          <div class="aide">Au caractère près : c’est la cause n°1 des refus d’autorisation.</div>
          <div class="saisie" style="display:flex;gap:.5rem;align-items:center">
            <code style="flex:1;font-size:.85rem;color:var(--texte-doux);overflow:hidden;text-overflow:ellipsis">${echapper(c.urlDeRetour)}</code>
            <button class="btn petit" data-copier-conn="${c.id}">Copier</button>
          </div>
        </div>

        ${
          c.id === 'twitch'
            ? `<div class="champ large">
                 <label for="cid-chaine">Nom de ta chaîne</label>
                 <div class="aide">Tel qu’il apparaît dans l’adresse : twitch.tv/<b>ton-pseudo</b></div>
                 <div class="saisie"><input type="text" id="cid-chaine" value="${echapper(c.champChaine || '')}" autocomplete="off" /></div>
               </div>`
            : ''
        }

        <div class="champ large">
          <label for="cid-${c.id}">ID client</label>
          ${
            c.pkce
              ? `<div class="aide">C’est le seul champ à remplir : ${echapper(c.nom)} n’a pas besoin de secret
                   client. StreamKit prouve son identité autrement (PKCE), il n’y a donc rien de plus à garder
                   sur ce PC.</div>`
              : ''
          }
          <div class="saisie"><input type="text" id="cid-${c.id}" autocomplete="off" spellcheck="false"
            placeholder="${c.configure ? '••••••••  (déjà enregistré)' : ''}" /></div>
        </div>
        ${
          c.pkce
            ? ''
            : `<div class="champ large">
          <label for="csec-${c.id}">Secret client</label>
          <div class="aide">Reste sur ce PC, dans un fichier que tu ne partages jamais.</div>
          <div class="saisie"><input type="password" id="csec-${c.id}" autocomplete="off" spellcheck="false"
            placeholder="${c.configure ? '••••••••  (déjà enregistré)' : ''}" /></div>
        </div>`
        }

        <div class="conn-actions">
          <a class="btn petit" href="${c.consoleUrl}" target="_blank" rel="noreferrer">Ouvrir la console développeur</a>
          <button class="btn petit" data-enregistrer-conn="${c.id}">Enregistrer les identifiants</button>
          <button class="btn petit primaire" data-autoriser-conn="${c.id}">
            ${c.connecte ? 'Reconnecter' : 'Connecter'}
          </button>
          ${c.id !== 'twitch' && c.connecte ? `<button class="btn petit" data-deconnecter-conn="${c.id}">Déconnecter</button>` : ''}
          <span class="etat-sauvegarde" id="retour-${c.id}"></span>
        </div>
      </div>`
    : '';

  return `
    <div class="conn ${c.etat}">
      <button class="conn-entete" data-conn="${c.id}">
        <span class="point ${pastille}"></span>
        <span class="conn-icone">${c.icone}</span>
        <span class="conn-nom">${echapper(c.nom)}</span>
        <span class="conn-detail">${echapper(c.compte || c.detail)}</span>
        <span class="fleche">${ouvert ? '▾' : '▸'}</span>
      </button>
      ${corps}
    </div>`;
}

function retourConnecteur(id, texte, ko = false) {
  const el = $('#retour-' + id);
  if (!el) return;
  el.className = 'etat-sauvegarde ' + (ko ? 'ko' : 'ok');
  el.textContent = texte;
}

async function enregistrerConnecteur(id) {
  const pkce = etat.connecteurs.find((x) => x.id === id)?.pkce;
  const clientId = $('#cid-' + id).value.trim();
  // Le champ n'existe pas pour un connecteur PKCE : il n'y a pas de secret.
  const clientSecret = $('#csec-' + id)?.value.trim() ?? '';
  if (!clientId) return retourConnecteur(id, 'ID client nécessaire', true);
  if (!pkce && !clientSecret) return retourConnecteur(id, 'ID et secret sont nécessaires', true);
  try {
    if (id === 'twitch') {
      const chaine = $('#cid-chaine')?.value.trim();
      if (chaine) await api('/api/connecteurs/twitch/chaine', { method: 'POST', corps: { channel: chaine } });
    }
    const r = await api('/api/connecteurs/' + id + '/app', {
      method: 'POST',
      corps: { clientId, clientSecret },
    });
    if (r.ok === false) return retourConnecteur(id, r.erreur || 'refusé', true);
    retourConnecteur(id, 'Enregistré — clique sur « Connecter »');
    // Le secret n'a plus à rester affiché : la carte montrera « déjà enregistré ».
    marquerEnregistre($('#detail'));
    await chargerConnecteurs();
  } catch (e) {
    retourConnecteur(id, e.message, true);
  }
}

async function autoriserConnecteur(id) {
  try {
    const r = await api('/api/connecteurs/' + id + '/autoriser', { method: 'POST' });
    if (r.ok === false) return retourConnecteur(id, r.erreur || r.conseil || 'autorisation impossible', true);
    retourConnecteur(id, 'Autorise StreamKit dans la page qui vient de s’ouvrir…');
    if (r.url) window.open(r.url, '_blank');
  } catch (e) {
    retourConnecteur(id, e.message, true);
  }
}

async function deconnecterConnecteur(id) {
  await api('/api/connecteurs/' + id + '/deconnecter', { method: 'POST' });
  await chargerConnecteurs();
  await chargerModules();
}

async function chargerConnecteurs() {
  const avant = JSON.stringify(etat.connecteurs ?? null);
  try {
    etat.connecteurs = await api('/api/connecteurs');
  } catch {
    etat.connecteurs = null;
  }
  const pire = etat.connecteurs?.some((c) => c.etat === 'ko')
    ? 'ko'
    : etat.connecteurs?.some((c) => c.etat === 'attention' || c.etat === 'inactif')
      ? 'attente'
      : 'ok';
  $('#point-connecteurs').className = 'point ' + (etat.connecteurs ? pire : '');

  // Ne redessiner QUE si quelque chose a bouge, comme le fait deja le rail des
  // modules. Le panneau est reconstruit en entier a chaque fois : le refaire
  // toutes les 5 secondes pour un contenu identique ne sert a rien, et coute
  // une reprise de saisie a chaque tour.
  if (etat.selection === CONNECTEURS && JSON.stringify(etat.connecteurs ?? null) !== avant) {
    dessinerConnecteurs();
  }
}

// --- Détail d'un module -----------------------------------------------------

function dessinerDetail() {
  if (etat.selection === ACCUEIL) return dessinerAccueil();
  if (etat.selection === CONNECTEURS) return dessinerConnecteurs();
  if (etat.selection === ACTIVITE) return dessinerActivitePage();

  const m = moduleAffiche();

  if (!m) {
    redessinerDetail('<div class="vide">Aucun module installé.</div>');
    $('#pied-detail').hidden = true;
    return;
  }

  const twitchKo = m.scopes.length && !etat.general?.twitch?.pret;
  const droitsManquants = (m.scopes || []).filter((s) => !(etat.general?.twitch?.scopes || []).includes(s));

  const memeVue = redessinerDetail(`
    <div class="titre-module">
      <span style="font-size:1.6rem">${m.icone}</span>
      <h1>${echapper(m.nom)}</h1>
      <button class="bascule" id="bascule-module" role="switch" aria-checked="${m.actif}"></button>
    </div>
    <p class="sous-titre">${echapper(m.description)}</p>

    ${
      m.etat === 'erreur' && m.erreur
        ? `<div class="bandeau erreur"><span>❌</span><div><b>Ce module n'a pas démarré</b><p>${echapper(m.erreur)}</p></div></div>`
        : ''
    }
    ${
      m.etat === 'incomplet'
        ? `<div class="bandeau avert"><span>⚠️</span><div><b>Réglages à compléter</b><p>${echapper(m.manque.join(', '))}</p></div></div>`
        : ''
    }
    ${
      twitchKo
        ? `<div class="bandeau avert"><span>🔌</span><div><b>Twitch n'est pas connecté</b><p>Ce module en a besoin. Clique sur l'indicateur Twitch en haut de la fenêtre.</p></div></div>`
        : ''
    }
    ${
      !twitchKo && m.actif && droitsManquants.length
        ? `<div class="bandeau avert"><span>🔑</span><div><b>Autorisation à renouveler</b><p>Ce module a besoin de droits que ton autorisation actuelle ne couvre pas (${echapper(
            droitsManquants.join(', ')
          )}). Reconnecte ta chaîne depuis l'indicateur Twitch.</p></div></div>`
        : ''
    }

    ${
      m.champs.length
        ? `<div class="section"><h3>Réglages</h3><div id="formulaire">${m.champs
            .map((c) => dessinerChamp(c, m.reglages[c.cle]))
            .join('')}</div></div>`
        : ''
    }

    ${
      m.overlays.length
        ? `<div class="section"><h3>Overlays OBS</h3>
             <p style="color:var(--texte-doux);font-size:.9rem;margin:-.35rem 0 .85rem">
               Dans OBS : <b>Sources ▸ + ▸ Navigateur</b>, colle l'adresse et règle la taille indiquée.
               Ajoute <code>?demo=1</code> pour placer la source, et retire-le ensuite.
             </p>
             ${m.overlays
               .map(
                 (o) => `<div class="overlay-ligne">
                    <div class="infos">
                      <div class="nom">${echapper(o.nom)}</div>
                      <code>http://127.0.0.1:${etat.general?.port ?? location.port}${o.url}</code>
                      ${tailleOverlay(o.taille)}
                    </div>
                    <button class="btn petit" data-copier-url="${o.url}">Copier</button>
                    <a class="btn petit" href="${o.url}?demo=1" target="_blank" rel="noreferrer">Aperçu</a>
                  </div>`
               )
               .join('')}
           </div>`
        : ''
    }

    ${
      m.pages?.length
        ? `<div class="section"><h3>Interfaces</h3>
             ${m.pages
               .map(
                 (p) => `<div class="overlay-ligne">
                    <div class="infos">
                      <div class="nom">${echapper(p.nom)}</div>
                      <code>${echapper(p.description)}</code>
                    </div>
                    <a class="btn petit primaire" href="${p.url}" target="_blank" rel="noreferrer">Ouvrir</a>
                  </div>`
               )
               .join('')}
           </div>`
        : ''
    }

    <div class="section">
      <h3>Actions</h3>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center">
        ${m.actions
          .map((a) => `<button class="btn petit" data-action="${a.nom}">${echapper(a.label)}</button>`)
          .join('')}
        <button class="btn petit" id="btn-redemarrer">Redémarrer le module</button>
      </div>
      <div class="etat-sauvegarde" id="retour-action" style="margin-top:.6rem"></div>
    </div>`);

  // Un module sans réglage n'a rien à enregistrer : pas de pied inutile. Le
  // message du pied (« Enregistré ✓ ») ne s'efface qu'en changeant de module --
  // pas au rafraîchissement qui suit justement l'enregistrement.
  $('#pied-detail').hidden = !m.champs.length;
  if (!memeVue) {
    $('#etat-sauvegarde').textContent = '';
    $('#etat-sauvegarde').className = 'etat-sauvegarde';
  }
}

// Actions déclarées par le module (« Connecter Spotify », « Tester »…).
async function lancerAction(m, bouton) {
  const retour = $('#retour-action');
  bouton.disabled = true;
  retour.className = 'etat-sauvegarde';
  retour.textContent = 'En cours…';
  try {
    const r = await api(`/api/modules/${m.id}/action/${bouton.dataset.action}`, {
      method: 'POST',
      corps: {},
    });
    retour.className = 'etat-sauvegarde ok';
    retour.textContent = r.message || 'Fait ✓';
    await chargerModules();
  } catch (e) {
    // Le panneau a pu etre redessine pendant l'action : on vise le message
    // actuel, pas celui qu'on tenait au depart.
    const actuel = $('#retour-action') ?? retour;
    actuel.className = 'etat-sauvegarde ko';
    actuel.textContent = e.data?.erreur || e.message;
  } finally {
    bouton.disabled = false;
  }
}

async function redemarrerModule(m) {
  await api(`/api/modules/${m.id}/redemarrer`, { method: 'POST' });
  toast('Module redémarré');
  chargerModules();
}

// Un seul jeu d'écouteurs pour tout le panneau central, posé une fois au
// démarrage (audit U8). Le panneau est reconstruit par innerHTML à chaque
// rafraîchissement ; brancher ses boutons à chaque dessin demandait de ne jamais
// en oublier un, et de ne jamais en brancher un deux fois -- ce qui était déjà
// arrivé sur « Enregistrer ». Ici, chaque clic est aiguillé d'après l'élément
// cliqué, et tout ce dont il a besoin est relu au moment du clic.
function brancherDetail() {
  const zone = $('#detail');

  zone.addEventListener('click', (e) => {
    // --- Vue d'ensemble (cockpit) ---
    // Les lignes de module sont cliquables en entier : on les aiguille avant
    // le filtre sur les boutons. L'interrupteur passe en premier, sinon un clic
    // dessus ouvrirait aussi le module.
    const ck = e.target.closest('[data-ck-basculer], [data-ck-connexion], [data-ck-module]');
    if (ck && zone.contains(ck)) {
      const d = ck.dataset;
      if (d.ckBasculer) {
        const m = etat.modules.find((x) => x.id === d.ckBasculer);
        if (m) basculerModule(m).then(chargerSante);
        return;
      }
      if (d.ckConnexion) {
        // OBS n'a pas d'ecran a lui : ses sources se reglent dans chaque module.
        if (d.ckConnexion === 'obs') return;
        etat.selection = CONNECTEURS;
        dessinerRail();
        return dessinerConnecteurs();
      }
      etat.selection = d.ckModule;
      dessinerRail();
      return dessinerDetail();
    }

    const el = e.target.closest('button');
    if (!el || !zone.contains(el)) return;
    const d = el.dataset;

    // --- Écran Connecteurs ---
    if (d.conn) {
      if (deplies.has(d.conn)) deplies.delete(d.conn);
      else deplies.add(d.conn);
      return dessinerConnecteurs();
    }
    if (d.copierConn) return copier(etat.connecteurs.find((x) => x.id === d.copierConn)?.urlDeRetour ?? '');
    if (d.enregistrerConn) return enregistrerConnecteur(d.enregistrerConn);
    if (d.autoriserConn) return autoriserConnecteur(d.autoriserConn);
    if (d.deconnecterConn) return deconnecterConnecteur(d.deconnecterConn);

    // --- Détail d'un module ---
    const m = moduleAffiche();
    if (!m) return;
    if (el.id === 'bascule-module') return basculerModule(m);
    if (el.id === 'btn-redemarrer') return redemarrerModule(m);
    // A defaut d'etat general, le port de la page elle-meme : le dashboard est
    // servi par StreamKit, sur le port que les overlays utilisent aussi.
    if (d.copierUrl) return copier('http://127.0.0.1:' + (etat.general?.port ?? location.port) + d.copierUrl);
    if (d.action) return lancerAction(m, el);
    if (el.matches('#formulaire .bascule')) {
      el.setAttribute('aria-checked', el.getAttribute('aria-checked') !== 'true');
    }
  });

  // Le sélecteur de couleur et son champ texte restent synchronisés.
  zone.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('[data-couleur]')) {
      const texte = zone.querySelector(`[data-cle="${el.dataset.couleur}"]`);
      if (texte) texte.value = el.value;
    } else if (el.matches('#formulaire input[type="text"][data-cle]')) {
      const nuancier = zone.querySelector(`[data-couleur="${el.dataset.cle}"]`);
      if (nuancier && /^#[0-9a-f]{6}$/i.test(el.value)) nuancier.value = el.value;
    }
  });

  // Le bouton vit dans le pied fixe du panneau, qui n'est jamais redessiné :
  // branché une fois, il enregistre le module affiché au moment du clic.
  $('#btn-sauver').addEventListener('click', () => {
    const m = moduleAffiche();
    if (m) sauverReglages(m);
  });
}

async function basculerModule(m) {
  try {
    await api(`/api/modules/${m.id}/actif`, { method: 'POST', corps: { actif: !m.actif } });
    toast(m.actif ? `${m.nom} désactivé` : `${m.nom} activé`);
    await chargerModules();
  } catch (e) {
    toast(e.message, true);
  }
}

// --------------------------------------------------- formulaire généré du module

// Un champ du schéma -> un morceau de HTML. C'est la seule fonction à étendre
// quand on ajoute un type de champ.
function dessinerChamp(c, valeur) {
  const id = 'c_' + c.cle;
  // Pas de valeur initiale : le switch a un `default`, toutes les branches
  // affectent. Un '' ici masquerait un type de champ oublie.
  let saisie;

  switch (c.type) {
    case 'bool':
      // data-initial : la valeur dessinée, pour savoir si le streamer y a touché
      // (un bouton n'a pas de defaultValue).
      saisie = `<button class="bascule" role="switch" aria-checked="${!!valeur}" data-initial="${!!valeur}" data-cle="${c.cle}"></button>`;
      break;
    case 'nombre':
      saisie = `<input type="number" id="${id}" data-cle="${c.cle}" value="${echapper(valeur ?? 0)}"
                  ${c.min !== undefined ? `min="${c.min}"` : ''} ${c.max !== undefined ? `max="${c.max}"` : ''}
                  ${c.pas ? `step="${c.pas}"` : ''} />`;
      break;
    case 'choix':
      saisie = `<select id="${id}" data-cle="${c.cle}">${c.options
        .map(
          (o) =>
            `<option value="${echapper(o.valeur)}" ${String(o.valeur) === String(valeur) ? 'selected' : ''}>${echapper(
              o.label
            )}</option>`
        )
        .join('')}</select>`;
      break;
    case 'couleur':
      saisie = `<div class="couleur-ligne">
                  <input type="color" value="${echapper(valeur || '#ffffff')}" data-couleur="${c.cle}" />
                  <input type="text" id="${id}" data-cle="${c.cle}" value="${echapper(valeur || '')}" spellcheck="false" />
                </div>`;
      break;
    case 'liste':
      saisie = `<textarea id="${id}" data-cle="${c.cle}" placeholder="Un élément par ligne">${echapper(
        (valeur || []).join('\n')
      )}</textarea>`;
      break;
    case 'texteLong':
      saisie = `<textarea id="${id}" data-cle="${c.cle}">${echapper(valeur || '')}</textarea>`;
      break;
    case 'secret':
      saisie = `<input type="password" id="${id}" data-cle="${c.cle}" value="${echapper(valeur || '')}"
                  autocomplete="off" spellcheck="false" />`;
      break;
    default:
      saisie = `<input type="text" id="${id}" data-cle="${c.cle}" value="${echapper(valeur ?? '')}"
                  autocomplete="off" spellcheck="false"
                  ${c.type === 'commande' ? 'placeholder="vide = commande désactivée"' : ''} />`;
  }

  const large = c.type === 'liste' || c.type === 'texteLong';

  return `<div class="champ ${large ? 'large' : ''}">
      <label for="${id}">${echapper(c.label ?? c.cle)}${c.requis ? ' <span style="color:var(--erreur)">*</span>' : ''}</label>
      ${c.aide ? `<div class="aide">${echapper(c.aide)}</div>` : ''}
      <div class="saisie">${saisie}</div>
    </div>`;
}

function lireFormulaire(m) {
  const out = {};
  for (const c of m.champs) {
    const el = document.querySelector(`[data-cle="${c.cle}"]`);
    if (!el) continue;
    if (c.type === 'bool') out[c.cle] = el.getAttribute('aria-checked') === 'true';
    else if (c.type === 'liste') out[c.cle] = el.value.split('\n');
    else if (c.type === 'nombre') out[c.cle] = Number(el.value);
    else out[c.cle] = el.value;
  }
  return out;
}

async function sauverReglages(m) {
  const marqueur = $('#etat-sauvegarde');
  marqueur.className = 'etat-sauvegarde';
  marqueur.textContent = 'Enregistrement…';
  try {
    await api(`/api/modules/${m.id}/config`, { method: 'POST', corps: { reglages: lireFormulaire(m) } });
    marqueur.className = 'etat-sauvegarde ok';
    marqueur.textContent = 'Enregistré ✓ — module redémarré';
    // Plus une saisie en cours : le dessin qui suit doit montrer ce que le module
    // a retenu, pas ce qui avait été tapé.
    marquerEnregistre($('#formulaire'));
    await chargerModules();
  } catch (e) {
    marqueur.className = 'etat-sauvegarde ko';
    marqueur.textContent = (e.data?.details || [e.message]).join(' · ');
  }
}

// ------------------------------------------------------------------- le journal

function ligneVisible(l) {
  const f = etat.filtres;
  if (f.source && l.source !== f.source) return false;
  if (RANG[l.niveau] < RANG[f.niveau]) return false;
  if (f.recherche) {
    const q = f.recherche.toLowerCase();
    if (!l.message.toLowerCase().includes(q) && !l.source.toLowerCase().includes(q)) return false;
  }
  return true;
}

const ICONE = { debug: '·', info: 'i', succes: '✅', avert: '⚠️', erreur: '❌' };

function htmlLigne(l) {
  return `<div class="ligne ${l.niveau}">
      <span class="h">${l.h}</span>
      <span>${ICONE[l.niveau]}</span>
      <span class="src">${echapper(l.source)}</span>
      <span class="msg">${echapper(l.message)}</span>
    </div>`;
}

function redessinerJournal() {
  const vues = etat.lignes.filter(ligneVisible);
  const zone = $('#journal');
  zone.innerHTML = vues.length
    ? vues.map(htmlLigne).join('')
    : '<div class="vide">Rien à afficher avec ces filtres.</div>';
  if (!etat.pause) zone.scrollTop = zone.scrollHeight;
}

function ajouterLigne(l) {
  etat.lignes.push(l);
  if (etat.lignes.length > 3000) etat.lignes.shift();

  if (l.niveau === 'erreur') {
    etat.erreurs++;
    $('#compteur-erreurs').textContent = etat.erreurs + ' erreur' + (etat.erreurs > 1 ? 's' : '');
  }

  if (!ligneVisible(l)) return;

  const zone = $('#journal');
  // On ne repeint pas toute la liste à chaque ligne : pendant un live actif, le
  // journal reçoit plusieurs lignes par seconde.
  if (zone.querySelector('.vide')) zone.innerHTML = '';
  zone.insertAdjacentHTML('beforeend', htmlLigne(l));
  while (zone.children.length > 3000) zone.firstElementChild.remove();
  if (!etat.pause) zone.scrollTop = zone.scrollHeight;
}

async function chargerJournal() {
  const j = await api('/api/journal?limite=800&niveau=debug');
  etat.lignes = j.lignes;
  etat.erreurs = j.lignes.filter((l) => l.niveau === 'erreur').length;
  if (etat.erreurs)
    $('#compteur-erreurs').textContent = etat.erreurs + ' erreur' + (etat.erreurs > 1 ? 's' : '');
  remplirFiltreSources(j.sources);
  redessinerJournal();
}

function remplirFiltreSources(sources) {
  const liste = sources ?? [...new Set(etat.lignes.map((l) => l.source))].sort();
  const noms = [...new Set([...liste, ...etat.modules.map((m) => m.id)])].sort();
  const select = $('#filtre-source');
  const courant = select.value;
  select.innerHTML =
    '<option value="">Tous les modules</option>' +
    noms.map((s) => `<option value="${echapper(s)}">${echapper(s)}</option>`).join('');
  select.value = courant;
}

function brancherFluxJournal() {
  const flux = new EventSource('/api/journal/flux');
  flux.addEventListener('ligne', (e) => ajouterLigne(JSON.parse(e.data)));
  // EventSource se reconnecte tout seul ; on recharge l'historique pour combler
  // le trou éventuel (typiquement après une mise à jour de StreamKit).
  flux.addEventListener('open', () => {
    if (etat.lignes.length) chargerJournal().catch(() => {});
  });
}

// -------------------------------------------------------------- tiroir : réglages

function brancherTiroir() {
  const tiroir = $('#tiroir');

  // Le journal est REPLIÉ par défaut : au quotidien le streamer vient régler un
  // module, pas lire des lignes de log. Il reste à un clic, et son en-tête
  // continue d'afficher le compteur d'erreurs même replié — un souci ne passe
  // donc jamais inaperçu.
  function appliquerRepli(replie) {
    tiroir.classList.toggle('replie', replie);
    $('#fleche').textContent = replie ? '▲' : '▼';
  }

  let replieJournal = true;
  try {
    replieJournal = localStorage.getItem('streamkit.journalOuvert') !== '1';
  } catch {
    /* pas de stockage : replié, comme au premier lancement */
  }
  appliquerRepli(replieJournal);

  $('#bascule-tiroir').addEventListener('click', () => {
    replieJournal = !replieJournal;
    appliquerRepli(replieJournal);
    try {
      localStorage.setItem('streamkit.journalOuvert', replieJournal ? '0' : '1');
    } catch {
      /* le choix ne sera pas retenu, sans plus */
    }
  });

  // Redimensionnement à la souris.
  let depart = null;
  $('#poignee').addEventListener('mousedown', (e) => {
    depart = { y: e.clientY, h: tiroir.offsetHeight };
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (e) => {
    if (!depart) return;
    const h = Math.min(window.innerHeight - 160, Math.max(90, depart.h + (depart.y - e.clientY)));
    tiroir.style.height = h + 'px';
  });
  window.addEventListener('mouseup', () => {
    depart = null;
    document.body.style.userSelect = '';
  });

  $('#filtre-source').addEventListener('change', (e) => {
    etat.filtres.source = e.target.value;
    redessinerJournal();
  });
  $('#filtre-niveau').addEventListener('change', (e) => {
    etat.filtres.niveau = e.target.value;
    redessinerJournal();
  });

  let minuteurRecherche;
  $('#recherche').addEventListener('input', (e) => {
    clearTimeout(minuteurRecherche);
    minuteurRecherche = setTimeout(() => {
      etat.filtres.recherche = e.target.value.trim();
      redessinerJournal();
    }, 180);
  });

  $('#btn-pause').addEventListener('click', () => {
    etat.pause = !etat.pause;
    $('#btn-pause').textContent = etat.pause ? '▶' : '⏸';
    $('#btn-pause').title = etat.pause ? 'Reprendre le défilement' : 'Suspendre le défilement';
    if (!etat.pause) $('#journal').scrollTop = $('#journal').scrollHeight;
  });

  $('#btn-vider').addEventListener('click', () => {
    // On ne vide que l'affichage : le fichier du jour, lui, garde tout.
    etat.lignes = [];
    etat.erreurs = 0;
    $('#compteur-erreurs').textContent = '';
    redessinerJournal();
  });

  $('#btn-telecharger').addEventListener('click', async () => {
    const fichiers = await api('/api/journal/fichiers');
    if (!fichiers.length) return toast('Aucun fichier de journal', true);
    window.open('/api/journal/fichier/' + fichiers[0], '_blank');
  });
}

// ------------------------------------------------------------------- modales

function brancherModales() {
  const mR = $('#modale-reglages');

  // « J'ai vu » ferme le « Quoi de neuf ». Branché ici et pas dans
  // verifierMaj() : quand on est À JOUR, cette fonction s'arrête avant.
  $('#btn-maj-vu').addEventListener('click', () => $('#modale-maj').close());

  // L'indicateur du bandeau menait a une fenetre qui demandait exactement ce
  // que demande la carte Twitch de l'ecran Connecteurs, en ecrivant au meme
  // endroit. Deux formulaires pour une seule donnee finissent toujours par
  // diverger : l'indicateur emmene maintenant sur la carte, depliee.
  $('#etat-twitch').addEventListener('click', () => ouvrirConnecteur('twitch'));

  $('#btn-reglages').addEventListener('click', () => {
    // L'etat des bascules se lit a l'ouverture : entre deux ouvertures,
    // rafraichirEtat() a pu changer le demarrage auto.
    $('#in-modules-dev').setAttribute('aria-checked', String(modulesDevVisibles));
    mR.showModal();
  });
  $('#btn-fermer-reglages').addEventListener('click', () => mR.close());

  $$('[data-copier]').forEach((b) =>
    b.addEventListener('click', () => copier($('#' + b.dataset.copier).textContent))
  );

  $('#in-modules-dev').addEventListener('click', (e) => {
    const b = e.currentTarget;
    modulesDevVisibles = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(modulesDevVisibles));
    try {
      localStorage.setItem('streamkit.modulesDev', modulesDevVisibles ? '1' : '0');
    } catch {
      /* le choix ne sera pas retenu, sans plus */
    }
    // Le module masque etait peut-etre celui qu'on regardait.
    if (!modulesDevVisibles && etat.modules.find((m) => m.id === etat.selection)?.developpement) {
      etat.selection = ACCUEIL;
    }
    dessinerRail();
    dessinerDetail();
  });

  $('#in-demarrage-auto').addEventListener('click', (e) => {
    const b = e.currentTarget;
    b.setAttribute('aria-checked', b.getAttribute('aria-checked') !== 'true');
  });

  $('#btn-sauver-reglages').addEventListener('click', async () => {
    // Le depot des mises a jour n'est plus un reglage : sous Electron il est
    // embarque a la compilation (build.publish), et le champ n'avait aucun
    // effet. Il ne restait qu'a le faire croire au streamer. Le socle ne
    // l'accepte plus non plus (voir definirReglagesGeneraux dans noyau.js).
    try {
      const corps = {};
      if (!$('#bloc-demarrage-auto').hidden) {
        corps.demarrageAuto = $('#in-demarrage-auto').getAttribute('aria-checked') === 'true';
      }
      await api('/api/reglages', { method: 'POST', corps });
      toast('Réglages enregistrés');
      mR.close();
      verifierMaj();
    } catch (e) {
      toast(e.message, true);
    }
  });
}

// ------------------------------------------------------------ signaler un bug

// Le rapport lui-même (journal, état du module, réglages masqués) est composé
// par StreamKit : voir core/signalement.js. Ici, seulement ce que le streamer
// ajoute — ses mots et ses captures.
const BUG_MAX_PIECES = 6;
const BUG_MAX_OCTETS = 8 * 1024 * 1024;
const BUG_MAX_TOTAL = 24 * 1024 * 1024;

const bug = { pieces: [], quand: 'instant', apercu: 0, reference: null };

const PARTIES_GENERALES = [
  ['', 'Je ne sais pas'],
  ['twitch', 'Connexion Twitch'],
  ['connecteurs', 'Connecteurs (Spotify…)'],
  ['obs', 'OBS et les overlays'],
  ['maj', 'Mise à jour'],
  ['dashboard', 'Cette fenêtre'],
];

// Les « sous-parties » d'un module : ce qu'il montre au streamer. Un overlay
// précis fait remonter ses sources OBS en tête du rapport.
function partiesDe(m) {
  if (!m) return PARTIES_GENERALES;
  return [
    ['', 'Tout le module'],
    ['reglages', 'Réglages'],
    ...m.overlays.map((o) => ['overlay:' + o.chemin, 'Overlay : ' + o.nom]),
    ...(m.pages ?? []).map((p) => ['page:' + p.chemin, 'Interface : ' + p.nom]),
    ...m.actions.map((a) => ['action:' + a.nom, 'Bouton : ' + a.label]),
    ['autre', 'Autre chose'],
  ];
}

const tailleLisible = (o) =>
  o < 1024 * 1024
    ? Math.max(1, Math.round(o / 1024)) + ' Ko'
    : (o / 1048576).toFixed(1).replace('.', ',') + ' Mo';

function remplirModulesBug() {
  const groupes = grouperParCategorie();
  $('#bug-module').innerHTML =
    '<option value="general">StreamKit en général / je ne sais pas</option>' +
    groupes
      .map(
        (g) =>
          `<optgroup label="${echapper(g.categorie.label)}">${g.modules
            .map((m) => `<option value="${echapper(m.id)}">${echapper(m.icone + ' ' + m.nom)}</option>`)
            .join('')}</optgroup>`
      )
      .join('');
  // Le module à l'écran : c'est presque toujours de lui qu'on parle.
  const courant = moduleAffiche();
  $('#bug-module').value = courant && modulesAffiches().includes(courant) ? courant.id : 'general';
}

function remplirPartiesBug() {
  const m = etat.modules.find((x) => x.id === $('#bug-module').value);
  $('#bug-partie').innerHTML = partiesDe(m)
    .map(([v, l]) => `<option value="${echapper(v)}">${echapper(l)}</option>`)
    .join('');
  if (!m && etat.selection === CONNECTEURS) $('#bug-partie').value = 'connecteurs';
}

function demandeBug() {
  const partie = $('#bug-partie');
  return {
    module: $('#bug-module').value,
    partie: partie.value,
    // « Tout le module » ou « Je ne sais pas » n'ajoutent rien au titre.
    partieLibelle: partie.value ? (partie.selectedOptions[0]?.textContent ?? '') : '',
    quand: bug.quand,
    description: $('#bug-description').value,
    pseudo: $('#bug-pseudo').value,
  };
}

// Ce qui partira avec le message, relu à chaque changement de module ou de
// date : le streamer voit exactement ce qu'il envoie.
let minuteurApercu;
function demanderApercuBug() {
  clearTimeout(minuteurApercu);
  minuteurApercu = setTimeout(chargerApercuBug, 150);
}

async function chargerApercuBug() {
  const numero = ++bug.apercu;
  $('#bug-joint-resume').textContent = 'préparation…';
  try {
    const r = await api('/api/signalement/apercu', { method: 'POST', corps: demandeBug() });
    if (numero !== bug.apercu) return; // une demande plus récente est partie entre-temps
    $('#bug-hors-ligne').hidden = r.envoiPossible;
    $('#bug-joint-resume').textContent = r.fichiers.map((f) => f.court).join(', ');
    $('#bug-joint-liste').innerHTML = r.fichiers
      .map((f) => `<li><b>${echapper(f.nom)}</b> — ${echapper(f.quoi)} · ${echapper(f.taille)}</li>`)
      .join('');
    $('#bug-rapport').textContent = r.rapport;
  } catch (e) {
    if (numero === bug.apercu) $('#bug-joint-resume').textContent = 'aperçu indisponible (' + e.message + ')';
  }
}

function lireFichier(f) {
  return new Promise((ok, ko) => {
    const lecteur = new FileReader();
    lecteur.onload = () => ok(lecteur.result);
    lecteur.onerror = () => ko(lecteur.error);
    lecteur.readAsDataURL(f);
  });
}

async function ajouterPiecesBug(fichiers) {
  for (const f of fichiers) {
    if (bug.pieces.length >= BUG_MAX_PIECES) {
      toast(BUG_MAX_PIECES + ' pièces jointes au plus', true);
      break;
    }
    if (f.size > BUG_MAX_OCTETS) {
      toast('« ' + f.name + ' » dépasse 8 Mo : envoie-le directement sur Discord', true);
      continue;
    }
    if (bug.pieces.reduce((t, p) => t + p.taille, 0) + f.size > BUG_MAX_TOTAL) {
      toast('Pièces jointes trop lourdes (24 Mo au total)', true);
      break;
    }
    // Une capture collée s'appelle « image.png » : on lui donne un vrai nom.
    const collee = !f.name || /^image\.\w+$/i.test(f.name);
    const extension = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const nom = collee ? 'capture-' + (bug.pieces.length + 1) + '.' + extension : f.name;
    try {
      bug.pieces.push({
        nom,
        type: f.type || 'application/octet-stream',
        taille: f.size,
        url: await lireFichier(f),
      });
    } catch {
      toast('« ' + nom + ' » est illisible', true);
    }
  }
  dessinerPiecesBug();
}

// Construit à la main plutôt qu'en innerHTML : l'aperçu est une adresse data:
// fabriquée à partir du fichier, on ne la recopie pas dans du HTML.
function dessinerPiecesBug() {
  $('#bug-vignettes').replaceChildren(
    ...bug.pieces.map((p, i) => {
      const v = document.createElement('div');
      v.className = 'vignette';
      v.title = p.nom + ' · ' + tailleLisible(p.taille);
      if (p.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = p.url;
        img.alt = '';
        v.append(img);
      } else {
        v.textContent = p.nom;
      }
      const retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = 'retirer';
      retirer.dataset.retirer = String(i);
      retirer.setAttribute('aria-label', 'Retirer ' + p.nom);
      retirer.textContent = '×';
      v.append(retirer);
      return v;
    })
  );
}

function viderFormulaireBug() {
  bug.pieces = [];
  $('#bug-description').value = '';
  dessinerPiecesBug();
}

function ouvrirBug() {
  // Le résultat du rapport précédent laisse la place à un formulaire neuf. Un
  // brouillon fermé par erreur (Échap), lui, est gardé.
  $('#bug-formulaire').hidden = false;
  $('#bug-resultat').hidden = true;
  $('#btn-bug-envoyer').hidden = false;
  $('#btn-bug-dossier').hidden = true;
  $('#btn-bug-annuler').textContent = 'Annuler';
  $('#bug-erreur').hidden = true;

  remplirModulesBug();
  remplirPartiesBug();
  if (!$('#bug-pseudo').value) {
    let pseudo = '';
    try {
      pseudo = localStorage.getItem('streamkit.pseudoBug') || '';
    } catch {
      /* pas de mémoire locale : on part de la chaîne */
    }
    $('#bug-pseudo').value = pseudo || etat.general?.chaine || '';
  }
  $('#modale-bug').showModal();
  $('#bug-description').focus();
  chargerApercuBug();
}

function afficherResultatBug(r) {
  bug.reference = r.reference;
  $('#bug-formulaire').hidden = true;
  $('#btn-bug-envoyer').hidden = true;
  $('#btn-bug-annuler').textContent = 'Fermer';
  const zone = $('#bug-resultat');
  zone.hidden = false;

  if (r.ok && !r.partiel) {
    zone.innerHTML = `<div class="bandeau succes"><span>✅</span><div><b>Rapport envoyé</b>
      <p>Référence <code>${echapper(r.reference)}</code> : donne-la si on t'en reparle. Merci !</p></div></div>`;
  } else {
    const raison = String(r.partiel || r.raison || 'raison inconnue');
    zone.innerHTML = `<div class="bandeau avert"><span>⚠️</span><div>
      <b>${r.ok ? 'Rapport envoyé en partie' : 'Ton rapport n’est pas parti'}</b>
      <p>${echapper(raison.charAt(0).toUpperCase() + raison.slice(1))}. Il est enregistré sur ce PC : ouvre
      le dossier et envoie ses fichiers sur Discord à la personne qui s'occupe de StreamKit.</p>
      <p style="margin-top:.5rem"><code>${echapper(r.dossier)}</code></p></div></div>`;
    $('#btn-bug-dossier').hidden = !r.ouvrable;
  }
  viderFormulaireBug();
}

async function envoyerBug() {
  const erreur = $('#bug-erreur');
  const d = demandeBug();
  if (d.description.trim().length < 10) {
    erreur.textContent = 'Décris ton problème en quelques mots : ce que tu faisais, ce qui s’est passé.';
    erreur.hidden = false;
    $('#bug-description').focus();
    return;
  }
  erreur.hidden = true;

  try {
    localStorage.setItem('streamkit.pseudoBug', d.pseudo.trim());
  } catch {
    /* le pseudo ne sera pas retenu, sans plus */
  }

  const bouton = $('#btn-bug-envoyer');
  bouton.disabled = true;
  bouton.textContent = 'Envoi…';
  try {
    const r = await api('/api/signalement', {
      method: 'POST',
      corps: {
        ...d,
        pieces: bug.pieces.map((p) => ({
          nom: p.nom,
          type: p.type,
          donnees: p.url.slice(p.url.indexOf(',') + 1),
        })),
      },
    });
    afficherResultatBug(r);
  } catch (e) {
    erreur.textContent = e.data?.erreur || e.message;
    erreur.hidden = false;
  } finally {
    bouton.disabled = false;
    bouton.textContent = 'Envoyer';
  }
}

function brancherSignalement() {
  const modale = $('#modale-bug');

  $('#btn-bug').addEventListener('click', ouvrirBug);
  $('#btn-bug-annuler').addEventListener('click', () => modale.close());
  $('#btn-bug-envoyer').addEventListener('click', envoyerBug);

  $('#btn-bug-dossier').addEventListener('click', async () => {
    try {
      const r = await api('/api/signalement/dossier', {
        method: 'POST',
        corps: { reference: bug.reference },
      });
      if (!r.ok) toast(r.erreur || 'Ouverture impossible', true);
    } catch (e) {
      toast(e.message, true);
    }
  });

  $('#bug-module').addEventListener('change', () => {
    remplirPartiesBug();
    demanderApercuBug();
  });
  $('#bug-partie').addEventListener('change', demanderApercuBug);

  $('.bug-quand').addEventListener('click', (e) => {
    const puce = e.target.closest('[data-quand]');
    if (!puce) return;
    bug.quand = puce.dataset.quand;
    $$('.bug-quand .puce').forEach((p) => p.setAttribute('aria-checked', String(p === puce)));
    demanderApercuBug();
  });

  $('#bug-description').addEventListener('input', () => {
    $('#bug-erreur').hidden = true;
  });

  // Captures : choisies, glissées sur la fenêtre, ou collées (Win+Maj+S puis
  // Ctrl+V), le geste que tout le monde connaît.
  $('#bug-parcourir').addEventListener('click', () => $('#bug-fichiers').click());
  $('#bug-fichiers').addEventListener('change', (e) => {
    ajouterPiecesBug([...e.target.files]);
    e.target.value = '';
  });

  modale.addEventListener('paste', (e) => {
    const fichiers = [...(e.clipboardData?.files ?? [])];
    if (!fichiers.length) return; // du texte : il se colle dans le champ, normalement
    e.preventDefault();
    ajouterPiecesBug(fichiers);
  });

  // Toute la fenêtre accepte le dépôt : lâché à côté de la zone, un fichier
  // ferait sinon naviguer le dashboard vers lui.
  const depot = $('#bug-depot');
  modale.addEventListener('dragover', (e) => {
    e.preventDefault();
    depot.classList.add('survol');
  });
  modale.addEventListener('dragleave', (e) => {
    if (!modale.contains(e.relatedTarget)) depot.classList.remove('survol');
  });
  modale.addEventListener('drop', (e) => {
    e.preventDefault();
    depot.classList.remove('survol');
    ajouterPiecesBug([...(e.dataTransfer?.files ?? [])]);
  });

  $('#bug-vignettes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-retirer]');
    if (!b) return;
    bug.pieces.splice(Number(b.dataset.retirer), 1);
    dessinerPiecesBug();
  });
}

// ------------------------------------------------------------------- démarrage

$('#entree-connecteurs').addEventListener('click', () => {
  etat.selection = CONNECTEURS;
  dessinerRail();
  dessinerConnecteurs();
});

$('#entree-accueil').addEventListener('click', () => {
  etat.selection = ACCUEIL;
  dessinerRail();
  dessinerAccueil();
});

$('#entree-activite').addEventListener('click', () => {
  etat.selection = ACTIVITE;
  dessinerRail();
  dessinerActivitePage();
  chargerActivite();
});

brancherRail();
brancherDetail();
brancherActivite();
brancherTiroir();
brancherModales();
brancherSignalement();

await rafraichirEtat();
await chargerModules();
await chargerJournal();
await chargerSante();
await chargerConnecteurs();
brancherFluxJournal();
// D'abord ce qu'on vient d'installer, ensuite ce qui est disponible : les deux
// partagent la même fenêtre, et « Quoi de neuf » suit tout juste un redémarrage.
await montrerNouveautes();
verifierMaj();

// L'état général bouge sans qu'on y touche (chat qui se reconnecte, module qui
// tombe) : on le rafraîchit régulièrement, c'est peu coûteux en local.
let cycleEnCours = false;

async function cycleRafraichissement() {
  if (cycleEnCours) return; // un tour lent ne doit pas être doublé par le suivant
  cycleEnCours = true;
  try {
    await rafraichirEtat();
    const avant = JSON.stringify(etat.modules.map((m) => [m.id, m.etat, m.actif]));
    etat.modules = await api('/api/modules');
    if (JSON.stringify(etat.modules.map((m) => [m.id, m.etat, m.actif])) !== avant) {
      dessinerRail();
      dessinerDetail();
    }
    await chargerSante();
    await chargerConnecteurs();
    // Le jour en cours se remplit pendant le live ; un jour passe ne bouge plus.
    if (etat.selection === ACTIVITE && !vueActivite.jour) await chargerActivite();
  } catch {
    /* StreamKit ne répond pas : rafraichirEtat l'affiche déjà, on réessaiera */
  } finally {
    cycleEnCours = false;
  }
}

setInterval(() => {
  // Fermer la fenêtre ne quitte pas StreamKit : elle est simplement masquée, et
  // la page continue de tourner. Interroger Spotify et Riot pour un écran que
  // personne n'a sous les yeux n'a aucun intérêt — le streamer, lui, est en
  // train de jouer.
  if (document.hidden) return;
  cycleRafraichissement();
}, 5000);

// De retour sur la fenêtre : on remet tout à jour immédiatement, sans attendre
// le prochain tour.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) cycleRafraichissement();
});

// StreamKit reste ouvert des jours d'affilée chez un streamer. Sans cette
// revérification, une nouvelle version ne serait vue qu'au prochain démarrage
// de l'application — c'est-à-dire rarement.
setInterval(verifierMaj, 30 * 60 * 1000);
