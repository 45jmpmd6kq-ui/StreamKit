// Le serveur local est la surface d'attaque de StreamKit : il a les jetons du
// streamer derriere lui, et tourne sur une machine ou un navigateur est
// toujours ouvert. Les trois protections testees ici correspondent chacune a
// une faille qui a REELLEMENT ete exploitable sur une version precedente.
//
// On parle au serveur en HTTP brut (node:http) et non avec fetch : c'est le
// seul moyen de fabriquer un en-tete Host arbitraire, ce que fait justement
// une attaque par rebinding DNS.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { creerServeur, ecouter } = await import('../src/core/serveur.js');
const { preparerDossiers } = await import('../src/core/paths.js');
const { default: suiviLoL } = await import('../src/modules/lol-session/module.js');

preparerDossiers();

const PORT = 45455;

// Le minimum dont le routeur a besoin. On ne teste pas la logique metier ici,
// seulement qui a le droit d'y acceder.
const app = {
  port: PORT,
  registre: {
    // Des modules REELS, pour que les routes /overlay et /module aboutissent
    // quelque part : sans vrai dossier sur le disque, ni la traversee ni le
    // dossier-servi-comme-fichier ne voudraient dire quoi que ce soit.
    // roue-rl porte overlay/cars/, le dossier des 137 icones de voitures.
    get: (id) => {
      // Le suivi LoL avec ses vrais overlays : deux adresses pour une page, et
      // une ancienne adresse masquee.
      if (id === 'lol-session') return { id, dossier: id, manifeste: { overlays: suiviLoL.overlays } };
      if (!['musique', 'roue-rl'].includes(id)) return undefined;
      // roue-rl declare son vrai overlay : c'est lui qui porte un <script>
      // inline, donc lui qui a besoin d'un nonce.
      const overlays = id === 'roue-rl' ? [{ chemin: 'roue', fichier: 'roue.html' }] : [];
      return { id, dossier: id, manifeste: { overlays } };
    },
    vue: () => null,
    vues: () => [],
  },
  etatGeneral: () => ({ version: 'test', port: PORT }),
  definirReglagesGeneraux: async () => ({ ok: true }),
};

let serveur;

before(async () => {
  serveur = creerServeur(app);
  await ecouter(serveur, PORT);
});

after(() => {
  serveur.close();
  serveur.jumeauIPv6?.close();
  nettoyer(DONNEES);
});

// Requete HTTP brute : on maitrise chaque en-tete, Host compris.
function requete({ methode = 'GET', chemin = '/', entetes = {}, corps, hote = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: hote, port: PORT, path: chemin, method: methode, headers: entetes },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ code: res.statusCode, corps: b, entetes: res.headers }));
      }
    );
    r.on('error', reject);
    if (corps) r.write(corps);
    r.end();
  });
}

// --- CSRF : une page web quelconque ne doit rien pouvoir declencher --------

test('un POST venu d une autre origine est refuse', async () => {
  // Le scenario exact qui reecrivait les identifiants Twitch : un onglet
  // ouvert sur un site tiers pendant que StreamKit tourne.
  const r = await requete({
    methode: 'POST',
    chemin: '/api/reglages',
    entetes: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    corps: '{}',
  });
  assert.equal(r.code, 403);
});

test('meme un GET venu d une autre origine est refuse', async () => {
  const r = await requete({ chemin: '/api/etat', entetes: { Origin: 'https://evil.example' } });
  assert.equal(r.code, 403);
});

test('une origine « null » (iframe bac a sable) est refusee', async () => {
  const r = await requete({ chemin: '/api/etat', entetes: { Origin: 'null' } });
  assert.equal(r.code, 403);
});

test('un type de contenu « simple » ne passe pas le corps JSON', async () => {
  // text/plain est l'un des trois types qu'une page peut envoyer sans
  // preflight CORS. Le refuser sort nos requetes du lot des requetes simples.
  const r = await requete({
    methode: 'POST',
    chemin: '/api/reglages',
    entetes: { 'Content-Type': 'text/plain' },
    corps: '{"depotMaj":"attaquant/depot"}',
  });
  assert.notEqual(r.code, 200);
});

