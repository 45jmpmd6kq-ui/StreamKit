// Ce qui compte, et ce que ca donne sur la session.
//
// Les parties comptees vivent dans l'etat persistant du module, horodatees : la
// session est simplement « celles jouees depuis le debut de session ». Changer
// de mode de session, redemarrer StreamKit ou reinitialiser ne perd donc
// jamais l'historique, seulement la fenetre qu'on regarde.

import { PLAYLISTS, nomPlaylist } from './journal-jeu.js';

export const MAX_PARTIES = 300;

// Faut-il compter cette partie ? -> { ok, raison }
//   filtre : 'classe' | 'enligne' | 'toutes'
//   format : 'tous' | '1' | '2' | '3'
export function accepter(resultat, { filtre = 'classe', format = 'tous' } = {}) {
  const p = PLAYLISTS[resultat.playlist];

  if (filtre === 'classe' && !p?.classe) {
    return {
      ok: false,
      raison:
        resultat.playlist == null
          ? 'playlist inconnue'
          : 'non classée (' + nomPlaylist(resultat.playlist) + ')',
    };
  }
  if (filtre === 'enligne' && (resultat.playlist == null || resultat.playlist === 0 || p?.prive)) {
    return {
      ok: false,
      raison: resultat.playlist == null ? 'playlist inconnue' : nomPlaylist(resultat.playlist),
    };
  }
  // Hors ligne (partie contre des bots) : l'API n'y donne pas d'identifiant.
  if (filtre === 'toutes' && !resultat.guid) return { ok: false, raison: 'partie hors ligne' };

  if (format !== 'tous') {
    const taille = p?.taille ?? resultat.taille;
    if (taille !== Number(format))
      return { ok: false, raison: 'format ' + (taille ? taille + 'v' + taille : 'inconnu') };
  }
  return { ok: true, raison: '' };
}

export function ajouter(historique, resultat, maintenant = Date.now()) {
  historique.push({
    a: maintenant,
    victoire: !!resultat.victoire,
    playlist: resultat.playlist ?? null,
    taille: resultat.taille || 0,
    guid: resultat.guid ?? null,
  });
  if (historique.length > MAX_PARTIES) historique.splice(0, historique.length - MAX_PARTIES);
  return historique;
}

// Debut de la session : lancement de StreamKit, ou minuit ; une remise a zero
// manuelle l'emporte si elle est plus recente.
export function debutSession({ mode = 'launch', lanceA, reinitA = 0, maintenant = Date.now() }) {
  let depart = lanceA;
  if (mode === 'day') {
    const minuit = new Date(maintenant);
    minuit.setHours(0, 0, 0, 0);
    depart = minuit.getTime();
  }
  return Math.max(depart, reinitA || 0);
}

// Bilan de la session : victoires, defaites et serie en cours.
export function bilan(historique, depuis) {
  const parties = historique.filter((p) => p.a >= depuis);
  const victoires = parties.filter((p) => p.victoire).length;

  let serie = 0;
  const derniere = parties[parties.length - 1] ?? null;
  for (let i = parties.length - 1; i >= 0 && parties[i].victoire === derniere.victoire; i--) serie++;

  return {
    victoires,
    defaites: parties.length - victoires,
    parties: parties.length,
    serie: derniere ? { victoire: derniere.victoire, n: serie } : null,
    depuis,
  };
}
