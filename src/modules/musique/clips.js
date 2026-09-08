// Creation de clips Twitch (commande !clip, reservee au streamer et aux mods).
//
// Deux subtilites de l'API Twitch :
//  - on ne peut clipper que pendant un LIVE (hors live, l'API repond 404) ;
//  - le clip est encode en differe : sa fiche n'est consultable qu'au bout de
//    quelques secondes, d'ou la petite boucle d'attente ci-dessous.
//
// Le clip capture les ~30 dernieres secondes du live (comme le bouton « Clip »
// de Twitch) : on tape la commande APRES le moment marrant, pas avant.
//
// NOMMAGE (« !clip pentakill ») : l'API Twitch n'a AUCUN moyen de nommer un
// clip (POST /helix/clips ne prend que broadcaster_id, et aucun endpoint ne
// permet de le renommer ensuite). Un clip herite du TITRE DU STREAM au moment
// de la capture : on bascule donc le titre de la chaine juste avant, et on le
// remet des que Twitch a accepte le clip — moins d'une seconde de bascule.
//
// Portage StreamKit : le journal est injecte (plus d'import global), et l'etat
// de la bascule vit dans une instance, pour survivre proprement a un
// redemarrage a chaud du module.

const ESSAIS = 8; // ~12 s d'attente maximum
const DELAI_MS = 1500;
const TITRE_MAX = 140; // longueur maximale d'un titre de stream Twitch

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function echec(reason, message) {
  const e = new Error(message);
  e.reason = reason;
  return e;
}

function estErreurDeDroit(err) {
  const msg = err?.message || '';
  const status = err?.statusCode ?? err?.status;
  return /requested scopes/i.test(msg) || status === 401;
}

export function creerClipper({ api, broadcasterId, log }) {
  // Titre a remettre si une bascule est en cours (securite en cas d'arret brutal).
  let aRestaurer = null;

  // Remet le titre d'origine si une bascule est restee en suspens.
  // Appele en fin de clip, et aussi a l'arret du module.
  async function restaurerTitre() {
    if (!aRestaurer) return false;
    const { titre } = aRestaurer;
    aRestaurer = null;
    try {
      await api.channels.updateChannelInfo(broadcasterId, { title: titre });
      return true;
    } catch (err) {
      log.err(
        'Titre du stream non restauré ! Remets-le à la main : « ' + titre + ' » (' + err.message + ')'
      );
      return false;
    }
  }

  return {
    restaurerTitre,

    // Cree un clip et renvoie { id, url, title, renamed, renameIssue }.
    // Erreurs typees via err.reason : NO_SCOPE | OFFLINE | RATE_LIMIT
    async creer({ nom = '' } = {}) {
      const label = String(nom).trim().slice(0, TITRE_MAX);
      let soucisRenommage = null;
      let bascule = false;

      // --- Bascule du titre de la chaine (uniquement si un nom est demande) ---
      if (label) {
        try {
          const info = await api.channels.getChannelInfoById(broadcasterId);
          const original = info?.title ?? '';
          if (!original) {
            // Twitch refuse un titre vide : sans titre d'origine, pas de retour possible.
            soucisRenommage = 'NO_TITLE';
            log.warn('Titre de chaîne introuvable : le clip gardera le titre par défaut.');
          } else {
            await api.channels.updateChannelInfo(broadcasterId, { title: label });
            aRestaurer = { titre: original };
            bascule = true;
          }
        } catch (err) {
          soucisRenommage = estErreurDeDroit(err) ? 'NO_SCOPE' : 'FAILED';
          if (soucisRenommage === 'NO_SCOPE') {
            log.warn(
              "Droit « channel:manage:broadcast » manquant : clip créé sans nom personnalisé. " +
                'Reconnecte ta chaîne depuis le dashboard.'
            );
          } else {
            log.warn('Renommage impossible (' + err.message + ') : on clippe quand même.');
          }
        }
      }

      // --- Creation du clip ---
      let id;
      try {
        id = await api.clips.createClip({ channel: broadcasterId, createAfterDelay: false });
      } catch (err) {
        const msg = err?.message || '';
        const status = err?.statusCode ?? err?.status;
        if (/clips:edit/i.test(msg) || estErreurDeDroit(err)) {
          throw echec('NO_SCOPE', "autorisation « clips:edit » absente");
        }
        if (status === 404 || /\b404\b/.test(msg)) throw echec('OFFLINE', "la chaîne n'est pas en live");
        if (status === 429 || /\b429\b/.test(msg)) throw echec('RATE_LIMIT', 'trop de clips en peu de temps');
        throw err;
      } finally {
        // Le titre du clip est fige des que Twitch a accepte la demande : on rend
        // son vrai titre au stream tout de suite, meme si la creation a echoue.
        if (bascule) await restaurerTitre();
      }

      // L'URL publique est previsible ; on interroge quand meme l'API pour
      // recuperer le titre et confirmer que le clip est bien encode.
      const urlSecours = 'https://clips.twitch.tv/' + id;
      const renomme = Boolean(label) && bascule;

      for (let i = 0; i < ESSAIS; i++) {
        await attendre(DELAI_MS);
        try {
          const clip = await api.clips.getClipById(id);
          if (clip) {
            return {
              id,
              url: clip.url || urlSecours,
              title: clip.title || label,
              renamed: renomme,
              renameIssue: soucisRenommage,
            };
          }
        } catch {
          /* pas encore encode : on retente */
        }
      }

      log.warn('Clip créé mais pas encore visible côté Twitch : on donne quand même le lien.');
      return { id, url: urlSecours, title: label, renamed: renomme, renameIssue: soucisRenommage };
    },
  };
}
