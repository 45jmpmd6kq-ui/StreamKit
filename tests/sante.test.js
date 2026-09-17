// La vue d'ensemble des connexions : l'ecran qu'un streamer regarde avant de
// partir en live, et celui qu'on lui demande d'ouvrir quand « ca marche pas ».
//
// Chaque carte fausse coute cher : un « OK » qui ment l'envoie en live avec un
// bot muet, un « KO » qui ment l'envoie chercher une panne qui n'existe pas. Ce
// sont ces verdicts qu'on teste, avec de faux Twitch, OBS et modules -- c'est
// tout l'interet d'avoir sorti cette logique du noyau (audit U3).

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const { creerSante, canauxTwitch, resumeModules, FRAICHEUR_SANTE_MS } = await import('../src/core/sante.js');
const store = await import('../src/core/store.js');
const { preparerDossiers } = await import('../src/core/paths.js');

preparerDossiers();
afterEach(() => mock.timers.reset());
after(() => nettoyer(DONNEES));

// --- Faux socle ------------------------------------------------------------

const TWITCH_OK = { pret: true, channel: 'sylvain', chatConnecte: true, eventsubConnecte: true };

function module_(id, extra = {}) {
  const { manifeste = {}, ...reste } = extra;
  return { id, etat: 'demarre', actif: true, ...reste, manifeste: { nom: 'Module ' + id, ...manifeste } };
}

// Monte une sante sur un faux socle. Chaque piece se remplace au besoin.
function monter({
  modules = [],
  twitch = TWITCH_OK,
  droitsManquants = [],
  sources = {},
  connecteurs = {},
  contexteDe,
} = {}) {
  return creerSante({
    port: 4455,
    registre: { liste: () => modules, scopesRequis: () => [] },
    twitch: { getEtat: () => twitch, droitsManquants: () => droitsManquants },
    diffusion: { nbClients: (canal) => sources[canal] ?? 0 },
    connecteurs: {
      catalogue: () => [{ id: 'spotify', nom: 'Spotify', icone: '🎵', etapes: [] }],
      pour: () => ({ configure: false, connecte: false, compte: '', ...connecteurs }),
      urlDeRetour: () => 'http://127.0.0.1:4455/callback/connecteur/spotify',
      estPkce: () => true,
    },
    compteurs: {
      pour: () => ({ total: { demandes: 12 }, session: { demandes: 3 } }),
      debutSession: () => '2026-09-14T20:00:00.000Z',
      causeSession: () => 'live',
    },
    contexteDe,
  });
}

const carte = (vue, id) => vue.connexions.find((c) => c.id === id);

// --- Twitch ----------------------------------------------------------------

test('Twitch jamais configure est « inactif », pas en panne', async () => {
  store.sauverTokens({});
  const vue = await monter({ twitch: { pret: false, raison: 'application non configurée' } }).sante();
  assert.equal(carte(vue, 'twitch').etat, 'inactif');
});

test('Twitch configure mais deconnecte est « ko », avec la raison', async () => {
  store.sauverTokens({ twitchApp: { clientId: 'id', clientSecret: 'secret' } });
  const vue = await monter({ twitch: { pret: false, raison: 'jeton refusé' } }).sante();
  assert.equal(carte(vue, 'twitch').etat, 'ko');
  assert.equal(carte(vue, 'twitch').detail, 'jeton refusé');
});

test('des droits Twitch manquants donnent « attention » et disent lesquels', async () => {
  const vue = await monter({ droitsManquants: ['clips:edit'] }).sante();
  const t = carte(vue, 'twitch');
  assert.equal(t.etat, 'attention');
  assert.match(t.aide, /clips:edit/);
});

test('le chat coupe pendant qu EventSub tourne est signale, pas masque', async () => {
  const vue = await monter({ twitch: { ...TWITCH_OK, chatConnecte: false } }).sante();
  assert.equal(carte(vue, 'twitch').etat, 'attention');
  assert.match(carte(vue, 'twitch').detail, /chat en reconnexion/);
});

test('chaque etat des deux canaux Twitch a son libelle', () => {
  const libelles = new Set(
    [
      [true, true],
      [false, false],
      [true, false],
      [false, true],
    ].map(([chatConnecte, eventsubConnecte]) => canauxTwitch({ chatConnecte, eventsubConnecte }))
  );
  assert.equal(libelles.size, 4, 'deux situations differentes ne doivent pas se lire pareil');
});

// --- OBS -------------------------------------------------------------------

test('OBS compte les sources branchees sur les overlays, et dit lesquelles', async () => {
  const roue = module_('roue-rl', {
    manifeste: { nom: 'Roue', overlays: [{ chemin: 'roue', nom: 'Machine' }] },
  });
  const vue = await monter({ modules: [roue], sources: { 'overlay:roue-rl:roue': 2 } }).sante();

  const obs = carte(vue, 'obs');
  assert.equal(obs.etat, 'ok');
  assert.equal(obs.detail, '2 source(s) connectée(s)');
  assert.match(obs.aide, /Roue › Machine \(2\)/);
});

