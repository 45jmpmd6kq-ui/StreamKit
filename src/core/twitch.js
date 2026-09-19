// Couche Twitch partagee.
//
// Aujourd'hui chaque projet ouvre SA connexion chat et SON EventSub. A trois
// bots lances en meme temps, c'est trois connexions, trois rafraichissements de
// jeton concurrents, et trois fois le meme code. Ici : une seule connexion, un
// seul jeton, et les modules s'abonnent a ce qui les interesse.
//
// Ce que voit un module (via ctx.twitch) :
//   api                    le client @twurple/api complet
//   channel, broadcasterId
//   dire(msg)              parler dans le chat
//   surMessage(fn)         -> desabonnement
//   surCommande(cmd, fn)   commande de chat, avec controle des droits
//   surRecompense(id, fn)  redemption de points de chaine
//   surPredictions({...})  predictions : debut, progression, verrou, fin
//   surSondages({...})     sondages : debut, progression, fin
//   surPub(fn)             debut d'une coupure pub (duree, automatique ou non)
//   statutRedemption(e, s) valider (FULFILLED) / rembourser (CANCELED)
//   aLeDroit(scope)        savoir si l'autorisation courante couvre un droit
//
// Les abonnements sont suivis par module, pour pouvoir tout retirer proprement
// quand on desactive un module a chaud.

import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { ChatClient } from '@twurple/chat';
import * as journal from './journal.js';
import * as store from './store.js';
import { creerSuivi } from './abonnements.js';
import * as recompenses from './recompenses.js';

const log = journal.pour('twitch');

// Refus d'abonnement EventSub, dits dans le journal du module concerne.
const suivi = creerSuivi({ logSocle: log });

// Identifiant de chaque recompense creee par un module, pour la retrouver meme
// renommee : { idModule: { cle: idRecompense } }. Dans etat/ comme la memoire
// des modules, mais sous un nom qu'aucun dossier de module ne peut porter.
const MEMOIRE_RECOMPENSES = '_recompenses';

let etat = {
  pret: false,
  raison: 'non demarre',
  channel: '',
  broadcasterId: '',
  utilisateur: '',
  scopes: [],
  chatConnecte: false,
  eventsubConnecte: false,
};

let authProvider = null;
let api = null;
let chat = null;
let listener = null;

// Abonnements : moduleId -> [fonction de retrait]
const retraits = new Map();

function noter(moduleId, retrait) {
  if (!retraits.has(moduleId)) retraits.set(moduleId, []);
  retraits.get(moduleId).push(retrait);
  return retrait;
}

export function retirerAbonnements(moduleId) {
  for (const fn of retraits.get(moduleId) ?? []) {
    try {
      fn();
    } catch {
      /* deja retire */
    }
  }
  retraits.delete(moduleId);
}

// --- Demarrage --------------------------------------------------------------

