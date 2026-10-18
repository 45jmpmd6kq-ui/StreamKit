// Themes d'overlay (core/themes.js, src/commun/themes/).
//
// La promesse a tenir : « Standard esport » rend chaque overlay EXACTEMENT
// comme avant les themes. Elle repose sur deux choses que ces tests gardent :
// standard.css ne definit aucun jeton, et chaque overlay lit les jetons --sk-*
// avec sa valeur d'origine en repli. Le reste : le serveur pose le theme sur
// les overlays Twitch -- et sur eux seuls --, le change a chaud, et les
// couleurs du Neon.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const { creerServeur, ecouter } = await import('../src/core/serveur.js');
const { preparerDossiers } = await import('../src/core/paths.js');
const { getConfig } = await import('../src/core/store.js');
const themes = await import('../src/core/themes.js');

preparerDossiers();

const PORT = 45464;
const RACINE = join(import.meta.dirname, '..');
const DOSSIER_THEMES = join(RACINE, 'src', 'commun', 'themes');
const MODULES = join(RACINE, 'src', 'modules');

const app = {
  port: PORT,
  registre: {
    // Un overlay de jeu (la roue, Rocket League) et un overlay Twitch (la musique).
    get: (id) => {
      if (id === 'roue-rl') {
        return {
          id,
          dossier: id,
          manifeste: { categorie: 'rocket-league', overlays: [{ chemin: 'roue', fichier: 'roue.html' }] },
        };
      }
      if (id === 'musique') {
        return {
          id,
          dossier: id,
          manifeste: { categorie: 'twitch', overlays: [{ chemin: 'liste', fichier: 'overlay.html' }] },
        };
      }
      return undefined;
    },
    vue: () => null,
    vues: () => [],
  },
  etatGeneral: () => ({ version: 'test', port: PORT }),
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

const url = (chemin) => 'http://127.0.0.1:' + PORT + chemin;
const lire = async (chemin) => {
  const r = await fetch(url(chemin));
  return { code: r.status, corps: await r.text(), csp: r.headers.get('content-security-policy') };
};
const poster = (chemin, corps) =>
  fetch(url(chemin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
const choisir = (theme) => poster('/api/themes', { theme });
const themeDe = async (chemin) => (await lire(chemin)).corps.match(/data-sk-theme="([^"]+)"/)?.[1] ?? null;

// --- Le serveur pose le theme, sur les overlays Twitch seulement ---------------

test('un overlay Twitch recoit le theme Standard par defaut, feuille et script compris', async () => {
  const r = await lire('/overlay/musique/liste');
  assert.equal(r.code, 200);
  assert.match(r.corps, /<html[^>]* data-sk-theme="standard"/);
  assert.ok(r.corps.includes('href="/commun/themes/standard.css"'));
  // Le script de changement a chaud passe la CSP : il recoit le nonce.
  const nonce = r.csp.match(/'nonce-([^']+)'/)[1];
  assert.ok(r.corps.includes('<script nonce="' + nonce + '" src="/commun/theme.js"></script>'));
  // La feuille arrive APRES le <style> de l'overlay, dont elle remplace les jetons.
  assert.ok(r.corps.indexOf('id="sk-theme"') > r.corps.indexOf('</style>'));
  assert.ok(!r.corps.includes('data-sk-fige'), 'un overlay normal suit le reglage');
  assert.match(r.csp, /frame-ancestors 'none'/);
});

test('un overlay de jeu ne recoit aucun theme, meme force par ?theme=', async () => {
  for (const chemin of ['/overlay/roue-rl/roue', '/overlay/roue-rl/roue?theme=neon']) {
    const r = await lire(chemin);
    assert.equal(r.code, 200);
    assert.doesNotMatch(r.corps, /data-sk-theme|\/commun\/theme\.js|\/commun\/themes\//, chemin);
  }
});

test('?theme= force le theme d une source Twitch, et la fige', async () => {
  const r = await lire('/overlay/musique/liste?theme=neon');
  assert.match(r.corps, /data-sk-theme="neon" data-sk-fige/);
  assert.ok(r.corps.includes('/commun/themes/neon.css'));

  // Un theme inconnu ne casse rien : on retombe sur celui du streamer.
  assert.equal(await themeDe('/overlay/musique/liste?theme=%3Cscript%3E'), 'standard');
});

test('choisir un theme l enregistre, et les overlays Twitch charges ensuite le recoivent', async () => {
  const r = await choisir('arcade');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).actuel, 'arcade');
  assert.equal(getConfig().apparence.theme, 'arcade');
  assert.equal(await themeDe('/overlay/musique/liste'), 'arcade');
  assert.equal(await themeDe('/overlay/roue-rl/roue'), null, 'les jeux restent sans theme');
  await choisir('standard');
});

test('un theme inconnu est refuse sans rien changer', async () => {
  assert.equal((await choisir('../../secret')).status, 400);
  assert.equal(themes.actuel(), 'standard');
});

