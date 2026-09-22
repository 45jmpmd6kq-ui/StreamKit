// « Signaler un bug » : le rapport qu'un streamer envoie quand ca ne marche pas.
//
// Deux promesses a tenir, et chacune se paie cher si elle ment :
//
//   - le rapport part, ou il reste sur le PC. Un bouton qui dit « envoye » sans
//     que rien n'arrive, c'est le streamer qui attend une reponse qui ne vient
//     pas -- et le bug qui reste ;
//   - AUCUN secret ne sort. Le journal, les diagnostics de modules, et meme ce
//     que le streamer colle par erreur dans sa description partent dans un
//     salon Discord : un jeton qui y passe est un compte Twitch donne.
//
// Discord est remplace par un faux (envoyerHttp injecte) ; un dernier test
// passe par un vrai serveur HTTP local, pour prouver que le formulaire
// multipart tient la route avec le vrai fetch.

import { dossierDeDonneesJetable, nettoyer } from './aide.js';
const DONNEES = dossierDeDonneesJetable(); // AVANT tout import du code

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const {
  creerSignalement,
  lireCible,
  nomDeFichier,
  valeursSecretes,
  BUDGET_MESSAGE,
  MAX_FICHIERS_MESSAGE,
  MAX_OCTETS_JOURNAL,
} = await import('../src/core/signalement.js');
const { brouiller, debrouiller } = await import('../src/core/brouillage.js');
const { preparerDossiers } = await import('../src/core/paths.js');

preparerDossiers();
after(() => nettoyer(DONNEES));

const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/jeton-de-test';

const pad = (n) => String(n).padStart(2, '0');
const jourDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// --- Banc ------------------------------------------------------------------

// Des dossiers neufs a chaque montage : journaux, memoires, rapports enregistres.
let banc = 0;
function nouveauxDossiers() {
  const base = join(DONNEES, 'banc-' + ++banc);
  const d = {
    journaux: join(base, 'journaux'),
    etats: join(base, 'etat'),
    signalements: join(base, 'signalements'),
  };
  mkdirSync(d.journaux, { recursive: true });
  mkdirSync(d.etats, { recursive: true });
  return d;
}

// Un faux Discord : garde chaque envoi (adresse, payload, fichiers) et repond
// ce qu'on lui a demande, puis « 200 » par defaut.
function fauxDiscord(reponses = []) {
  const envois = [];
  const envoyerHttp = async (url, options) => {
    const form = options.body;
    const envoi = { url, payload: JSON.parse(form.get('payload_json')), fichiers: [] };
    for (const [cle, v] of form.entries()) {
      if (!cle.startsWith('files[')) continue;
      const texte = /^(text\/|application\/json)/.test(v.type) ? await v.text() : null;
      envoi.fichiers.push({ nom: v.name, taille: v.size, texte });
    }
    envois.push(envoi);
    const r = reponses.shift() ?? { status: 200, corps: { id: 'm' + envois.length, channel_id: 'fil-1' } };
    if (r.lever) throw r.lever;
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.corps ?? {} };
  };
  return { envois, envoyerHttp };
}

function moduleRoue(extra = {}) {
  const { manifeste = {}, ...reste } = extra;
  return {
    id: 'roue-rl',
    actif: true,
    etat: 'demarre',
    demarreA: Date.now() - 3600_000,
    erreur: null,
    ...reste,
    manifeste: {
      nom: 'Random Car',
      overlays: [{ chemin: 'roue', nom: 'Machine à sous' }],
      compteurs: { tirages: 'Tirages' },
      async sante() {
        return [{ id: 'roue-rl', nom: 'Random Car', etat: 'attention', detail: 'aucune voiture cochée' }];
      },
      async diagnostic(ctx) {
        return { voituresCochees: 0, contexte: ctx.jetable ? 'jetable' : 'vivant' };
      },
      ...manifeste,
    },
  };
}

