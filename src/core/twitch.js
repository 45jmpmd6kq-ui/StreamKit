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

const log = journal.pour('twitch');

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
    etat = { ...etat, pret: false, raison: 'application Twitch non configuree' };
    log.warn("Twitch non configure : renseigne l'application dans le dashboard.");
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
      if (!manuel) log.warn('Chat deconnecte (' + (raison?.message || 'raison inconnue') + '), reconnexion...');
    });
  }
  chat.connect();

  // --- EventSub en WebSocket : pas d'URL publique, pas de serveur a exposer ---
  listener = new EventSubWsListener({ apiClient: api });
  listener.start();
  etat.eventsubConnecte = true;
  log.ok('EventSub demarre (WebSocket).');

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
        const autorise =
          qui === 'tous' ||
          info.isBroadcaster ||
          (qui === 'mods' && info.isMod);
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
      return noter(moduleId, () => sub.stop());
    },

    // Valider (points depenses) ou annuler (points rembourses) une redemption.
    async statutRedemption(e, statut) {
      try {
        if (typeof e.updateStatus === 'function') await e.updateStatus(statut);
        else await api.channelPoints.updateRedemptionStatusByIds(etat.broadcasterId, e.rewardId, [e.id], statut);
        return true;
      } catch (err) {
        logModule.warn('Statut de la redemption non mis a jour : ' + (err?.message || err));
        return false;
      }
    },

    // Cree la recompense si elle n'existe pas deja (evite de refaire un setup
    // complet quand un module ajoute une recompense).
    // autoFulfill reste a false : une recompense en validation automatique ne
    // peut plus etre remboursee par le bot. Or rembourser est indispensable --
    // morceau introuvable, aucune voiture configuree, Spotify eteint.
    //
    // Attention aussi : seule l'application qui a CREE la recompense peut la
    // piloter. Une recompense creee a la main dans le panneau Twitch ne sera
    // jamais validable ni remboursable par StreamKit.
    async assurerRecompense({
      titre,
      cout,
      prompt,
      saisieRequise = false,
      couleur,
      autoFulfill = false,
      cooldownSec = 0,
    }) {
      exige();
      const existantes = await api.channelPoints.getCustomRewards(etat.broadcasterId, true);
      const trouvee = existantes.find((r) => r.title === titre);
      if (trouvee) return { id: trouvee.id, titre: trouvee.title, creee: false };

      const r = await api.channelPoints.createCustomReward(etat.broadcasterId, {
        title: titre,
        cost: cout,
        prompt,
        userInputRequired: saisieRequise,
        autoFulfill,
        backgroundColor: couleur,
        isEnabled: true,
        ...(cooldownSec > 0 ? { globalCooldown: cooldownSec } : {}),
      });
      logModule.ok('Recompense creee : ' + titre);
      return { id: r.id, titre: r.title, creee: true };
    },
  };
}
