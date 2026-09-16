// Le morceau en cours, tel que l'overlay l'affiche en tete du bloc
// « en cours + a venir » (reglage « Afficher le morceau en cours »).
//
// Spotify n'est interroge que toutes les 5 s : entre deux releves, c'est la
// page qui fait avancer la barre, a partir de la position lue et de l'heure du
// releve. On ne repousse donc un etat a l'overlay que si ce calcul devient faux
// -- autre morceau, pause, retour en arriere -- et pas a chaque tour : une
// poussee redessine le bloc, et le redessiner toutes les 5 s pour rien le
// ferait clignoter.

// Au-dela de cet ecart entre la position attendue et la position lue, le
// streamer a deplace la lecture : il faut recaler la barre. En dessous, c'est
// la latence du reseau.
export const TOLERANCE_MS = 2500;

// `cur` : ce que renvoie SpotifyClient.currentlyPlaying().
// `demande` : la demande de viewer en lecture d'apres la file, ou null.
// Renvoie null quand rien ne doit s'afficher : rien ne joue, ou pause (le bloc
// se replie alors sur la liste, comme quand Spotify est ferme).
export function etatLecture(cur, demande, maintenant = Date.now()) {
  if (!cur || !cur.isPlaying) return null;
  return {
    uri: cur.uri,
    name: cur.name,
    artists: cur.artists,
    image: cur.image ?? null,
    durationMs: cur.durationMs ?? 0,
    progressMs: cur.progressMs ?? 0,
    at: maintenant,
    // Le pseudo seulement si c'est bien CE morceau que le viewer a demande :
    // la file peut garder une demande « en lecture » que Spotify a deja quittee.
    requester: demande && demande.uri === cur.uri ? (demande.requester ?? null) : null,
  };
}

// Faut-il repousser l'etat a l'overlay ?
export function lectureAChange(avant, apres, tolerance = TOLERANCE_MS) {
  if (!avant || !apres) return avant !== apres;
  if (avant.uri !== apres.uri || avant.requester !== apres.requester) return true;
  const attendu = avant.progressMs + (apres.at - avant.at);
  return Math.abs(attendu - apres.progressMs) > tolerance;
}

// Combien de temps avant la fin du morceau, d'apres le dernier releve.
export function msAvantFin(lecture, maintenant = Date.now()) {
  if (!lecture) return Infinity;
  return Math.max(0, lecture.durationMs - lecture.progressMs - (maintenant - lecture.at));
}
