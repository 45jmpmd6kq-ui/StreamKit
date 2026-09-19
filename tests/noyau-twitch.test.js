// Twitch injoignable au lancement, sur un vrai noyau : les modules Twitch
// doivent demarrer tout seuls quand Twitch revient.
//
// Le cas vise : « Démarrer avec Windows », StreamKit part avant le reseau. La
// couche Twitch est ici une doublure qui echoue autant de fois qu'on veut ; le
// reste (registre, modules, serveur) est le vrai. Le module Sondages sert de
// module Twitch, le module de demonstration de module autonome.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 45462;

writeFileSync(
  join(DONNEES, 'config.json'),
  JSON.stringify({
    version: 2, // deja migree : sinon le socle desactive les modules de developpement
    twitch: { channel: 'streamer', broadcasterId: '42', utilisateurId: '' },
    reseau: { port: PORT },
    maj: { auto: false, depot: '' },
    modules: {
      exemple: { actif: true, schemaVersion: 1, reglages: { intervalle: 60, bavard: false } },
      sondages: { actif: true, schemaVersion: 1, reglages: {} },
    },
  }),
  'utf8'
);

const { demarrerNoyau } = await import('../src/noyau.js');

const attendre = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

// Doublure de core/twitch.js : injoignable `echecs` fois, puis connectee.
function fauxTwitch() {
  const t = { echecs: 0, essais: 0, pret: false };
  const reseauCoupe = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  Object.assign(t, {
    async demarrer() {
      t.essais++;
      if (t.echecs > 0) {
        t.echecs--;
        t.pret = false;
        throw reseauCoupe();
      }
      t.pret = true;
      return t.getEtat();
    },
    async arreter() {
      t.pret = false;
    },
    estPret: () => t.pret,
    getEtat: () => ({
      pret: t.pret,
      raison: t.pret ? '' : 'Twitch injoignable — nouvel essai automatique',
      conseil: '',
      channel: 'streamer',
      broadcasterId: '42',
      scopes: ['channel:read:polls'],
      chatConnecte: t.pret,
      eventsubConnecte: t.pret,
    }),
    droitsManquants: () => [],
    aLeDroit: () => true,
    surDirect: () => () => {},
    enDirect: async () => null,
    retirerAbonnements: () => {},
    // Juste ce dont le module Sondages a besoin pour demarrer.
    contextePour: () => ({
      aLeDroit: () => true,
      surSondages: () => () => {},
      get api() {
        throw new Error('pas d’API Twitch dans ce test');
      },
      broadcasterId: '42',
      channel: 'streamer',
      dire() {},
    }),
  });
  return t;
}

const twitch = fauxTwitch();
twitch.echecs = 3; // le lancement, puis deux nouveaux essais
let noyau;

after(async () => {
  await noyau?.fermer();
  nettoyer(DONNEES);
});

const demarres = () => noyau.etatGeneral().modules.demarres;
const etatDe = (id) => noyau.app.registre.vue(id).etat;

test('reseau absent au lancement : le module autonome part, le module Twitch attend', async () => {
  noyau = await demarrerNoyau({ twitch, pausesTwitchMs: [80, 80] });
  assert.equal(twitch.essais, 1);
  assert.equal(etatDe('exemple'), 'demarre', 'rien ne l oblige a attendre Twitch');
  assert.equal(etatDe('sondages'), 'arrete');
  assert.equal(demarres(), 1);
});

test('Twitch revient : le module Twitch demarre tout seul', async () => {
  await attendre(400);
  assert.equal(twitch.essais, 4, 'le lancement et deux nouveaux essais rates, le troisieme passe');
  assert.equal(etatDe('sondages'), 'demarre');
  assert.equal(demarres(), 2);
  assert.equal(noyau.etatGeneral().twitch.pret, true);
});

test('reconnexion demandee pendant une panne : les modules autonomes repartent, Twitch est retente', async () => {
  twitch.echecs = 1;
  const r = await noyau.app.reconnecterTwitch();
  assert.equal(r.ok, false);
  // Tout a ete arrete pour reconnecter : ce qui se passe de Twitch est reparti.
  assert.equal(etatDe('exemple'), 'demarre');
  assert.equal(etatDe('sondages'), 'arrete');

  await attendre(300);
  assert.equal(etatDe('sondages'), 'demarre', 'le nouvel essai automatique a abouti');
  assert.equal(demarres(), 2);
});
