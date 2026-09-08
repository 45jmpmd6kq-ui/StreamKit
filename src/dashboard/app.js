// Dashboard StreamKit — logique de la page.
//
// Aucune dépendance, aucun build : le fichier est servi tel quel. Le streamer
// n'installe rien, et une mise à jour ne demande pas de recompiler quoi que ce
// soit.

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const etat = {
  modules: [],
  selection: null,
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
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

async function copier(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    toast('Copié ✓');
  } catch {
    toast('Copie impossible — sélectionne le texte à la main', true);
  }
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
  $('#url-retour').textContent = 'http://localhost:' + g.port + '/callback/twitch';
  $('#in-depot').value = g.depotMaj || '';
  if (g.chaine) $('#in-channel').value = g.chaine;

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

async function verifierMaj() {
  let info;
  try {
    info = await api('/api/maj/verifier', { method: 'POST' });
  } catch {
    return;
  }
  const btn = $('#btn-maj');
  if (info.ok && info.dispo) {
    btn.hidden = false;
    btn.className = 'btn petit primaire';
    btn.textContent = 'Mettre à jour → ' + info.derniere;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Mise à jour…';
      try {
        const r = await api('/api/maj/appliquer', { method: 'POST' });
        if (r.ok) toast('StreamKit redémarre avec la version ' + r.derniere);
        else toast(r.raison || 'Mise à jour impossible', true);
      } catch (e) {
        toast(e.message, true);
      }
    };
  } else {
    btn.hidden = true;
  }
}

// ------------------------------------------------------------------- les modules

async function chargerModules() {
  etat.modules = await api('/api/modules');
  if (!etat.selection && etat.modules.length) etat.selection = etat.modules[0].id;
  dessinerRail();
  dessinerDetail();
  remplirFiltreSources();
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
function grouperParCategorie() {
  const groupes = new Map();
  for (const m of etat.modules) {
    const c = m.categorie ?? { id: 'outils', label: 'Outils', icone: '🧰', ordre: 90 };
    if (!groupes.has(c.id)) groupes.set(c.id, { categorie: c, modules: [] });
    groupes.get(c.id).modules.push(m);
  }
  return [...groupes.values()].sort((a, b) => a.categorie.ordre - b.categorie.ordre);
}

function dessinerRail() {
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
              </button>`
              )
              .join('')}
          </div>
        </div>`;
    })
    .join('');

  $$('[data-module]').forEach((b) =>
    b.addEventListener('click', () => {
      etat.selection = b.dataset.module;
      dessinerRail();
      dessinerDetail();
    })
  );

  $$('[data-categorie]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.categorie;
      if (replis.has(id)) replis.delete(id);
      else replis.add(id);
      ecrireReplis(replis);
      dessinerRail();
    })
  );
}