function monter({
  modules = [moduleRoue()],
  secrets = {},
  cible = WEBHOOK,
  discord = fauxDiscord(),
  dossiers = nouveauxDossiers(),
  contextes = { 'roue-rl': { id: 'roue-rl' } },
  jetables = [],
  ...reste
} = {}) {
  const s = creerSignalement({
    registre: {
      get: (id) => modules.find((m) => m.id === id),
      liste: () => modules,
      vue: (id) => ({
        id,
        icone: '🎡',
        manque: [],
        connecteurs: [],
        scopes: ['channel:read:redemptions'],
        reglages: { rewardTitle: 'Random Car', rewardCost: 500, cleSecrete: '__inchange__' },
      }),
      scopesRequis: () => ['channel:read:redemptions'],
    },
    twitch: {
      getEtat: () => ({
        pret: true,
        channel: 'kouss_tv',
        broadcasterId: '42',
        chatConnecte: true,
        eventsubConnecte: true,
        scopes: ['channel:read:redemptions'],
      }),
      droitsManquants: () => [],
      abonnements: () => [
        {
          nom: 'recompense:abc',
          quoi: 'utilisations de la récompense',
          verifie: false,
          gestionnaires: 1,
          modules: ['roue-rl'],
        },
      ],
    },
    diffusion: { nbClients: () => 0 },
    compteurs: { pour: () => ({ total: { tirages: 45 }, session: { tirages: 3 } }) },
    contexteDe: (id) => contextes[id],
    contexteJetable: (m) => {
      const ctx = {
        id: m.id,
        jetable: true,
        _nettoyer() {
          ctx.nettoye = true;
        },
      };
      jetables.push(ctx);
      return ctx;
    },
    config: () => ({ twitch: { channel: 'kouss_tv' } }),
    secrets: () => secrets,
    cible,
    envoyerHttp: discord.envoyerHttp,
    attendre: async () => {},
    dossiers,
    intervalleMinMs: 0,
    ...reste,
  });
  return { s, discord, dossiers };
}

const piece = (nom, octets, type = 'image/png') => ({
  nom,
  type,
  donnees: Buffer.alloc(octets, 7).toString('base64'),
});

const DEMANDE = {
  module: 'roue-rl',
  partie: 'overlay:roue',
  partieLibelle: 'Overlay : Machine à sous',
  quand: 'instant',
  description: 'Un viewer a pris la récompense, rien ne s’est affiché dans OBS.',
  pseudo: 'kouss',
};

const texteDe = (envoi, debut) => envoi.fichiers.find((f) => f.nom.startsWith(debut))?.texte ?? '';

// --- Adresse du salon --------------------------------------------------------

test('le brouillage fait l aller-retour, sans « discord » en clair', () => {
  const code = brouiller(WEBHOOK);
  assert.equal(debrouiller(code), WEBHOOK);
  assert.doesNotMatch(code, /discord/i);
  assert.doesNotMatch(Buffer.from(code, 'base64').toString('latin1'), /discord/i);
});

test('lireCible : variable, fichier brouille, rien, adresse douteuse', () => {
  const fichier = join(DONNEES, 'cible.json');
  assert.equal(lireCible({ env: { STREAMKIT_WEBHOOK_BUGS: WEBHOOK }, fichier }), WEBHOOK);
  assert.equal(lireCible({ env: {}, fichier }), null, 'ni variable ni fichier : pas d envoi');

  writeFileSync(fichier, JSON.stringify({ cible: brouiller(WEBHOOK) }));
  assert.equal(lireCible({ env: {}, fichier }), WEBHOOK);

  // Une faute de frappe ne doit pas envoyer le journal du streamer ailleurs.
  assert.equal(
    lireCible({ env: { STREAMKIT_WEBHOOK_BUGS: 'https://exemple.com/api/webhooks/1/x' }, fichier }),
    null
  );
  writeFileSync(fichier, JSON.stringify({ cible: brouiller('http://discord.com/api/webhooks/1/x') }));
  assert.equal(lireCible({ env: {}, fichier }), null, 'http en clair refuse');
});

// --- Outils ------------------------------------------------------------------

