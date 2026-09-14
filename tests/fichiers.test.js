// Ecriture durable des fichiers de donnees (audit P4).
//
// Le vrai scenario -- une coupure de courant entre l'ecriture et le renommage --
// ne se rejoue pas dans une suite de tests. Ce qui se verifie, en revanche, c'est
// la seule chose qui l'empeche : les octets sont forces sur le disque (fsync)
// AVANT que le nom ne bascule vers le nouveau fichier. On observe donc l'ordre
// reel des appels systeme.
//
// Et les trois ecrivains du socle -- reglages, jetons, etat des modules, plus les
// compteurs -- doivent tous passer par la. Un writeFileSync recopie a la main
// dans l'un d'eux rouvrirait le trou sans que rien d'autre ne le signale.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, basename } from 'node:path';

const { ecrireAtomique } = await import('../src/core/fichiers.js');
const store = await import('../src/core/store.js');
const compteurs = await import('../src/core/compteurs.js');
const { preparerDossiers } = await import('../src/core/paths.js');

preparerDossiers();

afterEach(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
});
after(() => nettoyer(DONNEES));

// Espionne les appels disque qui comptent, sans rien changer a leur effet :
// chaque appel est note puis transmis a la vraie fonction. `panne` permet de
// faire echouer un appel precis, comme le ferait un disque plein.
//
// syncBuiltinESMExports : le code importe { fsyncSync } de node:fs, une liaison
// ESM. Sans cet appel, remplacer fs.fsyncSync ne toucherait que l'objet, pas ce
// que voit fichiers.js.
function espionnerDisque({ panne = {} } = {}) {
  const appels = [];
  const chemins = new Map(); // fd -> nom du fichier ouvert

  const espion = (nom, decrire) => {
    const vraie = fs[nom];
    mock.method(fs, nom, (...args) => {
      if (panne[nom]) {
        appels.push(nom + ' ECHEC');
        throw Object.assign(new Error(panne[nom]), { code: panne[nom] });
      }
      const resultat = vraie(...args);
      appels.push(nom + ' ' + decrire(args, resultat));
      return resultat;
    });
  };

  espion('openSync', ([chemin], fd) => {
    chemins.set(fd, basename(chemin));
    return basename(chemin);
  });
  espion('writeFileSync', ([cible]) => chemins.get(cible) ?? basename(String(cible)));
  espion('fsyncSync', ([fd]) => chemins.get(fd));
  espion('closeSync', ([fd]) => chemins.get(fd));
  espion('renameSync', ([de, vers]) => basename(de) + ' -> ' + basename(vers));

  syncBuiltinESMExports();
  return appels;
}

// --- Le helper lui-meme ----------------------------------------------------

test('le contenu est ecrit, remplace l ancien, et ne laisse pas de .tmp', () => {
  const f = join(DONNEES, 'aller-retour.json');
  ecrireAtomique(f, '{"version":1}');
  ecrireAtomique(f, '{"version":2}');

  assert.equal(readFileSync(f, 'utf8'), '{"version":2}');
  assert.equal(existsSync(f + '.tmp'), false, 'le fichier temporaire doit avoir ete renomme');
});

test('les octets sont forces sur le disque AVANT le renommage', () => {
  const f = join(DONNEES, 'ordre.json');
  const appels = espionnerDisque();

  ecrireAtomique(f, '{"jeton":"x"}');

  // L'ordre exact compte. fsync apres rename = le trou de P4 : le nom bascule
  // vers un contenu qui n'est encore qu'en memoire. close avant rename : sous
  // Windows, renommer un fichier encore ouvert peut echouer.
  assert.deepEqual(appels, [
    'openSync ordre.json.tmp',
    'writeFileSync ordre.json.tmp',
    'fsyncSync ordre.json.tmp',
    'closeSync ordre.json.tmp',
    'renameSync ordre.json.tmp -> ordre.json',
  ]);
});

