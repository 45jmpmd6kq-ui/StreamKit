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
// NOMMAGE (« !clip pentakill ») : le titre part avec la demande de clip
// (parametre « title » de POST /helix/clips, ajoute par Twitch le 19/12/2025).
// Avant, faute de mieux, StreamKit basculait le titre du STREAM une fraction de
// seconde autour de la creation. Constate en live (09/2026) : le clip gardait
// le titre du stream. Ne pas y revenir.
//
// Portage StreamKit : le journal est injecte (plus d'import global).

const ESSAIS = 8; // ~12 s d'attente maximum
const DELAI_MS = 1500;
// Twitch ne documente pas de limite pour le titre d'un clip : 100 caracteres,
// par prudence, suffisent largement a le retrouver.
const TITRE_MAX = 100;

const attendre = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

function echec(reason, message) {
  const e = new Error(message);
  e.reason = reason;
  return e;
}

const statut = (err) => err?.statusCode ?? err?.status;

function estErreurDeDroit(err) {
  return /requested scopes/i.test(err?.message || '') || statut(err) === 401;
}

// Twitch peut normaliser le titre (espaces, casse) : ce n'est pas un refus.
const normaliser = (t) =>
  String(t ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// `delaiMs` n'existe que pour les tests : l'attente d'encodage est reelle chez
// Twitch, mais la faire subir a la suite de tests couterait douze secondes pour
// ne rien verifier de plus.
export function creerClipper({ api, broadcasterId, log, delaiMs = DELAI_MS }) {
  // Une demande de clip, erreurs traduites en raisons exploitables.
  async function demander(titre) {
    try {
      return await api.clips.createClip({
        channel: broadcasterId,
        createAfterDelay: false,
        ...(titre ? { title: titre } : {}),
      });
    } catch (err) {
      const msg = err?.message || '';
      if (/clips:edit/i.test(msg) || estErreurDeDroit(err)) {
        throw echec('NO_SCOPE', 'autorisation « clips:edit » absente');
      }
      if (statut(err) === 404 || /\b404\b/.test(msg)) throw echec('OFFLINE', "la chaîne n'est pas en live");
      if (statut(err) === 429 || /\b429\b/.test(msg))
        throw echec('RATE_LIMIT', 'trop de clips en peu de temps');
      throw err;
    }
  }

  return {
    // Cree un clip et renvoie { id, url, title, renamed, renameIssue }.
    // renameIssue : null | 'REFUSED' (titre refuse, clip cree sans) | 'IGNORED'
    // (clip cree sous un autre titre). Erreurs typees via err.reason :
    // NO_SCOPE | OFFLINE | RATE_LIMIT
    async creer({ nom = '' } = {}) {
      const label = String(nom).trim().slice(0, TITRE_MAX);
      let titre = label;
      let soucisRenommage = null;

      let id;
      try {
        id = await demander(titre);
      } catch (err) {
        // Titre refuse : le clip compte plus que son nom, on le redemande sans.
        const refus = statut(err) === 400 || /\b400\b/.test(err?.message || '');
        if (!titre || err.reason || !refus) throw err;
        log.warn('Twitch refuse le titre « ' + titre + ' » (' + err.message + ') : clip créé sans nom.');
        soucisRenommage = 'REFUSED';
        titre = '';
        id = await demander('');
      }

      // L'URL publique est previsible ; on interroge quand meme l'API pour
      // confirmer que le clip est bien encode, et sous quel titre.
      const urlSecours = 'https://clips.twitch.tv/' + id;
      let clip = null;
      for (let i = 0; i < ESSAIS; i++) {
        await attendre(delaiMs);
        try {
          const lu = await api.clips.getClipById(id);
          if (lu) {
            clip = lu;
            // Sous un autre titre, on laisse a Twitch le temps de poser le bon.
            if (!titre || normaliser(lu.title) === normaliser(titre)) break;
          }
        } catch {
          /* pas encore encode : on retente */
        }
      }

      if (!clip) {
        log.warn('Clip créé mais pas encore visible côté Twitch : on donne quand même le lien.');
        // Twitch a accepte la demande, titre compris.
        return { id, url: urlSecours, title: label, renamed: Boolean(titre), renameIssue: soucisRenommage };
      }

      const renomme = Boolean(titre) && normaliser(clip.title) === normaliser(titre);
      if (titre && !renomme) {
        soucisRenommage = 'IGNORED';
        log.warn('Twitch a créé le clip sous le titre « ' + clip.title + ' » au lieu de « ' + titre + ' ».');
      }
      return {
        id,
        url: clip.url || urlSecours,
        title: clip.title || label,
        renamed: renomme,
        renameIssue: soucisRenommage,
      };
    },
  };
}