test('nomDeFichier neutralise chemins et noms reserves de Windows', () => {
  assert.equal(nomDeFichier('../../Windows/evil.exe'), 'Windows_evil.exe');
  assert.equal(nomDeFichier('C:\\Users\\moi\\capture.png'), 'C_Users_moi_capture.png');
  assert.equal(nomDeFichier('CON.txt'), '_CON.txt');
  assert.equal(nomDeFichier('...'), 'piece');
  assert.equal(nomDeFichier('', 'piece-3'), 'piece-3');
  assert.equal(nomDeFichier('Capture d’écran (2).png'), 'Capture d_écran (2).png');
});

test('valeursSecretes prend jetons et secrets des modules, pas l identifiant client', () => {
  const v = valeursSecretes({
    twitchApp: { clientId: 'id-client-public', clientSecret: 'secret-client-long' },
    twitch: { accessToken: 'jeton-acces-long', refreshToken: 'jeton-rafraichir', scope: ['chat:read'] },
    connecteurs: { spotify: { clientId: 'id-spotify-public', refreshToken: 'spotify-rafraichir' } },
    modules: { valorant: { region: 'europe-ouest', compte: { puuid: 'identifiant-riot' } } },
  });
  for (const s of ['secret-client-long', 'jeton-acces-long', 'jeton-rafraichir', 'spotify-rafraichir']) {
    assert.ok(v.includes(s), s);
  }
  // Tout ce qu'un module range dans ses secrets est secret, quel que soit le nom.
  assert.ok(v.includes('europe-ouest') && v.includes('identifiant-riot'));
  assert.ok(!v.includes('id-client-public') && !v.includes('id-spotify-public'));
});

// --- Le rapport qui part -------------------------------------------------------

test('un rapport envoye : un fil nomme, les mentions coupees, le journal et le rapport joints', async () => {
  const { s, discord, dossiers } = monter();
  const aujourdhui = jourDe(new Date());
  writeFileSync(
    join(dossiers.journaux, aujourdhui + '.log'),
    '2026-09-22T19:40:03Z [erreur] [roue-rl] récompense introuvable\n'
  );
  writeFileSync(join(dossiers.etats, 'roue-rl.json'), JSON.stringify({ possedees: [] }));

  const r = await s.envoyer({
    ...DEMANDE,
    description: DEMANDE.description + ' @everyone',
    pieces: [piece('image.png', 1000)],
  });

  assert.equal(r.ok, true);
  assert.match(r.reference, /^SK-[0-9A-F]{4}$/);
  assert.equal(discord.envois.length, 1);

  const { url, payload, fichiers } = discord.envois[0];
  assert.match(url, /\?wait=true$/);
  assert.match(payload.thread_name, /^Random Car — Un viewer a pris la récompense/);
  assert.ok(payload.thread_name.length <= 100);
  // Personne ne fait sonner tout le serveur depuis sa description.
  assert.deepEqual(payload.allowed_mentions, { parse: [] });

  const embed = payload.embeds[0];
  assert.match(embed.title, /Random Car › Overlay : Machine à sous/);
  assert.match(embed.description, /rien ne s’est affiché/);
  assert.equal(embed.color, 0xf59e0b, 'une ligne « attention » colore le message en orange');
  const champ = (nom) => embed.fields.find((f) => f.name === nom)?.value;
  assert.equal(champ('Sources OBS'), 'Machine à sous : 0');
  assert.equal(champ('Streamer'), 'kouss');
  assert.match(embed.footer.text, new RegExp(r.reference));

  assert.deepEqual(
    fichiers.map((f) => f.nom),
    ['rapport-' + r.reference + '.md', 'journal-' + aujourdhui + '.log', 'etat-roue-rl.json', 'image.png']
  );
  assert.deepEqual(
    payload.attachments.map((a) => a.filename),
    fichiers.map((f) => f.nom)
  );

  const rapport = texteDe(discord.envois[0], 'rapport-');
  assert.match(rapport, /PAS confirmé par Twitch/);
  assert.match(rapport, /← partie signalée/);
  assert.match(rapport, /"voituresCochees": 0/);
  assert.match(rapport, /"contexte": "vivant"/);
  assert.match(rapport, /\[attention\] Random Car — aucune voiture cochée/);
  assert.match(rapport, /Tirages 3 \(session\) \/ 45/);
  // Un secret de reglage n'est jamais qu'un temoin dans le rapport.
  assert.match(rapport, /"cleSecrete": "__inchange__"/);
});