// --- Rebinding DNS : un domaine qui resout vers 127.0.0.1 -----------------

test('un en-tete Host inconnu est refuse', async () => {
  const r = await requete({ chemin: '/api/etat', entetes: { Host: 'evil.example' } });
  assert.equal(r.code, 403);
});

test('un Host local mais sur un autre port est refuse', async () => {
  // Un attaquant qui devine le nom d'hote ne doit pas s'en tirer avec un port
  // approximatif.
  const r = await requete({ chemin: '/api/etat', entetes: { Host: '127.0.0.1:1234' } });
  assert.equal(r.code, 403);
});

// --- Ce qui doit continuer de marcher -------------------------------------
// Un garde-fou qui bloque le dashboard serait pire que le mal.

test('le dashboard parle a son API sans etre gene', async () => {
  for (const hote of ['127.0.0.1', 'localhost', '[::1]']) {
    const r = await requete({
      chemin: '/api/etat',
      entetes: { Host: hote + ':' + PORT, Origin: 'http://' + hote + ':' + PORT },
    });
    assert.equal(r.code, 200, 'refuse depuis ' + hote);
  }
});

test('le serveur repond aussi sur la boucle IPv6', async () => {
  // « localhost » se resout souvent en ::1 d'abord sous Windows, et Twitch
  // impose « localhost » dans son URL de retour OAuth.
  const r = await requete({ hote: '::1', chemin: '/api/etat', entetes: { Host: '[::1]:' + PORT } });
  assert.equal(r.code, 200);
});

test('un POST du dashboard passe', async () => {
  const r = await requete({
    methode: 'POST',
    chemin: '/api/reglages',
    entetes: { Origin: 'http://127.0.0.1:' + PORT, 'Content-Type': 'application/json' },
    corps: '{}',
  });
  assert.equal(r.code, 200);
});

test('un retour OAuth, qui arrive sans Origin, passe', async () => {
  // Twitch et Spotify renvoient le navigateur par une navigation directe :
  // aucun en-tete Origin. Les refuser casserait toute autorisation.
  const r = await requete({ chemin: '/api/etat' });
  assert.equal(r.code, 200);
});

// --- Fetch Metadata : ce que le navigateur dit de la provenance ------------
// Les en-tetes sont ceux qu'envoie reellement Chromium (et le CEF d'OBS) dans
// chaque situation.

const IMAGE_TIERCE = {
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Dest': 'image',
};

test('une balise <img> posee sur un site tiers est refusee', async () => {
  // Le vecteur de S1 : une requete d'image ne porte pas d'Origin et son Host
  // est legitime, elle passait donc les deux autres gardes.
  const r = await requete({ chemin: '/overlay/roue-rl/roue', entetes: IMAGE_TIERCE });
  assert.equal(r.code, 403);
});

test('un <script src> tiers ne peut pas charger l API', async () => {
  const r = await requete({
    chemin: '/api/etat',
    entetes: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Dest': 'script' },
  });
  assert.equal(r.code, 403);
});