test('aucune source OBS : « inactif », avec la marche a suivre', async () => {
  const vue = await monter().sante();
  assert.equal(carte(vue, 'obs').etat, 'inactif');
  assert.match(carte(vue, 'obs').aide, /source Navigateur/);
});

// --- Connecteurs -----------------------------------------------------------

test('un connecteur dont aucun module ne se sert n encombre pas l ecran', async () => {
  const vue = await monter({ modules: [module_('roue-rl')] }).sante();
  assert.equal(carte(vue, 'spotify'), undefined);
});

test('Spotify non connecte n est pas une panne quand le bot musique le reclame', async () => {
  const musique = module_('musique', { etat: 'arrete', manifeste: { connecteurs: ['spotify'] } });
  const vue = await monter({ modules: [musique], connecteurs: { configure: true } }).sante();

  assert.equal(carte(vue, 'spotify').etat, 'inactif');
  assert.match(carte(vue, 'spotify').aide, /Connecter/);
});

// --- Les cartes declarees par les modules ----------------------------------

test('la carte d un module remplace celle du socle, a la meme place', async () => {
  // Le bot musique en sait plus que le socle sur Spotify (l'appareil actif) :
  // sa carte doit prendre la place de la generique, pas s'y ajouter.
  const musique = module_('musique', {
    manifeste: {
      connecteurs: ['spotify'],
      sante: async () => [{ id: 'spotify', nom: 'Spotify', etat: 'ok', detail: 'PC-SALON' }],
    },
  });
  const vue = await monter({ modules: [musique], connecteurs: { connecte: true } }).sante();

  const ids = vue.connexions.map((c) => c.id);
  assert.deepEqual(ids, ['twitch', 'obs', 'spotify'], 'ni doublon ni changement de place');
  assert.equal(carte(vue, 'spotify').detail, 'PC-SALON');
  assert.equal(carte(vue, 'spotify').module, 'Module musique');
});

test('un module recoit son contexte, et un module arrete n est pas interroge', async () => {
  const recu = [];
  const sante = async (ctx) => {
    recu.push(ctx);
    return [];
  };
  const vivant = module_('valorant', { manifeste: { sante } });
  const eteint = module_('musique', { etat: 'arrete', manifeste: { sante } });

  await monter({ modules: [vivant, eteint], contexteDe: (id) => ({ id }) }).sante();
  assert.deepEqual(recu, [{ id: 'valorant' }]);
});

test('la sante d un module est gardee 20 s : pas douze appels Spotify par minute', async () => {
  mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  let appels = 0;
  const musique = module_('musique', {
    manifeste: {
      sante: async () => {
        appels++;
        return [{ id: 'spotify', etat: 'ok' }];
      },
    },
  });
  const vues = monter({ modules: [musique] });

  await vues.sante();
  mock.timers.tick(5000); // le rafraichissement du dashboard
  await vues.sante();
  assert.equal(appels, 1, 'reinterroge avant la fin du delai');

  mock.timers.tick(FRAICHEUR_SANTE_MS);
  await vues.sante();
  assert.equal(appels, 2, 'le delai passe, il faut redemander');
});

test('un module arrete puis relance ne ressert pas une sante perimee', async () => {
  let appels = 0;
  const musique = module_('musique', {
    manifeste: {
      sante: async () => {
        appels++;
        return [];
      },
    },
  });
  const vues = monter({ modules: [musique] });

  await vues.sante();
  vues.oublier('musique'); // ce que fait le noyau a l'arret du module
  await vues.sante();
  assert.equal(appels, 2);
});

test('un module dont la sante plante donne une carte « ko », sans etre harcele', async () => {
  let appels = 0;
  const valorant = module_('valorant', {
    manifeste: {
      nom: 'Valorant',
      sante: async () => {
        appels++;
        throw new Error('Riot Client introuvable');
      },
    },
  });
  const vues = monter({ modules: [valorant] });

  const vue = await vues.sante();
  const c = carte(vue, 'valorant:sante');
  assert.equal(c.etat, 'ko');
  assert.equal(c.aide, 'Riot Client introuvable');

  await vues.sante();
  assert.equal(appels, 1, 'l echec aussi doit etre mis en cache');
});

// --- Compteurs et decompte des modules -------------------------------------

test('deux modules d un meme jeu ne font qu une carte, une ligne chacun', async () => {
  // League of Legends a deux modules : deux cartes voisines pour un seul sujet,
  // que le streamer devait rapprocher du regard. Le socle s'en charge.
  const suivi = module_('lol-session', {
    manifeste: {
      nom: 'Suivi de session',
      categorie: 'lol',
      sante: async () => [
        {
          id: 'lol',
          nom: 'League of Legends',
          etat: 'inactif',
          detail: 'client fermé',
          aide: 'Lance le jeu.',
        },
      ],
    },
  });
  const moments = module_('lol-moments', {
    manifeste: {
      nom: 'Moments forts',
      categorie: 'lol',
      sante: async () => [
        { id: 'lol-partie', nom: 'Partie de LoL', etat: 'inactif', detail: 'pas de partie en cours' },
      ],
    },
  });

  const vue = await monter({ modules: [suivi, moments] }).sante();
  const lol = carte(vue, 'categorie:lol');

  assert.equal(vue.connexions.filter((c) => c.id.startsWith('categorie:')).length, 1, 'une seule carte');
  assert.equal(lol.nom, 'League of Legends');
  // Le nom du module, pas celui de sa carte : sous « League of Legends », c'est
  // « Suivi de session » qui dit ce que la ligne raconte.
  assert.deepEqual(
    lol.lignes.map((l) => l.nom + ' : ' + l.detail),
    ['Suivi de session : client fermé', 'Moments forts : pas de partie en cours']
  );
});