test('aucun secret ne sort, meme ecrit dans le journal, par un diagnostic ou colle par erreur', async () => {
  const secrets = {
    twitchApp: { clientId: 'id-client-public', clientSecret: 'secret-client-TRES-long' },
    twitch: { accessToken: 'jeton-acces-TRES-long', refreshToken: 'jeton-rafraichir-TRES-long' },
    modules: { valorant: { cleApi: 'cle-api-du-module-XYZ' } },
  };
  const { s, discord, dossiers } = monter({
    secrets,
    modules: [
      moduleRoue({
        manifeste: {
          async diagnostic() {
            return { fuite: 'secret-client-TRES-long', autre: 'cle-api-du-module-XYZ' };
          },
        },
      }),
    ],
  });
  writeFileSync(
    join(dossiers.journaux, jourDe(new Date()) + '.log'),
    'x [erreur] [twitch] refresh_token=jeton-rafraichir-TRES-long a echoue\n' +
      'x [debug] [twitch] jeton jeton-acces-TRES-long relu\n' +
      'x [debug] [musique] Authorization: Bearer abcdefghijklmnop\n'
  );

  const r = await s.envoyer({
    ...DEMANDE,
    description: 'Je te colle mon jeton : jeton-acces-TRES-long, ça marche pas.',
  });
  assert.equal(r.ok, true);

  const envoi = discord.envois[0];
  const sortie = [JSON.stringify(envoi.payload), ...envoi.fichiers.map((f) => f.texte ?? '')].join('\n');
  for (const secret of [
    'secret-client-TRES-long',
    'jeton-acces-TRES-long',
    'jeton-rafraichir-TRES-long',
    'cle-api-du-module-XYZ',
    'abcdefghijklmnop',
  ]) {
    assert.ok(!sortie.includes(secret), 'fuite : ' + secret);
  }
  assert.match(sortie, /<masqu/);
  assert.match(texteDe(envoi, 'rapport-'), /id-client-public|kouss_tv/, 'le reste du rapport est intact');
});

test('le titre du fil raccourcit la description, jamais le module ni le pseudo', async () => {
  const { s, discord } = monter();
  await s.envoyer({ ...DEMANDE, description: 'Rien ne marche '.repeat(20) });
  const nom = discord.envois[0].payload.thread_name;
  assert.ok(nom.length <= 100, nom.length + ' caracteres');
  assert.match(nom, /^Random Car — Rien ne marche .*… · kouss$/);
});

// --- Salon texte ou Forum ------------------------------------------------------

test('salon texte : Discord refuse le fil, le rapport repart sans, et la suite de la session aussi', async () => {
  const discord = fauxDiscord([
    { status: 400, corps: { code: 220003, message: 'Webhooks can only create threads in forum channels' } },
  ]);
  const { s } = monter({ discord });

  assert.equal((await s.envoyer(DEMANDE)).ok, true);
  assert.equal(discord.envois.length, 2);
  assert.ok(discord.envois[0].payload.thread_name);
  assert.equal(discord.envois[1].payload.thread_name, undefined);

  // Appris une fois pour toutes : le rapport suivant part directement sans fil.
  assert.equal((await s.envoyer(DEMANDE)).ok, true);
  assert.equal(discord.envois.length, 3);
  assert.equal(discord.envois[2].payload.thread_name, undefined);
});

test('forum : ce qui ne tient pas dans un message suit dans le meme fil', async () => {
  const { s, discord } = monter();
  const pieces = [1, 2, 3, 4, 5].map((i) => piece('capture-' + i + '.png', 3 * 1024 * 1024));

  const r = await s.envoyer({ ...DEMANDE, pieces });
  assert.equal(r.ok, true);
  assert.ok(discord.envois.length >= 3, discord.envois.length + ' message(s)');

  const [premier, ...suites] = discord.envois;
  assert.ok(premier.payload.thread_name);
  assert.match(premier.fichiers[0].nom, /^rapport-/, 'le rapport ouvre toujours le fil');
  for (const e of suites) {
    assert.match(e.url, /thread_id=fil-1/);
    assert.equal(e.payload.thread_name, undefined);
    assert.match(e.payload.content, new RegExp('Suite du rapport ' + r.reference));
  }
  for (const e of discord.envois) {
    assert.ok(e.fichiers.length <= MAX_FICHIERS_MESSAGE);
    assert.ok(e.fichiers.reduce((t, f) => t + f.taille, 0) <= BUDGET_MESSAGE);
  }
  const noms = discord.envois.flatMap((e) => e.fichiers.map((f) => f.nom));
  for (const p of pieces) assert.ok(noms.includes(p.nom), p.nom);
});