export async function demarrer() {
  const config = store.getConfig();
  const tokens = store.lireTokens();
  const app = tokens.twitchApp ?? {};
  const jeton = tokens.twitch;

  if (!app.clientId || !app.clientSecret) {
    etat = { ...etat, pret: false, raison: 'application Twitch non configurée' };
    log.warn("Twitch non configuré : renseigne l'application dans le dashboard.");
    return etat;
  }
  if (!jeton) {
    etat = { ...etat, pret: false, raison: 'chaine non autorisee' };
    log.warn('Twitch non autorise : connecte ta chaine depuis le dashboard.');
    return etat;
  }

  authProvider = new RefreshingAuthProvider({ clientId: app.clientId, clientSecret: app.clientSecret });
  authProvider.onRefresh((_userId, nouveau) => {
    store.majTokens((t) => {
      t.twitch = nouveau;
    });
    log.debug('Jeton Twitch rafraichi.');
  });
  await authProvider.addUserForToken(jeton, ['chat']);

  api = new ApiClient({ authProvider });

  // On resout la chaine une fois pour toutes : le streamer saisit un pseudo,
  // tout le reste de StreamKit travaille avec un identifiant numerique.
  const channel = (config.twitch.channel || '').toLowerCase();
  let broadcasterId = config.twitch.broadcasterId;
  if (channel && !broadcasterId) {
    const u = await api.users.getUserByName(channel);
    if (!u) throw new Error('chaine Twitch introuvable : ' + channel);
    broadcasterId = u.id;
    config.twitch.broadcasterId = broadcasterId;
    store.sauverConfig(config);
  }

  etat = {
    pret: true,
    raison: '',
    channel,
    broadcasterId,
    utilisateur: channel,
    scopes: jeton.scope ?? [],
    chatConnecte: false,
    eventsubConnecte: false,
  };

  // --- Chat (une seule connexion pour tout le monde) ---
  chat = new ChatClient({ authProvider, channels: [channel] });
  if (typeof chat.onConnect === 'function') {
    chat.onConnect(() => {
      etat.chatConnecte = true;
      log.ok('Chat connecte sur #' + channel);
    });
  }
  if (typeof chat.onDisconnect === 'function') {
    chat.onDisconnect((manuel, raison) => {
      etat.chatConnecte = false;
      if (!manuel)
        log.warn('Chat deconnecte (' + (raison?.message || 'raison inconnue') + '), reconnexion...');
    });
  }
  chat.connect();

  // --- EventSub en WebSocket : pas d'URL publique, pas de serveur a exposer ---
  listener = new EventSubWsListener({ apiClient: api });

  // On MESURE l'etat de la socket au lieu de le declarer. Avant, la ligne
  // « eventsubConnecte = true » suivait immediatement start() : la vue
  // d'ensemble affirmait « EventSub connecte » sans rien en savoir, et un
  // support parti de la n'avait aucune chance d'aboutir.
  //
  // A noter : Twurple n'ouvre la socket qu'a partir du premier abonnement
  // (StreamKit en pose un au demarrage, stream.online/offline). Le drapeau
  // reste donc brievement faux au lancement, ce qui est la verite.
  if (typeof listener.onUserSocketConnect === 'function') {
    listener.onUserSocketConnect(() => {
      etat.eventsubConnecte = true;
      log.ok('EventSub connecte.');
    });
  }
  if (typeof listener.onUserSocketDisconnect === 'function') {
    listener.onUserSocketDisconnect((_utilisateur, err) => {
      etat.eventsubConnecte = false;
      if (err) log.warn('EventSub deconnecte (' + (err?.message || err) + '), reconnexion...');
    });
  }

  if (typeof listener.onSubscriptionCreateFailure === 'function') {
    listener.onSubscriptionCreateFailure((abonnement, err) => suivi.echec(abonnement, err));
  }
  if (typeof listener.onSubscriptionCreateSuccess === 'function') {
    listener.onSubscriptionCreateSuccess((abonnement) => suivi.succes(abonnement));
  }

  listener.start();
  log.info('EventSub demarre (WebSocket).');

  return etat;
}

export async function arreter() {
  try {
    chat?.quit();
  } catch {
    /* deja ferme */
  }
  try {
    listener?.stop();
  } catch {
    /* deja arrete */
  }
  chat = null;
  listener = null;
  etat = { ...etat, pret: false, chatConnecte: false, eventsubConnecte: false, raison: 'arrete' };
}

// Debut et fin de live. Utilise par le socle pour rattacher les compteurs au
// live plutot qu'a la duree de vie de StreamKit : avec le demarrage automatique
// avec Windows, l'application peut tourner des jours -- « depuis le lancement »
// agregerait alors trois lives et deux journees sans stream.
//
// stream.online et stream.offline ne demandent AUCUN droit supplementaire :
// ils sont publics, meme sur sa propre chaine.
export function surDirect({ debut, fin }) {
  if (!listener || !etat.broadcasterId) return () => {};
  const abonnements = [];
  try {
    if (debut)
      abonnements.push(
        suivi.suivre(listener.onStreamOnline(etat.broadcasterId, debut), log, 'début du live')
      );
    if (fin)
      abonnements.push(suivi.suivre(listener.onStreamOffline(etat.broadcasterId, fin), log, 'fin du live'));
  } catch (e) {
    log.warn('Détection du live indisponible : ' + (e?.message || e));
  }
  return () =>
    abonnements.forEach((a) => {
      suivi.oublier(a);
      a.stop?.();
    });
}

// Retire un lot d'abonnements EventSub d'un module (voir `noter`).
function retirer(abonnements) {
  return () =>
    abonnements.forEach((a) => {
      suivi.oublier(a);
      a.stop();
    });
}

