// « Signaler un bug » : ce que le streamer envoie quand ca ne marche pas.
//
// Avant, le support passait par des captures du stream et un « tu peux
// m'envoyer ton journal ? » -- le fichier est chez lui, dans
// %APPDATA%\StreamKit\journaux, et il fallait lui expliquer ou le trouver, puis
// lui redemander ses reglages, puis si la source OBS etait bien branchee... Le
// rapport reunit en un clic ce qu'on lui demandait a chaque fois :
//
//   - ce qu'il raconte, et ses captures ;
//   - le journal du jour (et celui de la veille si besoin) ;
//   - le module concerne : etat, reglages (secrets masques), sources OBS
//     branchees sur chacun de ses overlays, abonnements Twitch, sa ligne de la
//     vue d'ensemble, sa memoire, et ce que son diagnostic() sait de plus ;
//   - StreamKit : version, Windows, Twitch, connecteurs, les autres modules.
//
// Il part dans un salon Discord prive, par un webhook -- un fil par rapport si
// le salon est un Forum. S'il ne peut pas partir (pas de reseau, webhook
// supprime, version construite sans adresse), il est enregistre sur le PC et le
// dashboard propose d'ouvrir le dossier : le streamer l'envoie alors a la main.
//
// JAMAIS un secret. Les reglages passent par masquerSecrets (comme dans le
// dashboard), le texte par le masquage du journal, et en dernier filet toute
// valeur secrete de tokens.json est remplacee avant l'envoi -- meme si un module
// l'avait ecrite quelque part ou il n'aurait pas du.
//
// Tout ce qui bouge est INJECTE par le noyau, comme pour core/sante.js : un test
// fournit son faux registre, son faux Twitch et son faux Discord.

import os from 'node:os';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ETAT_DIR, JOURNAUX_DIR, SIGNALEMENTS_DIR } from './paths.js';
import * as journal from './journal.js';
import * as maj from './maj.js';
import { debrouiller, estWebhookDiscord } from './brouillage.js';

const log = journal.pour('signalement');

// --- Limites -----------------------------------------------------------------
//
// Discord limite la taille d'un envoi (10 Mo sur un serveur sans boost depuis
// 2025) et le nombre de fichiers par message (10). On reste en dessous, et un
// rapport trop lourd pour un message part en plusieurs, dans le meme fil.
export const MAX_PIECES = 6;
export const MAX_OCTETS_PIECE = 8 * 1024 * 1024;
export const MAX_OCTETS_TOTAL = 24 * 1024 * 1024;
export const BUDGET_MESSAGE = 8 * 1024 * 1024;
export const MAX_FICHIERS_MESSAGE = 10;
// Un journal de plusieurs Mo, c'est une boucle qui s'emballe : sa fin suffit.
export const MAX_OCTETS_JOURNAL = 3 * 1024 * 1024;
const MAX_OCTETS_MEMOIRE = 1024 * 1024;

const LONGUEUR_MIN_DESCRIPTION = 10;
const LONGUEUR_MAX_DESCRIPTION = 4000;

// Un rapport fait apres minuit parle souvent du live de la veille au soir.
const HEURE_BASCULE = 6;

const DELAI_ENVOI_MS = 60000;
const DELAI_DIAGNOSTIC_MS = 8000;
// Un double clic, ou un streamer qui insiste parce que « ca ne fait rien » :
// un seul rapport a la fois, et un peu d'air entre deux.
const INTERVALLE_MIN_MS = 15000;
const RETENTION_JOURS = 30;

export const QUAND = {
  instant: 'À l’instant',
  aujourdhui: 'Plus tôt aujourd’hui',
  hier: 'Hier',
};

// La gravite en tete du message, faute de bordure coloree : le texte d'un
// message Discord ne porte pas de couleur.
const MARQUE = { ko: '🔴', attention: '🟠', normal: '🐞' };
// 2000 caracteres chez Discord, avec de la marge.
const MAX_CONTENU = 1900;

// Codes d'erreur Discord qui disent de quel genre de salon il s'agit.
const FORUM_EXIGE_UN_FIL = 220001;
const FIL_HORS_FORUM = 220003;

// --- L'adresse du salon ------------------------------------------------------
//
// Jamais dans le depot : scripts/cible-signalement.mjs la glisse, brouillee,
// dans l'installeur au moment de la construction. Sur le PC de developpement,
// STREAMKIT_WEBHOOK_BUGS suffit (npm start, npm run dev).
const FICHIER_CIBLE = join(dirname(fileURLToPath(import.meta.url)), 'signalement-cible.json');

export function lireCible({ env = process.env, fichier = FICHIER_CIBLE } = {}) {
  let url = String(env.STREAMKIT_WEBHOOK_BUGS ?? '').trim();
  if (!url) {
    try {
      const { cible } = JSON.parse(readFileSync(fichier, 'utf8'));
      url = cible ? debrouiller(cible) : '';
    } catch {
      return null; // version construite sans adresse : rapports enregistres sur le PC
    }
  }
  return estWebhookDiscord(url) ? url : null;
}