test('une autre application sur localhost est refusee aussi', async () => {
  // localhost:3000 et localhost:4455 sont « same-site » : meme nom, autre port.
  const r = await requete({
    chemin: '/api/journal',
    entetes: { 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Dest': 'empty' },
  });
  assert.equal(r.code, 403);
});

test('une page tierce ne peut pas encadrer StreamKit dans une iframe', async () => {
  const r = await requete({
    chemin: '/',
    entetes: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe' },
  });
  assert.equal(r.code, 403);
});

test('un formulaire tiers qui POST en navigation est refuse', async () => {
  // Une navigation, oui, mais qui envoie des donnees : seul le GET passe.
  const r = await requete({
    methode: 'POST',
    chemin: '/api/maj/appliquer',
    entetes: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
  });
  assert.equal(r.code, 403);
});

test('une valeur de Sec-Fetch-Site inconnue n ouvre pas de breche', async () => {
  const r = await requete({ chemin: '/api/etat', entetes: { 'Sec-Fetch-Site': 'n-importe-quoi' } });
  assert.equal(r.code, 403);
});

test('le retour de Twitch ou de Spotify, venu de leur site, passe', async () => {
  // LE cas a ne pas casser : sans lui, plus aucune connexion de compte.
  // Le navigateur arrive de id.twitch.tv ou accounts.spotify.com : cross-site,
  // mais navigation de page entiere.
  const r = await requete({
    chemin: '/api/etat', // la route importe peu : c'est la provenance qui est jugee
    entetes: {
      Host: 'localhost:' + PORT,
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-User': '?1',
    },
  });
  assert.equal(r.code, 200);
});

test('ce que fait le streamer lui-meme passe', async () => {
  const cas = {
    'URL collee dans OBS ou la barre d adresse': {
      chemin: '/overlay/roue-rl/roue',
      entetes: { 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
    },
    'overlay qui charge son image': {
      chemin: '/style.css',
      entetes: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Dest': 'style' },
    },
    'dashboard qui interroge son API': {
      chemin: '/api/etat',
      entetes: {
        Origin: 'http://127.0.0.1:' + PORT,
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
      },
    },
  };
  for (const [quoi, { chemin, entetes }] of Object.entries(cas)) {
    const r = await requete({ chemin, entetes });
    assert.equal(r.code, 200, 'refuse a tort : ' + quoi);
  }
});

// --- Traversee de dossier -------------------------------------------------

test('on ne sort pas du dossier d un module par ../', async () => {
  for (const suffixe of ['..%2F..%2F..%2Fpackage.json', '..%5C..%5C..%5Cpackage.json']) {
    const r = await requete({ chemin: '/overlay/musique/annonces/' + suffixe });
    assert.equal(r.code, 403, 'chemin non bloque : ' + suffixe);
    assert.ok(!r.corps.includes('"name"'), 'du contenu a fuite');
  }
});

// --- Ce qui tuait StreamKit a distance ------------------------------------

test('un dossier demande comme un fichier repond 404, sans exception', { timeout: 5000 }, async () => {
  // Le scenario, tel qu'il a ete reproduit : une balise
  // <img src="http://127.0.0.1:4455/overlay/roue-rl/roue/cars"> posee sur
  // n'importe quel site ouvert par le streamer. Une requete d'image n'envoie
  // pas d'en-tete Origin et son Host est legitime : les deux gardes laissent
  // passer. createReadStream sur un DOSSIER emettait alors EISDIR sans
  // gestionnaire d'erreur -- exception non rattrapee, et sous Electron
  // l'application entiere mourait : icone, bot, overlays, en plein live.
  //
  // Si la regression revenait, ce test ne verrait pas un code inattendu : il
  // EXPIRERAIT, parce que la reponse ne partait jamais. D'ou le delai explicite.
  const r = await requete({ chemin: '/overlay/roue-rl/roue/cars' });
  assert.equal(r.code, 404);
});

test('une URL mal encodee repond 400 au lieu de rester pendue', { timeout: 5000 }, async () => {
  // « %E0%A4%A » est une sequence percent tronquee : decodeURIComponent leve
  // URIError. Le decodage se faisait hors du try du handler, et comme celui-ci
  // est async, le rejet partait dans le vide -- aucune reponse, connexion
  // ouverte jusqu'au delai du navigateur.
  const r = await requete({ chemin: '/overlay/%E0%A4%A' });
  assert.equal(r.code, 400);
});

// --- Content-Security-Policy ----------------------------------------------
// Seconde barriere : le dashboard, les overlays et l'API partagent une origine,
// et les jetons du streamer sont derriere.

test('le dashboard est servi avec une CSP et un nonce de script', async () => {
  const r = await requete({ chemin: '/' });
  const politique = r.entetes['content-security-policy'] ?? '';

  assert.match(politique, /script-src 'self' 'nonce-[^']+'/, 'script-src doit porter un nonce');
  assert.doesNotMatch(
    politique,
    /script-src[^;]*unsafe-inline/,
    "script-src ne doit pas etre 'unsafe-inline'"
  );
  assert.match(politique, /object-src 'none'/);
  assert.match(politique, /frame-ancestors 'none'/);
  assert.match(politique, /base-uri 'none'/);
  assert.equal(r.entetes['x-content-type-options'], 'nosniff');

  // Le nonce doit REELLEMENT etre pose sur la balise, sinon la CSP bloquerait
  // le dashboard au lieu de le proteger.
  const [, nonce] = politique.match(/'nonce-([^']+)'/);
  assert.ok(r.corps.includes('nonce="' + nonce + '"'), 'la balise script doit porter le meme nonce');
});

test('les pochettes Spotify sont autorisees, pas n importe quelle image', async () => {
  // Le bot musique affiche la pochette de l'album en cours, servie par Spotify.
  // Une image ne s'execute pas, mais une balise <img> vers un serveur tiers
  // suffit a faire sortir une information : on n'ouvre que les hotes utiles.
  // La politique est la meme pour tous les overlays.
  const r = await requete({ chemin: '/overlay/roue-rl/roue' });
  const imgSrc =
    (r.entetes['content-security-policy'] ?? '')
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('img-src')) ?? '';

  assert.match(imgSrc, /\shttps:\/\/i\.scdn\.co(\s|$)/);
  assert.match(imgSrc, /\shttps:\/\/\*\.spotifycdn\.com(\s|$)/);
  assert.match(imgSrc, /\shttps:\/\/ddragon\.leagueoflegends\.com(\s|$)/);
  assert.doesNotMatch(imgSrc, /\s(https:|\*)(\s|$)/, 'img-src ne doit pas ouvrir toutes les images');
});