test('Discord demande de patienter : on attend ce qu il dit, et on renvoie', async () => {
  const attentes = [];
  const discord = fauxDiscord([{ status: 429, corps: { retry_after: 2.5 } }]);
  const { s } = monter({ discord, attendre: async (ms) => attentes.push(ms) });

  assert.equal((await s.envoyer(DEMANDE)).ok, true);
  assert.deepEqual(attentes, [2500]);
  assert.equal(discord.envois.length, 2);
});

// --- Quand ca ne part pas ---------------------------------------------------------

test('webhook supprime : le rapport reste sur le PC, et le dossier s ouvre', async () => {
  const ouverts = [];
  const discord = fauxDiscord([{ status: 404, corps: { code: 10015, message: 'Unknown Webhook' } }]);
  const { s } = monter({
    discord,
    ouvrir: async (d) => {
      ouverts.push(d);
      return ''; // shell.openPath : chaine vide = ouvert
    },
  });

  const r = await s.envoyer({ ...DEMANDE, pieces: [piece('capture-1.png', 500)] });
  assert.equal(r.ok, false);
  assert.match(r.raison, /n’existe plus/);
  assert.equal(r.ouvrable, true);
  assert.ok(existsSync(r.dossier));
  const contenu = readdirSync(r.dossier);
  for (const f of ['rapport-' + r.reference + '.md', 'capture-1.png', 'LISEZ-MOI.txt'])
    assert.ok(contenu.includes(f), f);
  assert.match(readFileSync(join(r.dossier, 'LISEZ-MOI.txt'), 'utf8'), /n’existe plus/);

  assert.deepEqual(await s.ouvrirDossier(r.reference), { ok: true, dossier: r.dossier });
  assert.deepEqual(ouverts, [r.dossier]);
  // Le dashboard ne donne qu'une reference : jamais un chemin a ouvrir.
  assert.equal((await s.ouvrirDossier('C:\\Windows')).ok, false);
});

test('Discord injoignable : meme chose, avec une raison que le streamer comprend', async () => {
  const discord = fauxDiscord([{ lever: new TypeError('fetch failed') }]);
  const { s } = monter({ discord });
  const r = await s.envoyer(DEMANDE);
  assert.equal(r.ok, false);
  assert.match(r.raison, /injoignable/);
  assert.ok(existsSync(r.dossier));
});

test('une version construite sans adresse enregistre, et n envoie jamais rien', async () => {
  const { s, discord } = monter({ cible: null });
  const r = await s.envoyer(DEMANDE);
  assert.equal(r.ok, false);
  assert.equal(discord.envois.length, 0);
  assert.ok(existsSync(r.dossier));
  assert.equal(r.ouvrable, false, 'pas d explorateur en ligne de commande');
});

test('un rapport parti a moitie est « envoye », avec une copie complete sur le PC', async () => {
  const discord = fauxDiscord([
    { status: 200, corps: { channel_id: 'fil-1' } },
    { status: 500, corps: {} },
  ]);
  const { s } = monter({ discord });
  const r = await s.envoyer({
    ...DEMANDE,
    pieces: [1, 2, 3].map((i) => piece('c' + i + '.png', 3 * 1024 * 1024)),
  });
  assert.equal(r.ok, true);
  assert.match(r.partiel, /500/);
  assert.equal(readdirSync(r.dossier).filter((f) => f.endsWith('.png')).length, 3);
});

// --- Ce que le streamer saisit -----------------------------------------------------

