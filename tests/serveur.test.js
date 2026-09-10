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
    get: (id) =>
      ['musique', 'roue-rl'].includes(id) ? { id, dossier: id, manifeste: { overlays: [] } } : undefined,
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
        res.on('end', () => resolve({ code: res.statusCode, corps: b }));
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

// --- Page de retour OAuth : pas de script injecte -------------------------

test('un refus OAuth ne peut pas injecter de script dans la page de retour', async () => {
  // La page est servie sur NOTRE origine : un script qui s'y execute a le
  // meme acces a l'API que le dashboard lui-meme.
  const { pageRetour } = await import('../src/core/auth.js');
  const html = pageRetour({ ok: false, message: '<img src=x onerror=alert(1)>' });

  assert.ok(!html.includes('<img'), 'la balise est passee telle quelle');
  assert.ok(html.includes('&lt;img'), 'le message doit apparaitre, mais echappe');
});
