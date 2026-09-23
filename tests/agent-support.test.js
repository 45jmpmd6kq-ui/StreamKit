// Agent de support : module reserve au PC du proprietaire.
//
// Trois choses a garantir :
//   - sans fichier temoin, le module n'existe pas (chez les streamers) ;
//   - l'agent est reconnu parmi les processus, et jamais confondu avec une
//     session Claude ordinaire de l'appli de bureau ;
//   - seul le streamer qui ETEINT le module ferme l'agent : une fermeture ou
//     une reconnexion Twitch de StreamKit (qui arretent tous les modules) le
//     laisse travailler.
//
// Aucun vrai programme n'est lance : io.lister/lancer/tuer sont remplaces.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LANCEUR = join(mkdtempSync(join(tmpdir(), 'agent-lanceur-')), 'lancer-agent-support.bat');
writeFileSync(LANCEUR, '@echo off\r\n');
writeFileSync(join(DONNEES, 'agent-support.json'), JSON.stringify({ lanceur: LANCEUR }));

const registre = await import('../src/core/registre.js');
const { preparerDossiers } = await import('../src/core/paths.js');
const { analyser, lireLanceur, io } = await import('../src/modules/agent-support/processus.js');
const { default: manifeste } = await import('../src/modules/agent-support/module.js');

preparerDossiers();
after(() => nettoyer(DONNEES));

// --- Processus fabriques ----------------------------------------------------

const DESKTOP = {
  ProcessId: 10,
  ParentProcessId: 1,
  Name: 'claude.exe',
  CommandLine: 'claude.exe --output-format stream-json',
};
const BAT = {
  ProcessId: 20,
  ParentProcessId: 2,
  Name: 'cmd.exe',
  CommandLine: 'cmd.exe /c ""E:\\X\\lancer-agent-support.bat""',
};
const PS = {
  ProcessId: 21,
  ParentProcessId: 20,
  Name: 'powershell.exe',
  CommandLine: 'powershell -File "E:\\X\\scripts\\lancer-agent-support.ps1"',
};
const AGENT = {
  ProcessId: 22,
  ParentProcessId: 21,
  Name: 'claude.exe',
  CommandLine: 'claude.exe --channels plugin:discord@claude-plugins-official --settings x.json',
  CreationDate: '/Date(1790177781403)/',
};
const BUN_RUN = {
  ProcessId: 23,
  ParentProcessId: 22,
  Name: 'bun.exe',
  CommandLine: 'bun run --cwd C:/p/discord/0.0.4 start',
};
const BUN_SERVEUR = { ProcessId: 24, ParentProcessId: 23, Name: 'bun.exe', CommandLine: 'bun.exe server.ts' };

test('rien ne tourne : ni agent, ni demarrage', () => {
  assert.deepEqual(analyser([DESKTOP]), { enMarche: false });
});

test("une session Claude de l'appli de bureau n'est pas l'agent", () => {
  assert.equal(analyser([DESKTOP, BUN_SERVEUR]).enMarche, false);
});

test('agent lance par le .bat : on tue le .bat, pour fermer la fenetre', () => {
  const e = analyser([DESKTOP, BAT, PS, AGENT, BUN_RUN, BUN_SERVEUR]);
  assert.equal(e.enMarche, true);
  assert.equal(e.pid, 22);
  assert.equal(e.racine, 20);
  assert.equal(e.bot, true);
  assert.equal(e.depuis, 1790177781403);
});

test('le bot est deconnecte quand son serveur est mort', () => {
  assert.equal(analyser([BAT, PS, AGENT, BUN_RUN]).bot, false);
});

test("agent lance a la main (sans lanceur) : c'est lui qu'on tue", () => {
  const seul = { ...AGENT, ParentProcessId: 999 };
  assert.equal(analyser([seul]).racine, 22);
});

test("la remontee s'arrete au premier parent qui n'est pas le lanceur", () => {
  const explorateur = { ProcessId: 2, ParentProcessId: 1, Name: 'explorer.exe', CommandLine: 'explorer.exe' };
  assert.equal(analyser([explorateur, BAT, PS, AGENT]).racine, 20);
});

test('lanceur ouvert, Claude pas encore la : demarrage en cours', () => {
  assert.deepEqual(analyser([BAT, PS]), { enMarche: false, demarrage: true, racine: 20 });
});

test('une boucle de parents (PID reutilises) ne bloque pas', () => {
  const a = { ...BAT, ParentProcessId: 21 };
  assert.equal(analyser([a, PS, AGENT]).racine, 20);
});

// --- Fichier temoin -----------------------------------------------------------