// --- Petits outils -----------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const jourDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function duree(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + ' s';
  const min = Math.floor(s / 60);
  if (min < 60) return min + ' min';
  return Math.floor(min / 60) + ' h ' + pad(min % 60);
}

function taille(octets) {
  if (octets < 1024) return octets + ' o';
  if (octets < 1024 * 1024) return Math.round(octets / 1024) + ' Ko';
  return (octets / 1048576).toFixed(1).replace('.', ',') + ' Mo';
}

const tronquer = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// Un diagnostic de module peut rendre n'importe quoi : un objet circulaire ne
// doit pas faire echouer tout le rapport.
const json = (v) => {
  try {
    return JSON.stringify(v, null, 2) ?? 'null';
  } catch (e) {
    return '"(illisible : ' + (e?.message || e) + ')"';
  }
};

// Nom de fichier sans danger : il finit sur le disque du streamer si l'envoi
// echoue, et dans Discord sinon. Ni chemin, ni nom reserve de Windows.
export function nomDeFichier(nom, repli = 'piece') {
  let propre = String(nom ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._() -]+/gu, '_')
    .replace(/^[.\s_]+/, '')
    .trim();
  if (propre.length > 80) propre = propre.slice(propre.length - 80);
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(propre)) propre = '_' + propre;
  return propre || repli;
}

// Deux captures nommees « image.png » ne doivent pas s'ecraser.
function dedoublonner(fichiers) {
  const vus = new Set();
  for (const f of fichiers) {
    let nom = f.nom;
    for (let i = 2; vus.has(nom.toLowerCase()); i++) {
      const point = f.nom.lastIndexOf('.');
      nom = point > 0 ? f.nom.slice(0, point) + '-' + i + f.nom.slice(point) : f.nom + '-' + i;
    }
    vus.add(nom.toLowerCase());
    f.nom = nom;
  }
  return fichiers;
}

const typeSur = (t) =>
  /^[\w.+-]+\/[\w.+-]+$/.test(String(t ?? '')) ? String(t) : 'application/octet-stream';

// Une promesse qui ne peut pas faire attendre le rapport indefiniment : un
// diagnostic qui interroge un jeu fige ne doit pas bloquer l'envoi.
function borner(fn, ms = DELAI_DIAGNOSTIC_MS) {
  let minuteur;
  return Promise.race([
    Promise.resolve().then(fn),
    new Promise((_, rejeter) => {
      minuteur = setTimeout(() => rejeter(new Error('pas de réponse en ' + ms / 1000 + ' s')), ms);
    }),
  ]).finally(() => clearTimeout(minuteur));
}

// Les valeurs de tokens.json qui ne doivent jamais sortir : secrets et jetons
// du socle, et TOUT ce qu'un module range dans ses secrets (ctx.secrets).
const CLES_SECRETES = /secret|token|password|motdepasse|cle|key/i;

export function valeursSecretes(tokens) {
  const out = new Set();
  const parcourir = (v, cle, dansModules) => {
    if (typeof v === 'string') {
      if (v.length >= 8 && (dansModules || CLES_SECRETES.test(cle))) out.add(v);
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) parcourir(x, k, dansModules || cle === 'modules');
    }
  };
  parcourir(tokens ?? {}, '', false);
  return [...out];
}

function expurger(texte, secrets) {
  let t = journal.masquer(String(texte));
  for (const s of secrets) t = t.split(s).join('<masqué>');
  return t;
}

// --- Le rapport --------------------------------------------------------------