function dessinerDetail() {
  const m = etat.modules.find((x) => x.id === etat.selection);
  const cible = $('#detail');

  if (!m) {
    cible.innerHTML = '<div class="vide">Aucun module installé.</div>';
    $('#pied-detail').hidden = true;
    return;
  }

  const twitchKo = m.scopes.length && !etat.general?.twitch?.pret;
  const droitsManquants = (m.scopes || []).filter((s) => !(etat.general?.twitch?.scopes || []).includes(s));

  cible.innerHTML = `
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

    ${m.champs.length ? `<div class="section"><h3>Réglages</h3><div id="formulaire"></div></div>` : ''}

    ${
      m.overlays.length
        ? `<div class="section"><h3>Overlays OBS</h3>
             <p style="color:var(--texte-doux);font-size:.9rem;margin:-.35rem 0 .85rem">
               Dans OBS : <b>Sources ▸ + ▸ Navigateur</b>, puis colle l'adresse.
               Ajoute <code>?demo=1</code> pour placer la source, et retire-le ensuite.
             </p>
             ${m.overlays
               .map(
                 (o) => `<div class="overlay-ligne">
                    <div class="infos">
                      <div class="nom">${echapper(o.nom)}</div>
                      <code>http://127.0.0.1:${etat.general?.port ?? 4455}${o.url}</code>
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
    </div>`;

  // Un module sans réglage n'a rien à enregistrer : pas de pied inutile.
  if (m.champs.length) dessinerFormulaire(m);
  else $('#pied-detail').hidden = true;

  $('#bascule-module').addEventListener('click', () => basculerModule(m));
  $('#btn-redemarrer').addEventListener('click', async () => {
    await api(`/api/modules/${m.id}/redemarrer`, { method: 'POST' });
    toast('Module redémarré');
    chargerModules();
  });
  $$('[data-copier-url]').forEach((b) =>
    b.addEventListener('click', () =>
      copier('http://127.0.0.1:' + (etat.general?.port ?? 4455) + b.dataset.copierUrl)
    )
  );

  // Actions déclarées par le module (« Connecter Spotify », « Tester »…).
  $$('[data-action]').forEach((b) =>
    b.addEventListener('click', async () => {
      const retour = $('#retour-action');
      b.disabled = true;
      retour.className = 'etat-sauvegarde';
      retour.textContent = 'En cours…';
      try {
        const r = await api(`/api/modules/${m.id}/action/${b.dataset.action}`, { method: 'POST', corps: {} });
        retour.className = 'etat-sauvegarde ok';
        retour.textContent = r.message || 'Fait ✓';
        await chargerModules();
      } catch (e) {
        retour.className = 'etat-sauvegarde ko';
        retour.textContent = e.data?.erreur || e.message;
      } finally {
        b.disabled = false;
      }
    })
  );
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
  let saisie = '';

  switch (c.type) {
    case 'bool':
      saisie = `<button class="bascule" role="switch" aria-checked="${!!valeur}" data-cle="${c.cle}"></button>`;
      break;
    case 'nombre':
      saisie = `<input type="number" id="${id}" data-cle="${c.cle}" value="${valeur ?? 0}"
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
                  <input type="color" value="${valeur || '#ffffff'}" data-couleur="${c.cle}" />
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

function dessinerFormulaire(m) {
  $('#formulaire').innerHTML = m.champs.map((c) => dessinerChamp(c, m.reglages[c.cle])).join('');

  // Le bouton d'enregistrement vit dans le pied fixe du panneau, hors du
  // contenu défilant. On remplace son gestionnaire à chaque module affiché —
  // `onclick` et pas addEventListener, sinon ils s'empileraient à chaque clic
  // dans le rail et une sauvegarde en déclencherait plusieurs.
  $('#pied-detail').hidden = false;
  $('#etat-sauvegarde').textContent = '';
  $('#etat-sauvegarde').className = 'etat-sauvegarde';
  $('#btn-sauver').onclick = () => sauverReglages(m);

  // Les interrupteurs du formulaire.
  $$('#formulaire .bascule').forEach((b) =>
    b.addEventListener('click', () => b.setAttribute('aria-checked', b.getAttribute('aria-checked') !== 'true'))
  );

  // Le sélecteur de couleur et son champ texte restent synchronisés.
  $$('[data-couleur]').forEach((picker) => {
    const texte = $(`[data-cle="${picker.dataset.couleur}"]`);
    picker.addEventListener('input', () => (texte.value = picker.value));
    texte.addEventListener('input', () => {
      if (/^#[0-9a-f]{6}$/i.test(texte.value)) picker.value = texte.value;
    });
  });

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
  if (etat.erreurs) $('#compteur-erreurs').textContent = etat.erreurs + ' erreur' + (etat.erreurs > 1 ? 's' : '');
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

  $('#bascule-tiroir').addEventListener('click', () => {
    const replie = tiroir.classList.toggle('replie');
    $('#fleche').textContent = replie ? '▲' : '▼';
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

// ------------------------------------------------------------ assistant Twitch

function brancherModales() {
  const mT = $('#modale-twitch');
  const mR = $('#modale-reglages');

  $('#etat-twitch').addEventListener('click', () => mT.showModal());
  $('#btn-fermer-twitch').addEventListener('click', () => mT.close());
  $('#btn-reglages').addEventListener('click', () => mR.showModal());
  $('#btn-fermer-reglages').addEventListener('click', () => mR.close());

  $$('[data-copier]').forEach((b) =>
    b.addEventListener('click', () => copier($('#' + b.dataset.copier).textContent))
  );

  $('#btn-autoriser').addEventListener('click', async () => {
    const channel = $('#in-channel').value.trim();
    const clientId = $('#in-client-id').value.trim();
    const clientSecret = $('#in-client-secret').value.trim();

    if (!channel) return toast('Indique le nom de ta chaîne', true);
    if (!clientId || !clientSecret) return toast('ID client et secret client sont nécessaires', true);

    try {
      await api('/api/twitch/chaine', { method: 'POST', corps: { channel } });
      await api('/api/twitch/app', { method: 'POST', corps: { clientId, clientSecret } });
      const r = await api('/api/twitch/autoriser', { method: 'POST' });
      if (!r.ok) return toast(r.conseil || r.erreur || 'Autorisation impossible', true);

      $('#info-autorisation').hidden = false;
      // Le navigateur s'ouvre côté serveur ; on laisse un lien de secours.
      if (r.url) window.open(r.url, '_blank');
    } catch (e) {
      toast(e.message, true);
    }
  });

  $('#in-demarrage-auto').addEventListener('click', (e) => {
    const b = e.currentTarget;
    b.setAttribute('aria-checked', b.getAttribute('aria-checked') !== 'true');
  });

  $('#btn-sauver-reglages').addEventListener('click', async () => {
    // Le dépôt de mise à jour passe par la même route que la config générale.
    try {
      const corps = { depotMaj: $('#in-depot').value.trim() };
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

// ------------------------------------------------------------------- démarrage

brancherTiroir();
brancherModales();

await rafraichirEtat();
await chargerModules();
await chargerJournal();
brancherFluxJournal();
verifierMaj();

// L'état général bouge sans qu'on y touche (chat qui se reconnecte, module qui
// tombe) : on le rafraîchit régulièrement, c'est peu coûteux en local.
setInterval(async () => {
  await rafraichirEtat();
  const avant = JSON.stringify(etat.modules.map((m) => [m.id, m.etat, m.actif]));
  etat.modules = await api('/api/modules');
  if (JSON.stringify(etat.modules.map((m) => [m.id, m.etat, m.actif])) !== avant) {
    dessinerRail();
    dessinerDetail();
  }
}, 5000);
