// Decouverte, validation et cycle de vie des modules.
//
// Un module = un dossier dans src/modules/<id>/ contenant module.js, qui
// exporte par defaut un manifeste (voir MODULES.md). Le registre :
//   - decouvre les dossiers presents,
//   - valide le manifeste (un module mal ecrit ne doit pas empecher les autres
//     de demarrer),
//   - applique les migrations de reglages,
//   - demarre / arrete a chaud.
//
// Regle importante : un module qui plante au demarrage est marque « en erreur »
// et les autres continuent. En plein live, on ne coupe pas tout parce qu'un
// module a un souci.

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MODULES_DIR } from './paths.js';
import * as journal from './journal.js';
import * as store from './store.js';
import * as schema from './schema.js';
import * as categories from './categories.js';
import * as connecteurs from './connecteurs.js';

const log = journal.pour('noyau');

// Etats possibles : 'arrete' | 'demarre' | 'erreur' | 'incomplet'
//   incomplet = reglages obligatoires manquants (le module ne peut pas demarrer
//   tant que le streamer n'a pas renseigne ce qu'il faut).
const modules = new Map();

export function liste() {
  return [...modules.values()];
}

export function get(id) {
  return modules.get(id);
}

function dossiersDeModules() {
  if (!existsSync(MODULES_DIR)) return [];
  return readdirSync(MODULES_DIR).filter((nom) => {
    if (nom.startsWith('.')) return false;
    const p = join(MODULES_DIR, nom);
    return statSync(p).isDirectory() && existsSync(join(p, 'module.js'));
  });
}

function validerManifeste(m, dossier) {
  const erreurs = [];
  if (!m || typeof m !== 'object') return ["le module n'exporte pas de manifeste"];
  if (!m.id) erreurs.push('"id" manquant');
  if (m.id && m.id !== dossier) erreurs.push('"id" (' + m.id + ') different du dossier (' + dossier + ')');
  if (!m.nom) erreurs.push('"nom" manquant');
  if (typeof m.demarrer !== 'function') erreurs.push('"demarrer" doit etre une fonction');
  if (m.scopes && !Array.isArray(m.scopes)) erreurs.push('"scopes" doit etre un tableau');
  if (m.categorie && !categories.existe(m.categorie)) {
    // Pas une erreur bloquante : le module tombera dans « Outils ». Mais sans
    // ce mot, on chercherait longtemps pourquoi il n'est pas ou on l'attend.
    log.warn('Module « ' + dossier + ' » : categorie inconnue (' + m.categorie + '), il ira dans Outils.');
  }
  erreurs.push(...schema.validerSchema(m.config?.champs ?? []));
  return erreurs;
}

// --- Chargement -------------------------------------------------------------

export async function charger() {
  for (const dossier of dossiersDeModules()) {
    try {
      const url = pathToFileURL(join(MODULES_DIR, dossier, 'module.js')).href;
      // Pas de cache-buster « ?v=Date.now() » ici. Il promettait de recharger un
      // module modifie sans redemarrer StreamKit, mais charger() n'est appele
      // qu'une seule fois : il ne servait qu'a casser le cache ESM. Et s'il
      // etait rappele un jour, il ferait pire -- les modules qui gardent un etat
      // de fichier (le catalogue de voitures de la roue, l'agent HTTPS de Riot)
      // seraient instancies deux fois, chacun avec son propre cache.
      const mod = await import(url);
      const manifeste = mod.default;

      const erreurs = validerManifeste(manifeste, dossier);
      if (erreurs.length) {
        log.err('Module « ' + dossier + ' » ignore : ' + erreurs.join(' ; '));
        continue;
      }

      inscrire(manifeste, dossier);
      log.debug('Module decouvert : ' + manifeste.id + ' (' + manifeste.nom + ')');
    } catch (e) {
      log.err('Module « ' + dossier + ' » illisible : ' + (e?.message || e));
    }
  }
  log.info(modules.size + ' module(s) disponible(s) : ' + [...modules.keys()].join(', '));
  return liste();
}

