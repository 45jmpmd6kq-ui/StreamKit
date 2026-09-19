// Abonnements EventSub : les partager entre redemarrages, et savoir quand
// Twitch en refuse un.
//
// 1. Un abonnement par evenement, garde toute la connexion (creerCanaux).
//
// Chaque Enregistrer dans un module le redemarre. Jusqu'a la 0.25.0, ses
// abonnements Twitch etaient alors effaces puis reposes aussitot -- et Twurple
// ne le supporte pas : il range un abonnement sous un nom logique (type +
// condition), et quand Twitch confirme l'effacement de l'ancien, il retire ce
// nom de ses tables... celui du NOUVEAU s'il est deja enregistre. Twitch envoie
// alors les evenements et Twurple les jette (« unknown event »), sans un mot.
// Et si Twitch recoit la creation avant l'effacement, il la refuse (409).
// Vecu chez un streamer le 19/09/2026 : sondages et Random Car muets apres des
// reglages retouches. Desormais l'abonnement reste, et seul le gestionnaire du
// module change.
//
// 2. Un refus ou une revocation se lit dans le journal du bon module
// (creerSuivi). Twurple ne les signale que par des evenements du listener, que
// StreamKit n'ecoutait pas : un module pouvait paraitre demarre sans jamais
// rien recevoir.
//
// 3. Les messages internes de Twurple qui comptent passent au journal
// (creerJournalTwurple) : un evenement jete comme trop ancien -- horloge du PC
// en avance --, ou arrive pour un abonnement inconnu.

export const ESSAIS_CONFLIT = 3;
export const PAS_CONFLIT_MS = 2000;

function raison(e) {
  let message = '';
  try {
    message = JSON.parse(e?.body ?? '')?.message ?? '';
  } catch {
    /* corps absent ou pas en JSON */
  }
  if (!message) message = String(e?.message || e).split('\n')[0];
  return e?.statusCode ? e.statusCode + ' ' + message : message;
}

const CONSEIL = 'Relance StreamKit, ou reconnecte ta chaîne (Connecteurs → Twitch).';

export function creerSuivi({ logSocle, planifier = (fn, ms) => setTimeout(fn, ms) }) {
  const suivis = new WeakMap(); // abonnement Twurple -> { log, quoi, essais }

  return {
    // `quoi` complete « Abonnement Twitch refusé (…) » : « utilisations de la
    // récompense », « sondages »...
    suivre(abonnement, log, quoi) {
      if (abonnement) suivis.set(abonnement, { log, quoi, essais: 0 });
      return abonnement;
    },

    // Abonnement abandonne (connexion arretee) : un essai deja planifie ne doit
    // pas le ressusciter.
    oublier(abonnement) {
      suivis.delete(abonnement);
    },

    succes(abonnement) {
      const s = suivis.get(abonnement);
      if (!s) return;
      if (s.essais) s.log.ok('Abonnement Twitch rétabli (' + s.quoi + ').');
      else s.log.debug('Abonnement Twitch actif (' + s.quoi + ').');
      s.essais = 0;
    },

    echec(abonnement, e) {
      const s = suivis.get(abonnement);
      if (!s) {
        logSocle.warn('Abonnement Twitch refusé (' + (abonnement?.id ?? '?') + ') : ' + raison(e));
        return;
      }
      if (e?.statusCode === 409 && s.essais < ESSAIS_CONFLIT) {
        s.essais++;
        s.log.debug('Abonnement Twitch en conflit (' + s.quoi + '), nouvel essai.');
        planifier(() => {
          if (suivis.get(abonnement) === s) abonnement.start();
        }, PAS_CONFLIT_MS * s.essais);
        return;
      }
      s.log.err(
        'Abonnement Twitch refusé (' +
          s.quoi +
          ') : ' +
          raison(e) +
          '. Rien n’arrivera tant qu’il manque. ' +
          CONSEIL
      );
    },

    // Twitch a coupe l'abonnement de lui-meme : autorisation retiree, compte
    // supprime...
    revoque(abonnement, statut) {
      const s = suivis.get(abonnement);
      const quoi = s?.quoi ?? abonnement?.id ?? '?';
      const pourquoi =
        statut === 'authorization_revoked'
          ? 'l’autorisation de StreamKit a été retirée sur Twitch'
          : 'motif « ' + (statut ?? '?') + ' »';
      (s?.log ?? logSocle).err('Twitch a coupé l’abonnement (' + quoi + ') : ' + pourquoi + '. ' + CONSEIL);
      suivis.delete(abonnement);
    },
  };
}

