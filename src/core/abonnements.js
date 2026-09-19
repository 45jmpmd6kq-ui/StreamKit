// Abonnements EventSub : savoir quand Twitch en refuse un.
//
// Twurple cree les abonnements en arriere-plan, et ne signale un refus que par
// un evenement du listener -- que StreamKit n'ecoutait pas. Un module pouvait
// donc s'afficher « demarre » sans jamais recevoir une utilisation de sa
// recompense : ni erreur a l'ecran, ni ligne au journal.
//
// Un refus attendu : au redemarrage d'un module (chaque Enregistrer), l'ancien
// abonnement s'efface pendant que le nouveau se cree. Si Twitch n'a pas fini
// d'effacer, il refuse le nouveau en 409 (« existe deja »)... puis efface
// l'ancien, et plus rien n'arrive. Un 409 se retente donc un peu plus tard.
//
// Twurple ne sait rien des modules : chaque abonnement est rattache ici au
// journal du module qui l'a pose, pour que le refus s'y lise.

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

export function creerSuivi({ logSocle, planifier = (fn, ms) => setTimeout(fn, ms) }) {
  const suivis = new WeakMap(); // abonnement Twurple -> { log, quoi, essais }

  return {
    // `quoi` complete « Abonnement Twitch refusé (…) » : « utilisations de la
    // récompense », « sondages »...
    suivre(abonnement, log, quoi) {
      if (abonnement) suivis.set(abonnement, { log, quoi, essais: 0 });
      return abonnement;
    },

    // L'abonnement a ete retire (module arrete) : un essai deja planifie ne doit
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
          '. Rien n’arrivera tant qu’il manque : éteins puis rallume le module, ou reconnecte ta chaîne.'
      );
    },
  };
}