test('description trop courte, module inconnu, trop de pieces, piece trop lourde : refuses', async () => {
  const { s, discord } = monter();
  assert.equal(
    (await s.envoyer({ ...DEMANDE, description: 'marche pas' })).ok,
    true,
    '10 caracteres suffisent'
  );
  assert.match((await s.envoyer({ ...DEMANDE, description: '  bug  ' })).erreur, /quelques mots/);
  assert.match((await s.envoyer({ ...DEMANDE, module: 'inexistant' })).erreur, /Module inconnu/);
  assert.match(
    (
      await s.envoyer({
        ...DEMANDE,
        pieces: Array.from({ length: 7 }, (_, i) => piece('p' + i + '.png', 10)),
      })
    ).erreur,
    /6 pièces jointes au plus/
  );
  assert.match(
    (await s.envoyer({ ...DEMANDE, pieces: [piece('film.mp4', 9 * 1024 * 1024)] })).erreur,
    /dépasse/
  );
  assert.equal(discord.envois.length, 1, 'seul le premier rapport, valide, est parti');
});

test('un rapport a la fois, et pas deux coup sur coup', async () => {
  let relacher;
  const lent = {
    envois: [],
    envoyerHttp: () =>
      new Promise((ok) => {
        relacher = () => ok({ status: 200, ok: true, json: async () => ({ channel_id: 'f' }) });
      }),
  };
  const { s } = monter({ discord: lent, intervalleMinMs: 15000 });

  const premier = s.envoyer(DEMANDE);
  await new Promise((ok) => {
    setTimeout(ok, 50);
  });
  assert.match((await s.envoyer(DEMANDE)).erreur, /déjà en cours/);
  relacher();
  assert.equal((await premier).ok, true);
  assert.match((await s.envoyer(DEMANDE)).erreur, /Patiente/);
});

// --- Journaux -------------------------------------------------------------------------

test('journal : la veille est jointe pour « hier », et apres minuit', async () => {
  const dossiers = nouveauxDossiers();
  for (const j of ['2026-09-21', '2026-09-22']) writeFileSync(join(dossiers.journaux, j + '.log'), j + '\n');
  const joints = async (heure, quand) => {
    const { s } = monter({ dossiers, maintenant: () => new Date(2026, 8, 22, heure, 30) });
    const r = await s.apercu({ ...DEMANDE, quand });
    return r.fichiers.filter((f) => f.nom.startsWith('journal-')).map((f) => f.nom);
  };
  assert.deepEqual(await joints(21, 'instant'), ['journal-2026-09-22.log']);
  assert.deepEqual(await joints(21, 'aujourdhui'), ['journal-2026-09-22.log']);
  assert.deepEqual(await joints(21, 'hier'), ['journal-2026-09-21.log', 'journal-2026-09-22.log']);
  // 1 h 30 du matin : le live d'hier soir est dans le fichier d'hier.
  assert.deepEqual(await joints(1, 'instant'), ['journal-2026-09-21.log', 'journal-2026-09-22.log']);
});

test('un journal enorme garde sa fin, coupee a une fin de ligne', async () => {
  const { s, discord, dossiers } = monter();
  const lignes = [];
  for (let i = 0; i < 150000; i++) lignes.push('ligne ' + i + ' — é — é — é');
  writeFileSync(join(dossiers.journaux, jourDe(new Date()) + '.log'), lignes.join('\n') + '\n');

  await s.envoyer(DEMANDE);
  const journal = discord.envois.flatMap((e) => e.fichiers).find((f) => f.nom.startsWith('journal-'));
  assert.ok(journal.taille <= MAX_OCTETS_JOURNAL + 100);
  assert.match(journal.texte, /^\[… début du journal retiré : fichier trop long …\]\nligne \d+ /);
  assert.ok(journal.texte.endsWith(lignes.at(-1) + '\n'));
});

// --- Diagnostic des modules -------------------------------------------------------------

