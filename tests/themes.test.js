// Themes d'overlay (core/themes.js, src/commun/themes/).
//
// La promesse a tenir : « Standard esport » rend chaque overlay EXACTEMENT
// comme avant les themes. Elle repose sur deux choses que ces tests gardent :
// standard.css ne definit aucun jeton, et chaque overlay lit les jetons --sk-*
// avec sa valeur d'origine en repli. Le reste : le serveur pose bien le theme,
// le change a chaud, et l'apercu du dashboard reste fige sur le sien.

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
    get: (id) =>
      id === 'roue-rl'
        ? { id, dossier: id, manifeste: { overlays: [{ chemin: 'roue', fichier: 'roue.html' }] } }
        : undefined,
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
const choisir = (theme) =>
  fetch(url('/api/themes'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme }),
  });

// --- Le serveur pose le theme ------------------------------------------------

test('un overlay recoit le theme Standard par defaut, feuille et script compris', async () => {
  const r = await lire('/overlay/roue-rl/roue');
  assert.equal(r.code, 200);
  assert.match(r.corps, /<html[^>]* data-sk-theme="standard"/);
  assert.ok(r.corps.includes('href="/commun/themes/standard.css"'));
  // Le script de changement a chaud passe la CSP : il recoit le nonce.
  const nonce = r.csp.match(/'nonce-([^']+)'/)[1];
  assert.ok(r.corps.includes('<script nonce="' + nonce + '" src="/commun/theme.js"></script>'));
  // La feuille arrive APRES le <style> de l'overlay, dont elle remplace les jetons.
  assert.ok(r.corps.indexOf('id="sk-theme"') > r.corps.indexOf('</style>'));
  assert.ok(!r.corps.includes('data-sk-fige'), 'un overlay normal suit le theme choisi');
});

test('?theme= force le theme d une source, et la fige', async () => {
  const r = await lire('/overlay/roue-rl/roue?theme=neon');
  assert.match(r.corps, /data-sk-theme="neon" data-sk-fige/);
  assert.ok(r.corps.includes('/commun/themes/neon.css'));

  // Un theme inconnu ne casse rien : on retombe sur celui du streamer.
  const inconnu = await lire('/overlay/roue-rl/roue?theme=%3Cscript%3E');
  assert.match(inconnu.corps, /data-sk-theme="standard"/);
});

test('choisir un theme l enregistre, et les overlays charges ensuite le recoivent', async () => {
  const r = await choisir('arcade');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, actuel: 'arcade' });

  assert.equal(getConfig().apparence.theme, 'arcade');
  assert.equal((await (await fetch(url('/api/themes'))).json()).actuel, 'arcade');
  assert.match((await lire('/overlay/roue-rl/roue')).corps, /data-sk-theme="arcade"/);

  await choisir('standard');
});

test('un theme inconnu est refuse sans rien changer', async () => {
  const r = await choisir('../../secret');
  assert.equal(r.status, 400);
  assert.equal(themes.actuel(), 'standard');
});

test('un config.json retouche a la main retombe sur Standard', () => {
  const c = getConfig();
  c.apparence.theme = 'disparu';
  assert.equal(themes.actuel(), 'standard');
  c.apparence.theme = 'standard';
});

// --- Changement a chaud -------------------------------------------------------

test('le flux des themes donne le theme en cours, puis chaque changement', { timeout: 5000 }, async () => {
  const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/commun/theme/flux');
  const recus = [];
  ws.onmessage = (m) => recus.push(String(m.data));
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
  assert.equal(
    recus[0],
    'etat\n{"theme":"standard"}',
    'une source qui se connecte connait tout de suite le theme'
  );

  await choisir('minimal');
  await attendre(2);
  assert.equal(recus[1], 'etat\n{"theme":"minimal"}');

  ws.close();
  await choisir('standard');
});

// --- Apercu du dashboard -------------------------------------------------------

test('l apercu d un theme se laisse encadrer par le dashboard, et lui seul', async () => {
  const r = await lire('/apercu-theme/neon');
  assert.equal(r.code, 200);
  assert.match(r.corps, /data-sk-theme="neon" data-sk-fige/);
  assert.match(r.csp, /frame-ancestors 'self'/);
  // Un overlay, lui, ne s'encadre nulle part.
  assert.match((await lire('/overlay/roue-rl/roue')).csp, /frame-ancestors 'none'/);

  assert.equal((await lire('/apercu-theme/inconnu')).code, 404);
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