export function creerSignalement({
  registre,
  twitch,
  diffusion,
  compteurs,
  sante = async () => null,
  connecteurs = () => [],
  // Le contexte d'un module demarre ; pour un module arrete, un contexte
  // jetable (le noyau sait en fabriquer un, voir executerAction).
  contexteDe = () => undefined,
  contexteJetable = () => null,
  config = () => ({}),
  secrets = () => ({}),
  cible = null,
  // Ouvre un dossier dans l'explorateur (shell.openPath sous Electron) ; absent
  // en ligne de commande.
  ouvrir = null,
  envoyerHttp = (url, options) => fetch(url, options),
  attendre = (ms) =>
    new Promise((ok) => {
      setTimeout(ok, ms);
    }),
  maintenant = () => new Date(),
  dossiers = { journaux: JOURNAUX_DIR, etats: ETAT_DIR, signalements: SIGNALEMENTS_DIR },
  delaiDiagnosticMs = DELAI_DIAGNOSTIC_MS,
  intervalleMinMs = INTERVALLE_MIN_MS,
}) {
  let enCours = false;
  let dernierEnvoi = 0;
  // Salon Forum ou salon texte : appris au premier envoi (voir posterLot).
  let modeForum = null;
  // Rapports enregistres sur ce PC depuis le lancement : reference -> dossier.
  // Le dashboard ne donne qu'une reference, jamais un chemin a ouvrir.
  const enregistres = new Map();

  // --- Ce que le streamer a saisi ------------------------------------------

  function lireDemande(corps = {}, { pourEnvoi = false } = {}) {
    const erreurs = [];
    const idModule = String(corps.module ?? '').trim();
    const m = idModule && idModule !== 'general' ? registre.get(idModule) : null;
    if (idModule && idModule !== 'general' && !m) erreurs.push('Module inconnu.');

    const description = String(corps.description ?? '').trim();
    if (pourEnvoi && description.length < LONGUEUR_MIN_DESCRIPTION) {
      erreurs.push(
        'Décris ton problème en quelques mots (' + LONGUEUR_MIN_DESCRIPTION + ' caractères au moins).'
      );
    }
    if (description.length > LONGUEUR_MAX_DESCRIPTION) {
      erreurs.push('Description trop longue (' + LONGUEUR_MAX_DESCRIPTION + ' caractères au plus).');
    }

    const pieces = [];
    let total = 0;
    const brutes = Array.isArray(corps.pieces) ? corps.pieces : [];
    if (brutes.length > MAX_PIECES) erreurs.push(MAX_PIECES + ' pièces jointes au plus.');
    for (const [i, p] of brutes.slice(0, MAX_PIECES).entries()) {
      // Du base64 nu ; une adresse « data:...;base64, » entiere passe aussi.
      const contenu = Buffer.from(String(p?.donnees ?? '').replace(/^data:[^,]*,/, ''), 'base64');
      const nom = nomDeFichier(p?.nom, 'piece-' + (i + 1));
      if (!contenu.length) continue;
      if (contenu.length > MAX_OCTETS_PIECE) {
        erreurs.push('« ' + nom + ' » dépasse ' + taille(MAX_OCTETS_PIECE) + '.');
        continue;
      }
      total += contenu.length;
      pieces.push({ nom, type: typeSur(p?.type), contenu, quoi: 'pièce jointe', piece: true });
    }
    if (total > MAX_OCTETS_TOTAL)
      erreurs.push('Pièces jointes trop lourdes (' + taille(MAX_OCTETS_TOTAL) + ' au total).');

    return {
      erreurs,
      demande: {
        module: m,
        partie: String(corps.partie ?? '').slice(0, 80),
        partieLibelle: String(corps.partieLibelle ?? '')
          .trim()
          .slice(0, 80),
        quand: QUAND[corps.quand] ? corps.quand : 'instant',
        description,
        pseudo: String(corps.pseudo ?? '')
          .trim()
          .slice(0, 60),
        pieces,
      },
    };
  }

  // --- Ce que StreamKit sait -------------------------------------------------

  function infosGenerales(date) {
    const version = os.release();
    const build = Number(version.split('.')[2]) || 0;
    const systeme =
      process.platform === 'win32'
        ? (build >= 22000 ? 'Windows 11' : 'Windows 10') + ' (' + version + ')'
        : os.type() + ' ' + version;
    return {
      version: maj.versionActuelle(),
      systeme,
      architecture: os.arch(),
      electron: process.versions.electron ?? null,
      node: process.versions.node,
      lanceDepuis: duree(process.uptime() * 1000),
      memoire: Math.round(process.memoryUsage().rss / 1048576) + ' Mo',
      fuseau: Intl.DateTimeFormat().resolvedOptions().timeZone,
      date: date.toISOString(),
      dateLisible: date.toLocaleString('fr-FR'),
    };
  }

  function etatLisible(m, date) {
    if (!m.actif) return 'désactivé';
    if (m.etat === 'demarre') return 'démarré' + (m.demarreA ? ' depuis ' + duree(date - m.demarreA) : '');
    if (m.etat === 'erreur') return 'en erreur : ' + (m.erreur || '?');
    if (m.etat === 'incomplet') return 'incomplet : ' + (m.erreur || '?');
    return 'activé mais pas démarré';
  }

  async function diagnosticDe(m) {
    if (typeof m.manifeste.diagnostic !== 'function') return null;
    const ctx = contexteDe(m.id);
    const jetable = ctx ? null : contexteJetable(m);
    try {
      return (await borner(() => m.manifeste.diagnostic(ctx ?? jetable), delaiDiagnosticMs)) ?? null;
    } catch (e) {
      return { erreur: 'diagnostic illisible : ' + (e?.message || e) };
    } finally {
      jetable?._nettoyer?.();
    }
  }

  // Fraiche, pas celle de la vue d'ensemble (gardee 20 s) : c'est une photo.
  async function santeDe(m) {
    const ctx = contexteDe(m.id);
    if (!ctx || typeof m.manifeste.sante !== 'function') return null;
    try {
      return (await borner(() => m.manifeste.sante(ctx), delaiDiagnosticMs)) ?? [];
    } catch (e) {
      return [{ nom: m.manifeste.nom, etat: 'ko', detail: 'état illisible', aide: e?.message || String(e) }];
    }
  }

  function memoireDe(id) {
    const chemin = join(dossiers.etats, id + '.json');
    try {
      const st = statSync(chemin);
      if (st.size > MAX_OCTETS_MEMOIRE) return { trop: st.size };
      return { contenu: readFileSync(chemin) };
    } catch {
      return null; // le module n'a jamais rien memorise
    }
  }

  function journauxPour(quand, date) {
    const veille = new Date(date);
    veille.setDate(veille.getDate() - 1);
    const jours = [jourDe(date)];
    if (quand === 'hier' || date.getHours() < HEURE_BASCULE) jours.unshift(jourDe(veille));

    const fichiers = [];
    for (const jour of jours) {
      let contenu;
      try {
        contenu = readFileSync(join(dossiers.journaux, jour + '.log'));
      } catch {
        continue; // StreamKit n'a pas tourne ce jour-la
      }
      if (contenu.length > MAX_OCTETS_JOURNAL) {
        // On coupe a une fin de ligne : un caractere accentue coupe en deux
        // donnerait une premiere ligne illisible.
        const debut = contenu.indexOf(0x0a, contenu.length - MAX_OCTETS_JOURNAL) + 1;
        contenu = Buffer.concat([
          Buffer.from('[… début du journal retiré : fichier trop long …]\n'),
          contenu.subarray(debut),
        ]);
      }
      const [a, mo, j] = jour.split('-');
      fichiers.push({
        nom: 'journal-' + jour + '.log',
        type: 'text/plain; charset=utf-8',
        contenu,
        quoi: 'journal du ' + j + '/' + mo + '/' + a,
        court: 'journal du ' + j + '/' + mo,
        texte: true,
      });
    }
    return fichiers;
  }

  const ligneJournal = (e, avecSource) =>
    e.h + ' [' + e.niveau + ']' + (avecSource ? ' [' + e.source + ']' : '') + ' ' + e.message;

  async function detailDuModule(m, demande, date) {
    const vue = registre.vue(m.id);
    const overlays = (m.manifeste.overlays ?? []).map((o) => ({
      cle: 'overlay:' + o.chemin,
      nom: o.nom,
      adresse: '/overlay/' + m.id + '/' + o.chemin,
      masque: !!o.masque,
      sources: diffusion.nbClients('overlay:' + m.id + ':' + o.chemin),
    }));
    return {
      m,
      vue,
      etat: etatLisible(m, date),
      overlays,
      sante: await santeDe(m),
      diagnostic: await diagnosticDe(m),
      abonnements: (twitch.abonnements?.() ?? []).filter((a) => a.modules.includes(m.id)),
      compteurs: m.manifeste.compteurs ? compteurs.pour(m.id) : null,
      alertes: journal.historique({ source: m.id, niveau: 'avert', limite: 30 }),
      dernieres: journal.historique({ source: m.id, limite: 40 }),
      memoire: memoireDe(m.id),
      overlayVise: overlays.find((o) => o.cle === demande.partie) ?? null,
    };
  }

  // --- Mise en forme -----------------------------------------------------------

  function libelleModule(d) {
    if (!d) return 'StreamKit en général';
    return (d.vue?.icone ? d.vue.icone + ' ' : '') + d.m.manifeste.nom;
  }

  function markdown(r) {
    const { demande: dm, general: g, detail: d, twitchEtat: t } = r;
    const L = [];
    const titre = libelleModule(d) + (dm.partieLibelle ? ' › ' + dm.partieLibelle : '');
    L.push('# Rapport ' + r.reference + ' — ' + titre, '');
    L.push('- **Envoyé** : ' + g.dateLisible + ' (' + g.fuseau + ')');
    L.push('- **Quand** : ' + QUAND[dm.quand]);
    L.push('- **Streamer** : ' + (dm.pseudo || '—') + ' · chaîne Twitch : ' + (r.chaine || 'non configurée'));
    L.push(
      '- **StreamKit** : ' +
        g.version +
        ' · ' +
        g.systeme +
        ' · ' +
        g.architecture +
        (g.electron ? ' · Electron ' + g.electron : ' · Node ' + g.node) +
        ' · lancé depuis ' +
        g.lanceDepuis +
        ' · ' +
        g.memoire
    );
    L.push('', '> L’état ci-dessous est une photo prise à l’envoi, pas au moment du problème.', '');
    L.push('## Ce qui s’est passé', '', dm.description || '(rien d’écrit)', '');

    if (d) {
      const v = d.vue;
      L.push('## Module : ' + libelleModule(d) + ' (`' + d.m.id + '`)', '');
      L.push('- **État** : ' + d.etat);
      if (v.manque?.length) L.push('- **Manque** : ' + v.manque.join(', '));
      if (d.memoire?.trop) {
        L.push('- **Mémoire** : ' + taille(d.memoire.trop) + ', trop lourde pour être jointe');
      }
      if (v.connecteurs?.length) {
        L.push(
          '- **Connecteurs** : ' +
            v.connecteurs.map((c) => c.nom + (c.connecte ? ' (connecté)' : ' (NON connecté)')).join(', ')
        );
      }
      if (v.scopes?.length) {
        // Twitch pas connecte : tous les droits « manquent », ce qui n'apprend
        // rien -- c'est la connexion qu'il faut regarder.
        const manquants = t.pret ? twitch.droitsManquants(v.scopes) : [];
        L.push(
          '- **Droits Twitch** : ' +
            v.scopes.join(', ') +
            (!t.pret
              ? ' (Twitch non connecté)'
              : manquants.length
                ? ' — MANQUANTS : ' + manquants.join(', ')
                : ' — tous accordés')
        );
      }
      for (const o of d.overlays) {
        L.push(
          '- **Overlay** ' +
            o.nom +
            ' (`' +
            o.adresse +
            '`)' +
            (o.masque ? ' [ancienne adresse]' : '') +
            ' : ' +
            o.sources +
            ' source(s) OBS connectée(s)' +
            (o === d.overlayVise ? ' ← partie signalée' : '')
        );
      }
      for (const a of d.abonnements) {
        L.push(
          '- **Abonnement Twitch** ' +
            a.quoi +
            ' (`' +
            a.nom +
            '`) : ' +
            (a.verifie ? 'confirmé par Twitch' : 'PAS confirmé par Twitch') +
            ', ' +
            a.gestionnaires +
            ' gestionnaire(s)'
        );
      }
      if (d.compteurs) {
        const libelles = d.m.manifeste.compteurs;
        L.push(
          '- **Compteurs** : ' +
            Object.entries(libelles)
              .map(
                ([cle, l]) =>
                  l +
                  ' ' +
                  (d.compteurs.session?.[cle] || 0) +
                  ' (session) / ' +
                  (d.compteurs.total?.[cle] || 0)
              )
              .join(' · ')
        );
      }
      L.push('');
      if (d.sante?.length) {
        L.push('### Sa ligne de la vue d’ensemble', '');
        for (const c of d.sante) {
          L.push(
            '- [' + c.etat + '] ' + (c.nom || '') + ' — ' + (c.detail || '') + (c.aide ? ' — ' + c.aide : '')
          );
        }
        L.push('');
      }
      if (d.diagnostic) L.push('### Diagnostic du module', '', '```json', json(d.diagnostic), '```', '');
      L.push('### Réglages (secrets masqués)', '', '```json', json(v.reglages ?? {}), '```', '');
      if (d.dernieres.length) {
        L.push(
          '### Ses dernières lignes de journal',
          '',
          '```',
          ...d.dernieres.map((e) => ligneJournal(e, false)),
          '```',
          ''
        );
      }
    }

    L.push('## Twitch', '');
    L.push(
      '- ' +
        (t.pret
          ? 'Connecté à « ' +
            t.channel +
            ' » (id ' +
            (t.broadcasterId || '?') +
            ') · chat ' +
            (t.chatConnecte ? 'connecté' : 'DÉCONNECTÉ') +
            ' · EventSub ' +
            (t.eventsubConnecte ? 'connecté' : 'DÉCONNECTÉ')
          : 'NON connecté : ' + (t.raison || '?') + (t.conseil ? ' (' + t.conseil + ')' : ''))
    );
    if (t.pret) L.push('- Droits accordés : ' + ((t.scopes ?? []).join(', ') || 'aucun'));
    L.push('- Droits manquants (modules activés) : ' + (r.droitsManquants.join(', ') || 'aucun'));
    if (r.abonnements.length) {
      L.push(
        '- Abonnements EventSub : ' +
          r.abonnements
            .map(
              (a) =>
                a.nom + (a.verifie ? '' : ' (non confirmé)') + (a.gestionnaires ? '' : ' (personne n’écoute)')
            )
            .join(', ')
      );
    }
    L.push('');

    if (r.vueEnsemble?.connexions?.length) {
      L.push('## Vue d’ensemble', '');
      for (const carte of r.vueEnsemble.connexions) {
        L.push('- **' + carte.nom + '** [' + carte.etat + ']');
        for (const l of carte.lignes)
          L.push('  - [' + l.etat + '] ' + l.nom + ' — ' + (l.detail || '') + (l.aide ? ' — ' + l.aide : ''));
      }
      L.push('');
    }

    if (r.connecteurs.length) {
      L.push('## Connecteurs', '');
      for (const c of r.connecteurs) {
        const statut = c.connecte ? 'connecté' : c.configure ? 'configuré, pas connecté' : 'non configuré';
        L.push('- ' + c.nom + ' : ' + statut + (c.detail && c.detail !== statut ? ' — ' + c.detail : ''));
      }
      L.push('');
    }

    L.push('## Tous les modules', '', '| Module | Activé | État |', '|---|---|---|');
    for (const m of registre.liste()) {
      L.push(
        '| ' +
          m.manifeste.nom +
          ' (`' +
          m.id +
          '`) | ' +
          (m.actif ? 'oui' : 'non') +
          ' | ' +
          etatLisible(m, r.date).replace(/\|/g, '/') +
          ' |'
      );
    }
    L.push('');

    if (r.alertes.length) {
      L.push(
        '## Dernières alertes, tous modules',
        '',
        '```',
        ...r.alertes.map((e) => ligneJournal(e, true)),
        '```',
        ''
      );
    }

    // Le rapport lui-meme ouvre la liste des fichiers : on ne liste que les
    // autres, il ne connait pas encore sa propre taille.
    L.push('## Autres fichiers joints', '');
    for (const f of r.fichiers.slice(1))
      L.push('- ' + f.nom + ' — ' + f.quoi + ' (' + taille(f.contenu.length) + ')');
    if (r.fichiers.length < 2) L.push('- aucun');
    return L.join('\n') + '\n';
  }

  function gravite(d) {
    if (!d) return 'normal';
    if (d.m.etat === 'erreur' || d.sante?.some((c) => c.etat === 'ko')) return 'ko';
    if (d.m.etat === 'incomplet' || d.sante?.some((c) => c.etat === 'attention')) return 'attention';
    return 'normal';
  }

  function resumeTwitch(t, manquants) {
    if (!t.pret) return 'non connecté : ' + (t.raison || '?');
    const canaux =
      t.chatConnecte && t.eventsubConnecte
        ? 'chat et EventSub connectés'
        : 'chat ' + (t.chatConnecte ? 'OK' : 'coupé') + ', EventSub ' + (t.eventsubConnecte ? 'OK' : 'coupé');
    return canaux + (manquants.length ? ' · ' + manquants.length + ' droit(s) manquant(s)' : '');
  }

  // Tout le resume tient dans le TEXTE du message, pas dans un encadre :
  // Discord affiche toujours les pieces jointes AVANT les encadres, et le
  // resume se retrouvait sous la capture et les deux fichiers -- on ouvrait un
  // rapport sans savoir de quoi il parlait. Le texte, lui, passe devant.
  function messageDiscord(r) {
    const { demande: dm, general: g, detail: d } = r;
    const titre = libelleModule(d) + (dm.partieLibelle ? ' › ' + dm.partieLibelle : '');
    const entete = MARQUE[gravite(d)] + ' **' + tronquer(titre, 150) + '** · réf. `' + r.reference + '`';

    const faits = [
      '**Streamer** ' +
        (dm.pseudo || r.chaine || '—') +
        ' · **Quand** ' +
        QUAND[dm.quand].toLowerCase() +
        ' · **StreamKit** ' +
        g.version +
        ' · ' +
        g.systeme.replace(/ \(.*\)$/, ''),
      '**Twitch** ' + resumeTwitch(r.twitchEtat, r.droitsManquants),
    ];
    if (d) {
      faits.push('**Module** ' + d.etat);
      const obs = d.overlayVise ? [d.overlayVise] : d.overlays.filter((o) => !o.masque);
      if (obs.length) faits.push('**Sources OBS** ' + obs.map((o) => o.nom + ' : ' + o.sources).join(' · '));
      const alerte = d.alertes.at(-1);
      if (alerte) faits.push('**Dernière alerte** ' + alerte.h + ' ' + alerte.message);
    }
    const blocFaits = tronquer(faits.join('\n'), 900);

    // Ce qui reste du message revient a la description ; son texte complet est
    // de toute facon dans le rapport joint.
    const composer = (max) =>
      [
        entete,
        '',
        tronquer(dm.description, max)
          .split('\n')
          .map((l) => '> ' + l)
          .join('\n'),
        '',
        blocFaits,
      ].join('\n');
    let contenu = composer(Math.max(120, MAX_CONTENU - entete.length - blocFaits.length - 8));
    if (contenu.length > MAX_CONTENU) contenu = composer(120);

    // Titre du fil (100 caracteres chez Discord) : c'est la description qu'on
    // raccourcit, jamais le module ni le pseudo -- ce sont eux qu'on cherche
    // dans la liste des fils.
    const debut = (d ? d.m.manifeste.nom : 'StreamKit') + ' — ';
    const fin = ' · ' + tronquer(dm.pseudo || r.chaine || '?', 30);
    return {
      titreFil: debut + tronquer(dm.description.replace(/\s+/g, ' '), 100 - debut.length - fin.length) + fin,
      payload: {
        username: 'StreamKit',
        // Personne ne doit pouvoir faire sonner tout le serveur avec un
        // « @everyone » glisse dans sa description.
        allowed_mentions: { parse: [] },
        content: contenu,
      },
    };
  }

  async function construire(
    demande,
    { reference = 'SK-' + randomBytes(2).toString('hex').toUpperCase() } = {}
  ) {
    const date = maintenant();
    const general = infosGenerales(date);
    const detail = demande.module ? await detailDuModule(demande.module, demande, date) : null;
    const twitchEtat = twitch.getEtat();

    let vueEnsemble = null;
    try {
      vueEnsemble = await borner(() => sante(), delaiDiagnosticMs);
    } catch (e) {
      log.debug('rapport : vue d’ensemble illisible (' + (e?.message || e) + ')');
    }

    const r = {
      reference,
      date,
      demande,
      general,
      detail,
      twitchEtat,
      chaine: config()?.twitch?.channel || '',
      droitsManquants: twitch.droitsManquants(registre.scopesRequis()),
      abonnements: twitch.abonnements?.() ?? [],
      vueEnsemble,
      connecteurs: connecteurs() ?? [],
      alertes: journal.historique({ niveau: 'avert', limite: 20 }),
      fichiers: [],
    };

    const annexes = journauxPour(demande.quand, date);
    if (detail?.memoire?.contenu) {
      annexes.push({
        nom: 'etat-' + detail.m.id + '.json',
        type: 'application/json; charset=utf-8',
        contenu: detail.memoire.contenu,
        quoi: 'mémoire du module',
        court: 'mémoire du module',
        texte: true,
      });
    }

    const rapport = {
      nom: 'rapport-' + reference + '.md',
      type: 'text/markdown; charset=utf-8',
      contenu: Buffer.alloc(0),
      quoi: 'le rapport : module, réglages (secrets masqués), diagnostic, Twitch',
      court: detail ? 'état du module et de StreamKit' : 'état de StreamKit',
      texte: true,
    };
    r.fichiers = dedoublonner([rapport, ...annexes, ...demande.pieces]);
    rapport.contenu = Buffer.from(markdown(r), 'utf8');

    // Dernier filet : aucun secret ne sort, meme ecrit par un module la ou il
    // n'aurait pas du. Les pieces du streamer (captures) restent intactes.
    const aMasquer = valeursSecretes(secrets());
    for (const f of r.fichiers) {
      if (f.texte) f.contenu = Buffer.from(expurger(f.contenu.toString('utf8'), aMasquer), 'utf8');
    }
    const message = messageDiscord(r);
    r.titreFil = expurger(message.titreFil, aMasquer);
    r.payload = JSON.parse(expurger(JSON.stringify(message.payload), aMasquer));
    return r;
  }

  // --- Discord -----------------------------------------------------------------

  // Plusieurs messages quand il le faut : 10 fichiers et un budget d'octets
  // par message. Le rapport et les journaux ouvrent toujours le premier.
  function repartir(fichiers) {
    const lots = [];
    let lot = [];
    let poids = 0;
    for (const f of fichiers) {
      if (lot.length && (lot.length >= MAX_FICHIERS_MESSAGE || poids + f.contenu.length > BUDGET_MESSAGE)) {
        lots.push(lot);
        lot = [];
        poids = 0;
      }
      lot.push(f);
      poids += f.contenu.length;
    }
    if (lot.length) lots.push(lot);
    return lots;
  }

  async function requete(payload, fichiers, { nomFil = null, idFil = null } = {}) {
    const form = new FormData();
    const corps = {
      ...payload,
      ...(nomFil ? { thread_name: nomFil } : {}),
      attachments: fichiers.map((f, i) => ({ id: i, filename: f.nom })),
    };
    form.append('payload_json', JSON.stringify(corps));
    fichiers.forEach((f, i) =>
      form.append('files[' + i + ']', new Blob([f.contenu], { type: f.type }), f.nom)
    );

    const url = cible + '?wait=true' + (idFil ? '&thread_id=' + encodeURIComponent(idFil) : '');
    for (let essai = 1; ; essai++) {
      let rep;
      try {
        rep = await envoyerHttp(url, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(DELAI_ENVOI_MS),
        });
      } catch (e) {
        throw new Error(
          e?.name === 'TimeoutError'
            ? 'Discord ne répond pas (délai dépassé)'
            : 'Discord injoignable — connexion, VPN ou pare-feu',
          { cause: e }
        );
      }
      const donnees = await rep.json().catch(() => ({}));
      // Discord demande de patienter : une fois, pas plus de 10 s.
      if (rep.status === 429 && essai === 1) {
        await attendre(Math.min(10, Number(donnees.retry_after) || 1) * 1000);
        continue;
      }
      return { status: rep.status, ok: rep.ok, code: donnees.code, message: donnees.message, donnees };
    }
  }

  function motifEchec(r) {
    if ([401, 403, 404].includes(r.status))
      return 'le salon Discord des rapports n’existe plus (webhook supprimé)';
    if (r.status === 413 || r.code === 40005) return 'pièces jointes trop lourdes pour Discord';
    if (r.status === 429) return 'Discord demande de patienter avant un nouvel envoi';
    if (r.status >= 500) return 'Discord ne répond pas correctement (' + r.status + ')';
    return 'Discord a refusé le rapport (' + r.status + (r.message ? ' : ' + r.message : '') + ')';
  }

  // Un salon Forum exige un nom de fil a la creation ; un salon texte le
  // refuse. On tente le Forum -- un fil par rapport, c'est ce qu'on veut lire --
  // et on retient la reponse pour la suite de la session.
  async function posterLot(payload, fichiers, { nomFil, idFil }) {
    let avecFil = !idFil && !!nomFil && modeForum !== false;
    let r = await requete(payload, fichiers, { nomFil: avecFil ? nomFil : null, idFil });
    if (!r.ok && avecFil && r.code === FIL_HORS_FORUM) {
      modeForum = false;
      avecFil = false;
      r = await requete(payload, fichiers, { idFil });
    } else if (!r.ok && !avecFil && !idFil && nomFil && r.code === FORUM_EXIGE_UN_FIL) {
      // Le salon est devenu un Forum depuis le dernier envoi.
      avecFil = true;
      r = await requete(payload, fichiers, { nomFil });
    }
    if (!r.ok) throw new Error(motifEchec(r));
    if (avecFil) modeForum = true;
    // Dans un Forum, le message d'ouverture vit dans le fil qu'il vient de
    // creer : sa « channel_id » est celle du fil, ou vont les suites.
    return { idFil: idFil ?? (avecFil ? (r.donnees.channel_id ?? null) : null) };
  }

  async function posterDiscord(r) {
    const lots = repartir(r.fichiers);
    let idFil = null;
    let envoyes = 0;
    try {
      for (const [i, lot] of lots.entries()) {
        const payload =
          i === 0
            ? r.payload
            : {
                username: 'StreamKit',
                allowed_mentions: { parse: [] },
                content: 'Suite du rapport ' + r.reference + ' (' + (i + 1) + '/' + lots.length + ')',
              };
        const rep = await posterLot(payload, lot, { nomFil: i === 0 ? r.titreFil : null, idFil });
        idFil = rep.idFil;
        envoyes++;
      }
      return { complet: true };
    } catch (e) {
      if (!envoyes) throw e;
      return { complet: false, raison: e.message };
    }
  }

  // --- Sur le PC, quand l'envoi echoue -------------------------------------------

  function purger() {
    const limite = Date.now() - RETENTION_JOURS * 86400000;
    try {
      for (const nom of readdirSync(dossiers.signalements)) {
        const p = join(dossiers.signalements, nom);
        if (statSync(p).mtimeMs < limite) rmSync(p, { recursive: true, force: true });
      }
    } catch {
      /* rien de critique */
    }
  }

  function enregistrer(r, raison) {
    const d = r.date;
    const dossier = join(
      dossiers.signalements,
      jourDe(d) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + '_' + r.reference
    );
    mkdirSync(dossier, { recursive: true });
    for (const f of r.fichiers) writeFileSync(join(dossier, f.nom), f.contenu);
    writeFileSync(
      join(dossier, 'LISEZ-MOI.txt'),
      [
        'Rapport de bug StreamKit ' + r.reference + ' — ' + d.toLocaleString('fr-FR'),
        '',
        'Il n’a pas pu partir tout seul : ' + raison + '.',
        '',
        'Envoie ces fichiers sur Discord à la personne qui s’occupe de StreamKit :',
        'sélectionne-les tous (Ctrl+A) et glisse-les dans votre conversation.',
        '',
      ].join('\r\n'),
      'utf8'
    );
    purger();
    enregistres.set(r.reference, dossier);
    return dossier;
  }

  // --- Ce que le dashboard appelle ----------------------------------------------

  async function apercu(corps) {
    const { erreurs, demande } = lireDemande({ ...corps, pieces: [] });
    if (erreurs.length) return { ok: false, erreur: erreurs.join(' ') };
    // La vraie reference n'est tiree qu'a l'envoi.
    const r = await construire(demande, { reference: 'SK-····' });
    return {
      ok: true,
      envoiPossible: !!cible,
      fichiers: r.fichiers.map((f) => ({
        nom: f.nom,
        taille: taille(f.contenu.length),
        quoi: f.quoi,
        court: f.court,
      })),
      rapport: r.fichiers[0].contenu.toString('utf8'),
    };
  }

  async function envoyer(corps) {
    const { erreurs, demande } = lireDemande(corps, { pourEnvoi: true });
    if (erreurs.length) return { ok: false, erreur: erreurs.join(' ') };
    if (enCours) return { ok: false, erreur: 'Un rapport est déjà en cours d’envoi.' };
    if (Date.now() - dernierEnvoi < intervalleMinMs) {
      return { ok: false, erreur: 'Patiente quelques secondes avant d’envoyer un autre rapport.' };
    }

    enCours = true;
    try {
      const r = await construire(demande);
      const quoi = r.reference + ' (' + (demande.module?.manifeste.nom ?? 'StreamKit en général') + ')';

      if (!cible) {
        const dossier = enregistrer(r, 'cette version de StreamKit n’a pas d’adresse d’envoi');
        log.warn('Rapport ' + quoi + ' enregistré sur ce PC, sans envoi : ' + dossier);
        return {
          ok: false,
          reference: r.reference,
          raison: 'cette version de StreamKit ne sait pas envoyer les rapports',
          dossier,
          ouvrable: !!ouvrir,
        };
      }

      try {
        const envoi = await posterDiscord(r);
        dernierEnvoi = Date.now();
        if (envoi.complet) {
          log.ok('Rapport ' + quoi + ' envoyé.');
          return { ok: true, reference: r.reference };
        }
        const dossier = enregistrer(r, envoi.raison);
        log.warn(
          'Rapport ' + quoi + ' envoyé en partie (' + envoi.raison + ') ; copie complète : ' + dossier
        );
        return { ok: true, reference: r.reference, partiel: envoi.raison, dossier, ouvrable: !!ouvrir };
      } catch (e) {
        const dossier = enregistrer(r, e.message);
        log.warn('Rapport ' + quoi + ' non envoyé (' + e.message + ') ; enregistré dans ' + dossier);
        return { ok: false, reference: r.reference, raison: e.message, dossier, ouvrable: !!ouvrir };
      }
    } finally {
      enCours = false;
    }
  }

  async function ouvrirDossier(reference) {
    const dossier = enregistres.get(String(reference));
    if (!dossier) return { ok: false, erreur: 'rapport inconnu' };
    if (!ouvrir) return { ok: false, dossier, erreur: 'ouverture impossible ici : le chemin est affiché' };
    const echec = await ouvrir(dossier);
    return echec ? { ok: false, dossier, erreur: echec } : { ok: true, dossier };
  }

  return { apercu, envoyer, ouvrirDossier, envoiPossible: () => !!cible };
}