test('module arrete : diagnostic sur un contexte jetable, nettoye ensuite, sans sante', async () => {
  const jetables = [];
  const { s } = monter({
    modules: [moduleRoue({ etat: 'arrete', actif: false, demarreA: null })],
    contextes: {},
    jetables,
  });
  const r = await s.apercu(DEMANDE);
  assert.match(r.rapport, /"contexte": "jetable"/);
  assert.match(r.rapport, /\*\*État\*\* : désactivé/);
  assert.doesNotMatch(r.rapport, /Sa ligne de la vue d’ensemble/);
  assert.equal(jetables.length, 1);
  assert.equal(jetables[0].nettoye, true);
});

test('un diagnostic qui plante, ou ne repond jamais, ne bloque pas le rapport', async () => {
  const plante = monter({
    modules: [
      moduleRoue({
        manifeste: {
          diagnostic: async () => {
            throw new Error('boum');
          },
        },
      }),
    ],
  });
  assert.match((await plante.s.apercu(DEMANDE)).rapport, /diagnostic illisible : boum/);

  const fige = monter({
    delaiDiagnosticMs: 50,
    modules: [moduleRoue({ manifeste: { diagnostic: () => new Promise(() => {}) } })],
  });
  assert.match((await fige.s.apercu(DEMANDE)).rapport, /diagnostic illisible : pas de réponse/);
});

test('apercu : ce qui partira, sans reference reelle ni piece, et sans rien envoyer', async () => {
  const { s, discord, dossiers } = monter();
  writeFileSync(join(dossiers.etats, 'roue-rl.json'), '{}');
  const r = await s.apercu({ ...DEMANDE, pieces: [piece('ignoree.png', 10)] });
  assert.equal(r.ok, true);
  assert.equal(r.envoiPossible, true);
  assert.deepEqual(
    r.fichiers.map((f) => f.court),
    ['état du module et de StreamKit', 'mémoire du module']
  );
  assert.match(r.rapport, /^# Rapport SK-···· — 🎡 Random Car/);
  assert.equal(discord.envois.length, 0);
});

test('« StreamKit en general » : pas de module, mais tout le reste', async () => {
  const { s, discord } = monter();
  const r = await s.envoyer({
    ...DEMANDE,
    module: 'general',
    partie: 'twitch',
    partieLibelle: 'Connexion Twitch',
  });
  assert.equal(r.ok, true);
  const { payload } = discord.envois[0];
  assert.match(payload.thread_name, /^StreamKit — /);
  assert.match(payload.embeds[0].title, /StreamKit en général › Connexion Twitch/);
  const rapport = texteDe(discord.envois[0], 'rapport-');
  assert.match(rapport, /## Twitch/);
  assert.match(rapport, /\| Random Car \(`roue-rl`\) \| oui \| démarré/);
});

// --- Le vrai fetch, contre un vrai serveur ----------------------------------------------

test(
  'multipart reel : un serveur HTTP recoit un formulaire que Discord sait lire',
  { timeout: 10000 },
  async () => {
    const recus = [];
    const serveur = http.createServer((req, res) => {
      const morceaux = [];
      req.on('data', (c) => morceaux.push(c));
      req.on('end', async () => {
        const form = await new Response(Buffer.concat(morceaux), {
          headers: { 'content-type': req.headers['content-type'] },
        }).formData();
        recus.push({ url: req.url, form });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: '1', channel_id: 'fil-9' }));
      });
    });
    await new Promise((ok) => {
      serveur.listen(0, '127.0.0.1', ok);
    });
    try {
      const cible = 'http://127.0.0.1:' + serveur.address().port + '/api/webhooks/1/jeton';
      const { s } = monter({ cible, envoyerHttp: undefined });
      const r = await s.envoyer({ ...DEMANDE, pieces: [piece('capture-1.png', 2048)] });
      assert.equal(r.ok, true);

      assert.equal(recus.length, 1);
      const { url, form } = recus[0];
      assert.equal(url, '/api/webhooks/1/jeton?wait=true');
      const payload = JSON.parse(form.get('payload_json'));
      assert.ok(payload.thread_name && payload.embeds.length === 1);
      assert.equal(form.get('files[0]').name, 'rapport-' + r.reference + '.md');
      const capture = [...form.values()].find((v) => v.name === 'capture-1.png');
      assert.equal(capture.size, 2048);
    } finally {
      serveur.close();
    }
  }
);