function inscrire(manifeste, dossier) {
  const champs = manifeste.config?.champs ?? [];
  const entree = store.entreeModule(manifeste.id);
  const versionSchema = manifeste.config?.version ?? 1;

  // Migration des reglages si le module a evolue depuis la derniere fois.
  let reglages = { ...schema.valeursParDefaut(champs), ...entree.reglages };
  if ((entree.schemaVersion ?? 0) < versionSchema) {
    const avant = entree.schemaVersion ?? 0;
    reglages = schema.migrer(reglages, avant, versionSchema, manifeste.migrations);
    reglages = { ...schema.valeursParDefaut(champs), ...reglages };
    store.sauverModule(manifeste.id, { schemaVersion: versionSchema, reglages });
    if (avant > 0)
      log.info('Reglages de « ' + manifeste.nom + ' » migres (v' + avant + ' -> v' + versionSchema + ')');
  }

  modules.set(manifeste.id, {
    id: manifeste.id,
    dossier,
    manifeste,
    champs,
    etat: 'arrete', // rien n'est demarre avant que le noyau ne le demande
    actif: !!entree.actif,
    erreur: null,
    manque: [],
    instance: null,
    demarreA: null,
  });
}

// --- Reglages ---------------------------------------------------------------

export function reglagesDe(id) {
  const m = modules.get(id);
  if (!m) return {};
  const entree = store.entreeModule(id);
  return { ...schema.valeursParDefaut(m.champs), ...entree.reglages };
}

// Champs marques `requis: true` et encore vides : le module ne peut pas demarrer.
function manquants(m) {
  const r = reglagesDe(m.id);
  return m.champs.filter((c) => c.requis && !r[c.cle]).map((c) => c.label ?? c.cle);
}

export function definirReglages(id, brut) {
  const m = modules.get(id);
  if (!m) throw new Error('module inconnu : ' + id);

  const anciennes = reglagesDe(id);
  const { valeurs, erreurs } = schema.normaliser(m.champs, brut);
  if (erreurs.length) return { ok: false, erreurs };

  const finales = schema.reinjecterSecrets(m.champs, valeurs, anciennes);
  store.sauverModule(id, { reglages: finales });
  return { ok: true, reglages: schema.masquerSecrets(m.champs, finales) };
}

// --- Demarrage / arret ------------------------------------------------------

export async function demarrer(id, contexteFactory) {
  const m = modules.get(id);
  if (!m) throw new Error('module inconnu : ' + id);
  if (m.instance) return m;

  // Un connecteur non branché bloque le module aussi sûrement qu'un réglage
  // obligatoire vide : autant le dire de la même façon, avec le nom du service.
  const connecteursManquants = (m.manifeste.connecteurs ?? []).filter((c) => !connecteurs.estConnecte(c));
  if (connecteursManquants.length) {
    m.manque = connecteursManquants.map((c) => connecteurs.trouver(c)?.nom ?? c);
    m.etat = 'incomplet';
    m.erreur = 'Connecteur à brancher : ' + m.manque.join(', ');
    log.warn('« ' + m.manifeste.nom + ' » non demarre — ' + m.erreur);
    return m;
  }

  m.manque = manquants(m);
  if (m.manque.length) {
    m.etat = 'incomplet';
    m.erreur = 'Reglages a completer : ' + m.manque.join(', ');
    log.warn('« ' + m.manifeste.nom + ' » non demarre — ' + m.erreur);
    return m;
  }

  try {
    const ctx = contexteFactory(m);
    m.instance = (await m.manifeste.demarrer(ctx)) ?? {};
    m.etat = 'demarre';
    m.erreur = null;
    m.demarreA = Date.now();
    log.ok('Module demarre : ' + m.manifeste.nom);
  } catch (e) {
    m.instance = null;
    m.etat = 'erreur';
    m.erreur = e?.message || String(e);
    log.err('« ' + m.manifeste.nom + " » n'a pas demarre : " + m.erreur);
  }
  return m;
}