test('un config.json retouche a la main retombe sur Standard', () => {
  const c = getConfig();
  c.apparence.theme = 'disparu';
  assert.equal(themes.actuel(), 'standard');
  c.apparence.theme = 'standard';
});

// --- Couleurs du Neon -----------------------------------------------------------

test('les couleurs du Neon s enregistrent et arrivent sur chaque overlay Twitch', async () => {
  const r = await poster('/api/themes/neon', { principale: '#7DFF3D', secondaire: '#f5ff3d' });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).neon, { principale: '#7dff3d', secondaire: '#f5ff3d' });

  const html = (await lire('/overlay/musique/liste')).corps;
  assert.ok(html.includes('--sk-neon-1: #7dff3d'));
  assert.ok(html.includes('--sk-neon-1-rvb: 125, 255, 61'));

  // Rien d'autre qu'une couleur ne passe : c'est recopie dans un attribut style.
  const pirate = await poster('/api/themes/neon', { principale: 'red;"><script>', secondaire: '#ffffff' });
  assert.equal(pirate.status, 400);

  await poster('/api/themes/neon', { principale: '#ff3df2', secondaire: '#3df5ff' });
});

// --- Changement a chaud -------------------------------------------------------

test('le flux des themes donne le reglage en cours, puis chaque changement', { timeout: 5000 }, async () => {
  const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/commun/theme/flux');
  const recus = [];
  ws.onmessage = (m) => recus.push(JSON.parse(String(m.data).split('\n')[1]));
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const attendre = async (n) => {
    while (recus.length < n) {
      await new Promise((r) => {
        setTimeout(r, 10);
      });
    }
  };

  await attendre(1);
  assert.equal(recus[0].theme, 'standard', 'une source qui se connecte connait tout de suite le theme');
  assert.equal(recus[0].neon['--sk-neon-1'], '#ff3df2');

  await choisir('minimal');
  await attendre(2);
  assert.equal(recus[1].theme, 'minimal');

  ws.close();
  await choisir('standard');
});

// --- Apercus de la page Personnalisation -------------------------------------------

test('la scene d apercu et les overlays en apercu se laissent encadrer par le dashboard', async () => {
  const scene = await lire('/apercu-twitch?theme=neon');
  assert.equal(scene.code, 200);
  assert.match(scene.csp, /frame-ancestors 'self'/);

  const overlay = await lire('/overlay/musique/liste?demo=1&apercu=1&theme=neon');
  assert.match(overlay.csp, /frame-ancestors 'self'/);
  assert.match(overlay.corps, /data-sk-fige/);
});

test('un overlay en apercu ne se branche pas au flux', () => {
  // Sinon chaque vignette compterait comme une source OBS dans la vue d'ensemble.
  const flux = readFileSync(join(RACINE, 'src', 'commun', 'flux.js'), 'utf8');
  assert.match(flux, /has\('apercu'\)/);
  assert.match(flux, /if \(APERCU\) return;/);
});

test('chaque theme a son image d apercu, sauf le Neon qui est vivant', () => {
  for (const { id } of themes.THEMES) {
    if (id === 'neon') continue;
    const image = join(RACINE, 'src', 'dashboard', 'apercus', 'twitch-' + id + '.jpg');
    assert.ok(existsSync(image), 'apercus/twitch-' + id + '.jpg manquante : npm run captures');
  }
});

// --- Catalogue et fichiers ----------------------------------------------------

test('chaque theme du catalogue a sa feuille, et ses polices existent', () => {
  for (const { id } of themes.THEMES) {
    const chemin = join(DOSSIER_THEMES, id + '.css');
    assert.ok(existsSync(chemin), id + '.css manquant');
    for (const [, police] of readFileSync(chemin, 'utf8').matchAll(/url\(\/commun\/themes\/([^)]+)\)/g)) {
      assert.ok(existsSync(join(DOSSIER_THEMES, police)), id + ' : ' + police + ' introuvable');
    }
  }
});

test('Standard esport ne definit aucun jeton ni aucune regle', () => {
  const sansCommentaires = readFileSync(join(DOSSIER_THEMES, 'standard.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  );
  assert.equal(sansCommentaires.trim(), '', 'standard.css doit rester vide : c est le rendu d origine');
});

test('chaque overlay lit les jetons --sk-* avec sa valeur d origine en repli', () => {
  // var(--sk-encre) sans repli rendrait la propriete invalide sous Standard,
  // qui ne definit aucun jeton : l'overlay perdrait sa couleur d'origine.
  for (const m of readdirSync(MODULES)) {
    const dossier = join(MODULES, m, 'overlay');
    if (!existsSync(dossier)) continue;
    for (const f of readdirSync(dossier).filter((n) => n.endsWith('.html'))) {
      const html = readFileSync(join(dossier, f), 'utf8');
      const sansRepli = html.match(/var\(--sk-[\w-]+\)/g);
      assert.equal(sansRepli, null, m + '/' + f + ' : ' + sansRepli?.join(', '));
    }
  }
});