test('si le disque refuse le fsync, l ancien fichier reste intact', () => {
  // Disque debranche, cle USB retiree, secteur defectueux : le fsync est le
  // moment ou l'erreur se revele. Renommer malgre tout remplacerait un fichier
  // sain par un contenu dont on vient d'apprendre qu'il n'est pas sur le disque.
  const f = join(DONNEES, 'panne-fsync.json');
  writeFileSync(f, '{"sain":true}', 'utf8');

  const appels = espionnerDisque({ panne: { fsyncSync: 'EIO' } });
  assert.throws(() => ecrireAtomique(f, '{"sain":false}'), { code: 'EIO' });
  mock.restoreAll();
  syncBuiltinESMExports();

  assert.equal(readFileSync(f, 'utf8'), '{"sain":true}', 'l ancien contenu doit survivre');
  assert.ok(!appels.some((a) => a.startsWith('renameSync')), 'aucun renommage apres un fsync rate');
  assert.ok(appels.includes('closeSync panne-fsync.json.tmp'), 'le .tmp doit etre ferme malgre l echec');

  // Et la sauvegarde suivante passe : rien n'est reste verrouille.
  ecrireAtomique(f, '{"sain":"encore"}');
  assert.equal(readFileSync(f, 'utf8'), '{"sain":"encore"}');
});

test('si le disque est plein, l ancien fichier reste intact', () => {
  const f = join(DONNEES, 'disque-plein.json');
  writeFileSync(f, '{"sain":true}', 'utf8');

  const appels = espionnerDisque({ panne: { writeFileSync: 'ENOSPC' } });
  assert.throws(() => ecrireAtomique(f, '{"sain":false}'), { code: 'ENOSPC' });
  mock.restoreAll();
  syncBuiltinESMExports();

  assert.equal(readFileSync(f, 'utf8'), '{"sain":true}');
  assert.ok(appels.includes('closeSync disque-plein.json.tmp'), 'le .tmp doit etre ferme malgre l echec');
});

// --- Les ecrivains du socle passent tous par la ----------------------------

// Vrai si le fichier nomme a ete synchronise puis renomme, dans cet ordre.
function ecritDurablement(appels, nom) {
  const fsync = appels.indexOf('fsyncSync ' + nom + '.tmp');
  const rename = appels.indexOf('renameSync ' + nom + '.tmp -> ' + nom);
  return fsync !== -1 && rename !== -1 && fsync < rename;
}

test('les reglages sont ecrits durablement', () => {
  const appels = espionnerDisque();
  store.sauverConfig(store.getConfig());
  assert.ok(ecritDurablement(appels, 'config.json'), appels.join('\n'));
});

test('les jetons sont ecrits durablement', () => {
  // Le fichier dont la perte coute le plus : tout reconnecter.
  const appels = espionnerDisque();
  store.majTokens((t) => {
    t.twitch = { refreshToken: 'jeton-refresh' };
  });
  assert.ok(ecritDurablement(appels, 'tokens.json'), appels.join('\n'));
});

test('l etat d un module est ecrit durablement', () => {
  const appels = espionnerDisque();
  store.sauverEtat('roue-rl', { possedees: ['Octane'] });
  assert.ok(ecritDurablement(appels, 'roue-rl.json'), appels.join('\n'));
});

test('les compteurs sont ecrits durablement et se relisent', () => {
  compteurs.charger();
  compteurs.incr('musique', 'demandes', 3);

  const appels = espionnerDisque();
  compteurs.vider(); // l'arret de StreamKit : ecriture immediate
  assert.ok(ecritDurablement(appels, 'compteurs.json'), appels.join('\n'));
  mock.restoreAll();
  syncBuiltinESMExports();

  // Au lancement suivant, le total est la ; la session, elle, repart de zero.
  compteurs.charger();
  assert.deepEqual(compteurs.pour('musique'), { total: { demandes: 3 }, session: {} });
});