export async function arreter(id) {
  const m = modules.get(id);
  if (!m || !m.instance) return m;
  try {
    if (typeof m.instance.arreter === 'function') await m.instance.arreter();
  } catch (e) {
    log.warn('Arret de « ' + m.manifeste.nom + ' » imparfait : ' + (e?.message || e));
  }
  m.instance = null;
  m.etat = 'arrete';
  m.demarreA = null;
  log.info('Module arrete : ' + m.manifeste.nom);
  return m;
}

// Activer/desactiver et recharger un module se pilotent depuis le NOYAU
// (app.definirActif, app.recharger), pas d'ici. Ce fichier en a longtemps eu
// ses propres versions, jamais appelees et surtout incompletes : elles
// arretaient bien le module, mais laissaient derriere elles son contexte,
// donc ses minuteurs et ses abonnements Twitch. Les garder revenait a poser un
// piege pour le prochain module.

export async function demarrerActifs(contexteFactory) {
  for (const m of modules.values()) {
    if (m.actif) await demarrer(m.id, contexteFactory);
  }
}

export async function arreterTout() {
  for (const m of modules.values()) await arreter(m.id);
}

// Union des droits Twitch demandes par les modules actifs : c'est ce qu'on
// demande a l'autorisation, ni plus ni moins.
export function scopesRequis({ tousLesModules = false } = {}) {
  const set = new Set();
  for (const m of modules.values()) {
    if (!tousLesModules && !m.actif) continue;
    for (const s of m.manifeste.scopes ?? []) set.add(s);
  }
  return [...set].sort();
}

// Vue destinee au dashboard (sans instance ni fonctions, avec secrets masques).
export function vue(id) {
  const m = modules.get(id);
  if (!m) return null;
  const reglages = reglagesDe(id);
  return {
    id: m.id,
    nom: m.manifeste.nom,
    description: m.manifeste.description ?? '',
    categorie: categories.resoudre(m.manifeste.categorie),
    icone: m.manifeste.icone ?? '🧩',
    developpement: !!m.manifeste.developpement,
    actif: m.actif,
    etat: m.etat,
    erreur: m.erreur,
    manque: m.manque,
    demarreA: m.demarreA,
    scopes: m.manifeste.scopes ?? [],
    connecteurs: (m.manifeste.connecteurs ?? []).map((c) => ({
      id: c,
      nom: connecteurs.trouver(c)?.nom ?? c,
      connecte: connecteurs.estConnecte(c),
    })),
    // Seules les actions DECLAREES dans `libellesActions` deviennent des boutons.
    // Les autres restent appelables par les pages du module, sans apparaitre.
    //
    // Ce n'est pas cosmetique : la roue expose une action « enregistrer » que sa
    // page de selection appelle avec la liste des voitures. En bouton, un clic
    // l'appellerait sans donnees et VIDERAIT la selection du streamer.
    actions: Object.entries(m.manifeste.libellesActions ?? {})
      .filter(([nom]) => typeof m.manifeste.actions?.[nom] === 'function')
      .map(([nom, label]) => ({ nom, label })),
    champs: m.champs,
    reglages: schema.masquerSecrets(m.champs, reglages),
    overlays: (m.manifeste.overlays ?? []).map((o) => ({
      chemin: o.chemin,
      nom: o.nom,
      description: o.description ?? '',
      url: '/overlay/' + m.id + '/' + o.chemin,
    })),
    // Interfaces sur mesure du module (voir MODULES.md). Le dashboard y met un
    // bouton ; ce ne sont pas des overlays, elles ne vont pas dans OBS.
    pages: (m.manifeste.pages ?? []).map((p) => ({
      chemin: p.chemin,
      nom: p.nom,
      description: p.description ?? '',
      url: '/module/' + m.id + '/' + p.chemin,
    })),
  };
}

export function vues() {
  return [...modules.keys()].map(vue);
}