// Un abonnement Twitch par nom logique (type + condition), cree a la premiere
// demande et garde jusqu'a la fin de la connexion. Les modules y branchent leur
// gestionnaire, et l'en debranchent en s'arretant.
export function creerCanaux({ suivi }) {
  const canaux = new Map(); // nom -> { abonnement, gestionnaires, log }

  return {
    // `creer(recevoir)` pose l'abonnement Twurple ; `log` et `quoi` servent au
    // suivi. Renvoie le debranchement.
    brancher({ nom, creer, log, quoi }, gestionnaire) {
      let c = canaux.get(nom);
      if (!c) {
        const gestionnaires = new Set();
        const abonnement = creer(async (e) => {
          for (const g of [...gestionnaires]) {
            try {
              await g(e);
            } catch (err) {
              log.err('erreur sur un événement Twitch (' + quoi + ') : ' + (err?.message || err));
            }
          }
        });
        c = { abonnement, gestionnaires, log };
        suivi.suivre(abonnement, log, quoi);
        canaux.set(nom, c);
      }
      c.gestionnaires.add(gestionnaire);
      return () => c.gestionnaires.delete(gestionnaire);
    },

    // Revoque par Twitch : le prochain module qui s'y branche en reposera un.
    retirer(abonnement) {
      for (const [nom, c] of canaux) if (c.abonnement === abonnement) canaux.delete(nom);
    },

    // Connexion arretee : ses abonnements meurent avec elle.
    vider() {
      for (const c of canaux.values()) suivi.oublier(c.abonnement);
      canaux.clear();
    },

    nombre: () => canaux.size,
    gestionnaires: (nom) => canaux.get(nom)?.gestionnaires.size ?? 0,
  };
}

// Journal de Twurple (@d-fischer/logger, option `custom`) -> journal de
// StreamKit. On ne garde que ce qui explique une panne ; le reste (chaque
// paquet recu, en debug) serait du bruit.
export const REPIT_MESSAGE_MS = 10 * 60 * 1000; // une ligne par motif et par 10 min

const MOTIFS = [
  {
    motif: /^Old notification\(s\) prevented/,
    cle: 'horloge',
    niveau: 'warn',
    texte:
      'Twitch a envoyé un événement que Twurple a jeté comme trop ancien : l’horloge de ce PC est sans doute ' +
      'en avance de plus de 10 minutes. Remets Windows à l’heure (Paramètres → Heure et langue → Synchroniser ' +
      'maintenant), sinon sondages, prédictions et récompenses restent muets.',
  },
  {
    motif: /^(Notification|Revocation) from unknown event received/,
    cle: 'inconnu',
    niveau: 'warn',
    texte:
      'Twitch a envoyé un événement pour un abonnement que StreamKit ne suit plus : il est perdu. Si un module ne ' +
      'réagit plus, relance StreamKit.',
  },
  // Deja dit, avec le nom du module, par creerSuivi.
  { motif: /failed to subscribe/, ignorer: true },
];

export function creerJournalTwurple({ log, maintenant = Date.now }) {
  const derniers = new Map(); // cle -> heure de la derniere ligne

  // `niveau` : LogLevel de @d-fischer/logger (0 critique, 1 erreur,
  // 2 avertissement, 3 info, 4 debug, 7 trace).
  return (niveau, message) => {
    const texte = String(message ?? '');
    const m = MOTIFS.find((x) => x.motif.test(texte));
    if (m?.ignorer) return;
    if (m) {
      const avant = derniers.get(m.cle);
      if (avant !== undefined && maintenant() - avant < REPIT_MESSAGE_MS) return;
      derniers.set(m.cle, maintenant());
      log[m.niveau](m.texte);
      return;
    }
    const ligne = 'Twurple : ' + texte.split('\n')[0];
    if (niveau <= 1) log.err(ligne);
    else if (niveau === 2) log.warn(ligne);
    else if (niveau === 3) log.debug(ligne);
  };
}