test('fichier temoin : chaque defaut a son message', () => {
  const d = mkdtempSync(join(tmpdir(), 'agent-temoin-'));
  const f = join(d, 'agent-support.json');
  assert.throws(() => lireLanceur(f), /absent/);
  writeFileSync(f, '{ pas du json');
  assert.throws(() => lireLanceur(f), /illisible/);
  writeFileSync(f, '{}');
  assert.throws(() => lireLanceur(f), /cl[ée] « lanceur »/);
  writeFileSync(f, JSON.stringify({ lanceur: join(d, 'absent.bat') }));
  assert.throws(() => lireLanceur(f), /introuvable/);
  writeFileSync(f, JSON.stringify({ lanceur: 'E:\\a"b.bat' }));
  assert.throws(() => lireLanceur(f), /guillemet/);
  writeFileSync(f, '\uFEFF' + JSON.stringify({ lanceur: LANCEUR })); // ecrit par PowerShell 5.1
  assert.equal(lireLanceur(f), LANCEUR);
  nettoyer(d);
});

// --- Registre -----------------------------------------------------------------

test('avec le fichier temoin, le module est inscrit (dans Outils)', async () => {
  await registre.charger();
  const m = registre.get('agent-support');
  assert.ok(m, 'module absent du registre');
  assert.equal(registre.vue('agent-support').categorie.id, 'outils');
  assert.deepEqual(
    registre.vue('agent-support').actions.map((a) => a.nom),
    ['lancerAgent', 'afficher']
  );
});

test('sans fichier temoin, disponible() le tient hors du registre', () => {
  const vide = mkdtempSync(join(tmpdir(), 'agent-vide-'));
  assert.equal(manifeste.disponible({ donnees: vide }), false);
  assert.equal(manifeste.disponible({ donnees: DONNEES }), true);
  nettoyer(vide);
});

// --- Cycle de vie ---------------------------------------------------------------

let processus;
let lances;
let tues;

beforeEach(() => {
  processus = [DESKTOP];
  lances = [];
  tues = [];
  io.lister = async () => processus;
  io.lancer = (l) => lances.push(l);
  io.tuer = async (pid) => {
    tues.push(pid);
    return true;
  };
  manifeste.disponible({ donnees: DONNEES });
});

function contexte() {
  const journal = [];
  return {
    journal,
    log: Object.fromEntries(
      ['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, (m) => journal.push([n, m])])
    ),
    minuteur: { intervalle: () => {}, delai: () => {} },
  };
}

test("demarrer lance l'agent quand rien ne tourne", async () => {
  const ctx = contexte();
  const inst = await manifeste.demarrer(ctx);
  assert.deepEqual(lances, [LANCEUR]);
  assert.equal((await manifeste.sante(ctx))[0].etat, 'inactif'); // demarrage en cours
  await inst.arreter({ desactive: true }); // remet le compteur de lancement a zero
});

test('demarrer reprend un agent deja lance, sans en ouvrir un second', async () => {
  processus = [DESKTOP, BAT, PS, AGENT, BUN_RUN, BUN_SERVEUR];
  const ctx = contexte();
  await manifeste.demarrer(ctx);
  assert.deepEqual(lances, []);
  const [ligne] = await manifeste.sante(ctx);
  assert.equal(ligne.etat, 'ok');
  assert.match(ligne.detail, /Bot connecté · lancé à \d\d:\d\d/);
});

test("un arret de StreamKit (fermeture, reconnexion Twitch) laisse l'agent vivre", async () => {
  processus = [BAT, PS, AGENT, BUN_RUN, BUN_SERVEUR];
  const inst = await manifeste.demarrer(contexte());
  await inst.arreter({});
  await inst.arreter();
  assert.deepEqual(tues, []);
});

test("eteindre le module ferme la fenetre de l'agent", async () => {
  processus = [BAT, PS, AGENT, BUN_RUN, BUN_SERVEUR];
  const inst = await manifeste.demarrer(contexte());
  await inst.arreter({ desactive: true });
  assert.deepEqual(tues, [20]);
});

test('deux allumages rapprochés ne lancent pas deux agents', async () => {
  const a = await manifeste.demarrer(contexte());
  await a.arreter({}); // StreamKit redemarre le module avant que la fenetre n'apparaisse
  await manifeste.demarrer(contexte());
  assert.equal(lances.length, 1);
  await a.arreter({ desactive: true });
});

test('lanceur introuvable : le module passe en erreur avec le chemin', async () => {
  writeFileSync(join(DONNEES, 'agent-support.json'), JSON.stringify({ lanceur: 'E:\\nulle-part\\x.bat' }));
  await assert.rejects(manifeste.demarrer(contexte()), /Lanceur introuvable : E:\\nulle-part\\x\.bat/);
  writeFileSync(join(DONNEES, 'agent-support.json'), JSON.stringify({ lanceur: LANCEUR }));
});