// Le live est-il en cours a cet instant ? Interroge Twitch, contrairement aux
// evenements qui ne disent que les transitions -- indispensable au demarrage,
// quand StreamKit se lance alors que le stream tourne deja.
export async function enDirect() {
  if (!etat.pret || !etat.broadcasterId) return null;
  try {
    const s = await api.streams.getStreamByUserId(etat.broadcasterId);
    return s ? { depuis: s.startDate?.getTime?.() ?? Date.now(), titre: s.title } : null;
  } catch {
    return null;
  }
}

export function getEtat() {
  return { ...etat };
}

export function estPret() {
  return etat.pret;
}

export function aLeDroit(scope) {
  return (etat.scopes ?? []).includes(scope);
}

export function droitsManquants(scopes = []) {
  return scopes.filter((s) => !aLeDroit(s));
}

// --- Ce qu'on expose a un module -------------------------------------------

export function contextePour(moduleId, logModule) {
  const exige = () => {
    if (!etat.pret) throw new Error('Twitch non connecte (' + etat.raison + ')');
  };

  return {
    get api() {
      exige();
      return api;
    },
    get channel() {
      return etat.channel;
    },
    get broadcasterId() {
      return etat.broadcasterId;
    },
    aLeDroit,

    // Ecrire dans le chat. On avale les erreurs : un message non envoye ne doit
    // jamais faire tomber un module en plein live.
    dire(message) {
      if (!chat || !etat.channel) return;
      chat.say(etat.channel, message).catch((e) => logModule.debug('chat.say : ' + (e?.message || e)));
    },

    surMessage(fn) {
      exige();
      const h = chat.onMessage(async (ch, user, texte, msg) => {
        try {
          await fn({ user, texte, msg, canal: ch });
        } catch (e) {
          logModule.err('erreur dans surMessage : ' + (e?.message || e));
        }
      });
      return noter(moduleId, () => chat.removeListener(h));
    },

    // Commande de chat avec droits. `qui` : 'tous' | 'mods' | 'streamer'.
    // Le texte apres la commande est passe en argument ("!clip pentakill").
    surCommande(commande, fn, { qui = 'tous' } = {}) {
      exige();
      const cmd = (commande || '').trim().toLowerCase();
      if (!cmd) return () => {}; // commande vide dans les reglages = desactivee

      const h = chat.onMessage(async (ch, user, texte, msg) => {
        const t = texte.trim().toLowerCase();
        if (t !== cmd && !t.startsWith(cmd + ' ')) return;

        const info = msg.userInfo;
        const autorise = qui === 'tous' || info.isBroadcaster || (qui === 'mods' && info.isMod);
        if (!autorise) return; // on ignore en silence, pas de spam dans le chat

        const argument = texte.trim().slice(cmd.length).trim();
        try {
          await fn({ user, argument, texte, msg, canal: ch });
        } catch (e) {
          logModule.err('erreur dans ' + cmd + ' : ' + (e?.message || e));
        }
      });
      return noter(moduleId, () => chat.removeListener(h));
    },

    // Redemption de points de chaine sur une recompense precise.
    surRecompense(rewardId, fn) {
      exige();
      if (!rewardId) throw new Error('surRecompense : identifiant de recompense manquant');
      const sub = listener.onChannelRedemptionAddForReward(etat.broadcasterId, rewardId, async (e) => {
        try {
          await fn(e);
        } catch (err) {
          logModule.err('erreur sur la recompense : ' + (err?.message || err));
        }
      });
      suivi.suivre(sub, logModule, 'utilisations de la récompense');
      return noter(moduleId, retirer([sub]));
    },

    // Cycle de vie des predictions de la chaine : lancee, votes qui arrivent,
    // votes fermes, terminee (resolue OU annulee -- c'est le meme evenement).
    // Chaque phase est optionnelle. Droit requis : channel:read:predictions
    // (channel:manage:predictions le couvre aussi).
    surPredictions({ debut, progression, verrou, fin }) {
      exige();
      const abonnements = [];
      const proteger = (fn) => async (e) => {
        try {
          await fn(e);
        } catch (err) {
          logModule.err('erreur sur la prediction : ' + (err?.message || err));
        }
      };
      const id = etat.broadcasterId;
      if (debut) abonnements.push(listener.onChannelPredictionBegin(id, proteger(debut)));
      if (progression) abonnements.push(listener.onChannelPredictionProgress(id, proteger(progression)));
      if (verrou) abonnements.push(listener.onChannelPredictionLock(id, proteger(verrou)));
      if (fin) abonnements.push(listener.onChannelPredictionEnd(id, proteger(fin)));
      abonnements.forEach((a) => suivi.suivre(a, logModule, 'prédictions'));
      return noter(moduleId, retirer(abonnements));
    },

    // Cycle de vie des sondages : lance, votes qui arrivent, termine (normalement,
    // clos a la main, ou archive). Chaque phase est optionnelle. Droit requis :
    // channel:read:polls (channel:manage:polls le couvre aussi).
    surSondages({ debut, progression, fin }) {
      exige();
      const abonnements = [];
      const proteger = (fn) => async (e) => {
        try {
          await fn(e);
        } catch (err) {
          logModule.err('erreur sur le sondage : ' + (err?.message || err));
        }
      };
      const id = etat.broadcasterId;
      if (debut) abonnements.push(listener.onChannelPollBegin(id, proteger(debut)));
      if (progression) abonnements.push(listener.onChannelPollProgress(id, proteger(progression)));
      if (fin) abonnements.push(listener.onChannelPollEnd(id, proteger(fin)));
      abonnements.forEach((a) => suivi.suivre(a, logModule, 'sondages'));
      return noter(moduleId, retirer(abonnements));
    },

    // Debut d'une coupure pub (automatique ou lancee par le streamer). Twitch
    // n'envoie PAS de fin : elle se deduit de la duree. Droit requis :
    // channel:read:ads.
    surPub(fn) {
      exige();
      const sub = listener.onChannelAdBreakBegin(etat.broadcasterId, async (e) => {
        try {
          await fn(e);
        } catch (err) {
          logModule.err('erreur sur la pub : ' + (err?.message || err));
        }
      });
      suivi.suivre(sub, logModule, 'pubs');
      return noter(moduleId, retirer([sub]));
    },

    // Valider (points depenses) ou annuler (points rembourses) une redemption.
    async statutRedemption(e, statut) {
      try {
        if (typeof e.updateStatus === 'function') await e.updateStatus(statut);
        else
          await api.channelPoints.updateRedemptionStatusByIds(etat.broadcasterId, e.rewardId, [e.id], statut);
        return true;
      } catch (err) {
        logModule.warn('Statut de la redemption non mis a jour : ' + (err?.message || err));
        return false;
      }
    },

    // Cree la recompense, ou aligne celle qui existe sur les reglages du module
    // (nom, cout, delai...) : voir core/recompenses.js. Appele a chaque
    // demarrage du module, donc a chaque Enregistrer.
    //
    // autoFulfill reste a false : une recompense en validation automatique ne
    // peut plus etre remboursee par le bot. Or rembourser est indispensable --
    // morceau introuvable, aucune voiture configuree, Spotify eteint.
    //
    // `cle` distingue les recompenses d'un meme module (le bot musique en a
    // deux). `cooldownSec` absent : le delai reste celui de Twitch.
    async assurerRecompense({
      cle = 'principale',
      titre,
      cout,
      prompt,
      saisieRequise = false,
      couleur,
      autoFulfill = false,
      cooldownSec,
    }) {
      exige();
      const memoire = store.lireEtat(MEMOIRE_RECOMPENSES, {});
      const idConnu = memoire[moduleId]?.[cle];

      const r = await recompenses.assurerRecompense(
        api,
        etat.broadcasterId,
        { titre, cout, prompt, saisieRequise, couleur, autoFulfill, cooldownSec },
        { idConnu }
      );

      if (r.id !== idConnu) {
        memoire[moduleId] = { ...memoire[moduleId], [cle]: r.id };
        store.sauverEtat(MEMOIRE_RECOMPENSES, memoire);
      }
      if (r.creee) {
        logModule.ok(
          'Récompense créée sur Twitch : « ' + r.titre + ' », ' + recompenses.points(r.cout) + '.'
        );
      } else if (r.changements.length) {
        logModule.ok(
          'Récompense « ' + r.titre + ' » mise à jour sur Twitch : ' + r.changements.join(', ') + '.'
        );
      }
      if (r.avertissement) logModule.warn(r.avertissement);
      return r;
    },
  };
}