test('une panne dans un groupe ressort sur la carte, avec l aide qui va avec', async () => {
  // Sinon un module en rade se cache derriere son voisin qui va bien -- et la
  // vue d'ensemble sert justement a reperer ca avant de partir en live.
  const suivi = module_('lol-session', {
    manifeste: {
      nom: 'Suivi de session',
      categorie: 'lol',
      sante: async () => [{ id: 'lol', nom: 'LoL', etat: 'ok', detail: 'Or IV' }],
    },
  });
  const moments = module_('lol-moments', {
    manifeste: {
      nom: 'Moments forts',
      categorie: 'lol',
      sante: async () => [
        { id: 'p', nom: 'Partie', etat: 'ko', detail: 'API muette', aide: 'Relance le client.' },
      ],
    },
  });

  const lol = carte(await monter({ modules: [suivi, moments] }).sante(), 'categorie:lol');
  assert.equal(lol.etat, 'ko');
  assert.equal(lol.aide, 'Relance le client.');
});

test('un groupe reduit a un seul module redevient une carte ordinaire', async () => {
  // Une liste d'une seule ligne n'apprend rien de plus, et perdrait au passage
  // la provenance affichee en haut a droite de la carte.
  const seul = module_('lol-session', {
    manifeste: {
      nom: 'Suivi de session',
      categorie: 'lol',
      sante: async () => [{ id: 'lol', nom: 'League of Legends', etat: 'ok', detail: 'Or IV' }],
    },
  });

  const lol = carte(await monter({ modules: [seul] }).sante(), 'categorie:lol');
  assert.equal(lol.lignes, undefined);
  assert.equal(lol.detail, 'Or IV');
  assert.equal(lol.module, 'Suivi de session');
});

test('les compteurs d un module restent visibles quand il est arrete', async () => {
  const clips = module_('clips', {
    etat: 'arrete',
    manifeste: { nom: 'Clips', icone: '🎬', compteurs: { demandes: 'Clips demandés' } },
  });
  const vue = await monter({ modules: [clips] }).sante();

  assert.deepEqual(vue.kpis, [
    {
      module: 'Clips',
      icone: '🎬',
      actif: false,
      valeurs: [{ cle: 'demandes', label: 'Clips demandés', session: 3, total: 12 }],
    },
  ]);
  assert.equal(vue.causeSession, 'live');
});

test('un module de developpement eteint ne compte pas dans le total', () => {
  const registre = {
    liste: () => [
      module_('musique'),
      module_('roue-rl', { etat: 'incomplet' }),
      module_('exemple', { etat: 'arrete', actif: false, manifeste: { developpement: true } }),
    ],
  };
  assert.deepEqual(resumeModules(registre), { total: 2, actifs: 2, demarres: 1, enErreur: 1 });
});

// --- Ecran Connecteurs -----------------------------------------------------

test('l ecran Connecteurs dit qui reclame chaque service, et s il faut un secret', () => {
  store.sauverTokens({ twitchApp: { clientId: 'id', clientSecret: 'secret' } });
  const musique = module_('musique', { manifeste: { nom: 'Bot musique', connecteurs: ['spotify'] } });
  const [twitch, spotify] = monter({ modules: [musique], droitsManquants: ['clips:edit'] }).etatConnecteurs();

  assert.equal(twitch.etat, 'attention', 'droits a renouveler');
  assert.match(twitch.detail, /1 droit\(s\) à renouveler/);
  assert.equal(twitch.urlDeRetour, 'http://localhost:4455/callback/twitch');

  assert.deepEqual(spotify.demandePar, ['Bot musique']);
  assert.equal(spotify.pkce, true, 'le dashboard ne doit pas reclamer de secret Spotify');
  assert.equal(spotify.etat, 'inactif');
});

test('l assistant Twitch ne propose pas un nom d application que Twitch refusera', () => {
  // Twitch refuse un nom d'application deja pris, tous comptes confondus :
  // « Nom : StreamKit » ne fonctionnait que pour le premier streamer.
  const [twitch] = monter().etatConnecteurs();
  const etapeNom = twitch.etapes.find((e) => e.startsWith('Nom'));
  assert.ok(etapeNom, 'l etape du nom doit exister');
  assert.doesNotMatch(etapeNom, /^Nom : StreamKit —/, 'un nom fixe ne passe qu une fois');
  assert.match(etapeNom, /pseudo/);
});