test('un overlay recoit un nonce, different a chaque chargement', async () => {
  // Un nonce rejoue serait un nonce inutile : une page qui a vu le precedent
  // pourrait s'en servir au chargement suivant.
  const premier = await requete({ chemin: '/overlay/roue-rl/roue' });
  const second = await requete({ chemin: '/overlay/roue-rl/roue' });

  assert.equal(premier.code, 200);
  const n1 = premier.entetes['content-security-policy'].match(/'nonce-([^']+)'/)[1];
  const n2 = second.entetes['content-security-policy'].match(/'nonce-([^']+)'/)[1];

  assert.notEqual(n1, n2, 'deux chargements ne doivent pas partager le meme nonce');
  assert.ok(premier.corps.includes('<script nonce="' + n1 + '">'), 'le script inline doit etre autorise');
});

test('deux sources pour une page, et l ancienne adresse toujours servie', async () => {
  // Le suivi de session LoL : /bandeau et /tableau servent la meme page, qui lit
  // son adresse ; /session, l'ancienne source unique, masquee du dashboard,
  // repond encore. Une vue inconnue, non.
  for (const vue of ['bandeau', 'tableau', 'session']) {
    const r = await requete({ chemin: '/overlay/lol-session/' + vue });
    assert.equal(r.code, 200, vue);
    assert.ok(r.corps.includes('document.body.dataset.vue = VUE'), vue);
  }
  assert.equal((await requete({ chemin: '/overlay/lol-session/autre' })).code, 404);
});

test('un fichier statique porte une CSP sans nonce et nosniff', async () => {
  const r = await requete({ chemin: '/style.css' });
  assert.equal(r.code, 200);
  assert.match(r.entetes['content-security-policy'], /script-src 'self'/);
  assert.doesNotMatch(r.entetes['content-security-policy'], /nonce-/);
  assert.equal(r.entetes['x-content-type-options'], 'nosniff');
});

// --- Page de retour OAuth : pas de script injecte -------------------------

test('un refus OAuth ne peut pas injecter de script dans la page de retour', async () => {
  // La page est servie sur NOTRE origine : un script qui s'y execute a le
  // meme acces a l'API que le dashboard lui-meme.
  const { pageRetour } = await import('../src/core/auth.js');
  const html = pageRetour({ ok: false, message: '<img src=x onerror=alert(1)>' });

  assert.ok(!html.includes('<img'), 'la balise est passee telle quelle');
  assert.ok(html.includes('&lt;img'), 'le message doit apparaitre, mais echappe');
});
