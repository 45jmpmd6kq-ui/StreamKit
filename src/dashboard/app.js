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

// GitHub renvoie les notes de release en HTML : « <p>fix update</p> ». Affichées
// telles quelles, les balises se voient. On les convertit en texte plutôt que de
// les injecter en innerHTML — ce texte vient d'une page web, il n'a rien à faire
// dans le DOM de l'application.
function notesEnTexte(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    // Entités que GitHub produit couramment dans les messages de commit.
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ouvrirModaleMaj(info) {
  $('#maj-avant').textContent = info.actuelle;
  $('#maj-apres').textContent = info.derniere;

  const notes = $('#maj-notes');
  const texte = notesEnTexte(info.notes);
  notes.hidden = !texte;
  notes.textContent = texte;

  // Un module démarré = quelque chose tourne peut-être en direct. On ne bloque
  // pas, on prévient : c'est au streamer de juger.
  $('#maj-en-live').hidden = !(etat.general?.modules?.demarres > 0);

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

// --- Vue d'ensemble ---------------------------------------------------------

const ICONE_ETAT = { ok: '●', attention: '▲', ko: '✕', inactif: '○' };

function dessinerAccueil() {
  const s = etat.sante;
  const cible = $('#detail');
  $('#pied-detail').hidden = true;

  if (!s) {
    cible.innerHTML = '<div class="vide">Lecture de l’état des connexions…</div>';
    return;
  }

  // « Tout est en ordre » ne doit pas s'afficher alors qu'une connexion n'est
  // même pas configurée. Une connexion inactive n'est pas une panne pour autant :
  // un streamer qui n'utilise que Valorant n'a aucun besoin de Twitch.
  const soucis = s.connexions.filter((c) => c.etat === 'ko' || c.etat === 'attention').length;
  const inactifs = s.connexions.filter((c) => c.etat === 'inactif').length;
  const resume = soucis
    ? soucis + ' point' + (soucis > 1 ? 's' : '') + ' à regarder avant de lancer ton live.'
    : inactifs
      ? 'Rien de cassé — ' + inactifs + ' connexion' + (inactifs > 1 ? 's' : '') +
        ' pas encore configurée' + (inactifs > 1 ? 's' : '') + '.'
      : 'Tout est en ordre. Bon stream.';

  cible.innerHTML =
    '<div class="titre-module"><span style="font-size:1.6rem">📡</span>' +
    '<h1>Vue d’ensemble</h1></div>' +
    '<p class="resume-accueil">' + echapper(resume) + '</p>' +
    '<div class="cartes">' +
    s.connexions
      .map(
        (c) => `
        <div class="carte ${c.etat}">
          <div class="entete">
            <span class="point ${c.etat === 'ok' ? 'ok' : c.etat === 'ko' ? 'ko' : c.etat === 'attention' ? 'attente' : ''}"></span>
            <span class="nom">${echapper(c.nom)}</span>
            ${c.module ? `<span class="provenance">${echapper(c.module)}</span>` : ''}
          </div>
          <div class="detail">${echapper(c.detail || '')}</div>
          ${c.aide ? `<div class="aide">${echapper(c.aide)}</div>` : ''}
        </div>`
      )
      .join('') +
    '</div>' +
    dessinerKpis(s) +
    '<div class="section"><h3>Modules</h3>' +
    '<p style="color:var(--texte-doux);margin:0">' +
    s.modules.demarres + ' démarré(s) sur ' + s.modules.total +
    (s.modules.enErreur ? ' — ' + s.modules.enErreur + ' à compléter ou en erreur' : '') +
    '</p></div>';
}

// Le gros chiffre est celui de la SESSION — ce qui s'est passé depuis que
// StreamKit tourne, donc en pratique ce live. Le total en dessous lui donne son
// échelle : « 12 » ne veut rien dire sans savoir si on en est à 15 ou à 900.
function dessinerKpis(s) {
  const blocs = (s.kpis || []).filter((k) => k.valeurs.length);
  if (!blocs.length) return '';

  // Dire d'où partent les compteurs, sinon un « 12 » ne veut rien dire. Deux
  // origines possibles : le début du live si Twitch en signale un, sinon le
  // lancement de StreamKit.
  const depuis = s.depuis ? new Date(s.depuis) : null;
  const p = (n) => String(n).padStart(2, '0');
  const heure = depuis ? p(depuis.getHours()) + ':' + p(depuis.getMinutes()) : '—';

  let titre;
  if (s.causeSession === 'live') {
    titre = s.enDirect
      ? 'Ce live — en direct depuis ' + heure
      : 'Dernier live — commencé à ' + heure;
  } else {
    titre = 'Depuis le lancement de StreamKit, ' + heure;
  }

  return (
    '<div class="section"><h3>Utilisation · ' + echapper(titre) + '</h3>' +
    blocs
      .map(
        (k) => `
        <div class="kpi-module">
          <div class="kpi-titre">
            <span>${k.icone}</span>
            <span>${echapper(k.module)}</span>
            ${k.actif ? '' : '<span class="kpi-repos">au repos</span>'}
          </div>
          <div class="kpi-valeurs">
            ${k.valeurs
              .map(
                (v) => `
              <div class="kpi">
                <div class="kpi-chiffre">${v.session}</div>
                <div class="kpi-label">${echapper(v.label)}</div>
                <div class="kpi-total">${v.total} au total</div>
              </div>`
              )
              .join('')}
          </div>
        </div>`
      )
      .join('') +
    '</div>'
  );
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
  const cible = $('#detail');
  $('#pied-detail').hidden = true;

  const liste = etat.connecteurs;
  if (!liste) {
    cible.innerHTML = '<div class="vide">Lecture des connecteurs…</div>';
    return;
  }

  cible.innerHTML =
    '<div class="titre-module"><span style="font-size:1.6rem">🔌</span><h1>Connecteurs</h1></div>' +
    '<p class="resume-accueil">Chaque service se configure ici, une seule fois. ' +
    'Les modules qui en ont besoin y puisent tout seuls.</p>' +
    liste.map(carteConnecteur).join('');

  brancherConnecteurs();
}

function carteConnecteur(c) {
  const ouvert = deplies.has(c.id);
  const pastille = c.etat === 'ok' ? 'ok' : c.etat === 'ko' ? 'ko' : c.etat === 'attention' ? 'attente' : '';

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
          <div class="saisie"><input type="text" id="cid-${c.id}" autocomplete="off" spellcheck="false"
            placeholder="${c.configure ? '••••••••  (déjà enregistré)' : ''}" /></div>
        </div>
        <div class="champ large">
          <label for="csec-${c.id}">Secret client</label>
          <div class="aide">Reste sur ce PC, dans un fichier que tu ne partages jamais.</div>
          <div class="saisie"><input type="password" id="csec-${c.id}" autocomplete="off" spellcheck="false"
            placeholder="${c.configure ? '••••••••  (déjà enregistré)' : ''}" /></div>
        </div>

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

function brancherConnecteurs() {
  $$('[data-conn]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.conn;
      if (deplies.has(id)) deplies.delete(id);
      else deplies.add(id);
      dessinerConnecteurs();
    })
  );

  $$('[data-copier-conn]').forEach((b) =>
    b.addEventListener('click', () => {
      const c = etat.connecteurs.find((x) => x.id === b.dataset.copierConn);
      copier(c.urlDeRetour);
    })
  );

  const retour = (id, texte, ko = false) => {
    const el = $('#retour-' + id);
    if (!el) return;
    el.className = 'etat-sauvegarde ' + (ko ? 'ko' : 'ok');
    el.textContent = texte;
  };

  $$('[data-enregistrer-conn]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.enregistrerConn;
      const clientId = $('#cid-' + id).value.trim();
      const clientSecret = $('#csec-' + id).value.trim();
      if (!clientId || !clientSecret) return retour(id, 'ID et secret sont nécessaires', true);
      try {
        if (id === 'twitch') {
          const chaine = $('#cid-chaine')?.value.trim();
          if (chaine) await api('/api/connecteurs/twitch/chaine', { method: 'POST', corps: { channel: chaine } });
        }
        const r = await api('/api/connecteurs/' + id + '/app', { method: 'POST', corps: { clientId, clientSecret } });
        if (r.ok === false) return retour(id, r.erreur || 'refusé', true);
        retour(id, 'Enregistré — clique sur « Connecter »');
        await chargerConnecteurs();
      } catch (e) {
        retour(id, e.message, true);
      }
    })
  );

  $$('[data-autoriser-conn]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.autoriserConn;
      try {
        const r = await api('/api/connecteurs/' + id + '/autoriser', { method: 'POST' });
        if (r.ok === false) return retour(id, r.erreur || r.conseil || 'autorisation impossible', true);
        retour(id, 'Autorise StreamKit dans la page qui vient de s’ouvrir…');
        if (r.url) window.open(r.url, '_blank');
      } catch (e) {
        retour(id, e.message, true);
      }
    })
  );

  $$('[data-deconnecter-conn]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.deconnecterConn;
      await api('/api/connecteurs/' + id + '/deconnecter', { method: 'POST' });
      await chargerConnecteurs();
      await chargerModules();
    })
  );
}

async function chargerConnecteurs() {
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
  if (etat.selection === CONNECTEURS) dessinerConnecteurs();
}

// --- Détail d'un module -----------------------------------------------------

function dessinerDetail() {
  if (etat.selection === ACCUEIL) return dessinerAccueil();
  if (etat.selection === CONNECTEURS) return dessinerConnecteurs();

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
    // Le dépôt de mise à jour passe par la même route que la config générale.
    try {
      // Le depot des mises a jour n'est plus un reglage : sous Electron il est
      // embarque a la compilation (build.publish), et le champ n'avait aucun
      // effet. Il ne restait qu'a le faire croire au streamer.
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

brancherTiroir();
brancherModales();

await rafraichirEtat();
await chargerModules();
await chargerJournal();
await chargerSante();
await chargerConnecteurs();
brancherFluxJournal();
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
