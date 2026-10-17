// Suivi des demandes de musique.
//
// Spotify ne permet PAS de retirer un morceau precis de sa file d'attente.
// Astuce utilisee ici : on garde la liste des morceaux demandes ; quand un
// viewer « annule » un morceau, on le marque comme annule. Des qu'il arrive en
// lecture, le bot le passe automatiquement -> pour le spectateur, la musique
// annulee ne passe pas.
//
// Difference avec la version d'origine : c'est une FABRIQUE, pas un module a
// etat global. StreamKit peut redemarrer un module a chaud (changement de
// reglages) ; avec un etat au niveau du fichier, l'ancienne file survivrait au
// redemarrage et les morceaux fantomes reviendraient.

export function creerFile() {
  let seq = 0;
  // Statuts : pending -> playing -> done, ou cancelled.
  const items = [];

  const pending = () => items.filter((i) => i.status === 'pending');

  return {
    ajouter({ uri, name, artists, requester, image = null }) {
      const item = { id: ++seq, uri, name, artists, requester, image, status: 'pending', at: Date.now() };
      items.push(item);
      return item;
    },

    enAttente: pending,

    // Liste « a venir » pour l'overlay : les demandes en attente ET celles
    // annulees pas encore passees (affichees barrees). L'id sert a l'overlay a
    // reconnaitre une ligne qui vient d'arriver, pour l'animer elle seule.
    aVenir() {
      return items
        .filter((i) => i.status === 'pending' || i.status === 'cancelled')
        .map((i) => ({
          id: i.id,
          name: i.name,
          artists: i.artists,
          requester: i.requester,
          image: i.image,
          cancelled: i.status === 'cancelled',
        }));
    },

    enCours() {
      return items.find((i) => i.status === 'playing') || null;
    },

    // Un morceau annule doit-il etre passe ? (appele par le suivi de lecture)
    estAnnule(uri) {
      return items.some((i) => i.uri === uri && i.status === 'cancelled');
    },

    annuler(item) {
      if (!item) return null;
      item.status = 'cancelled';
      return item;
    },

    // Retrouve la demande a annuler a partir du titre tape par le viewer :
    // correspondance souple sur titre + artiste, la plus recente d'abord.
    trouverAAnnuler(input, correspond) {
      const liste = pending();
      if (!liste.length) return null;
      const q = (input || '').trim();
      if (!q) return liste[liste.length - 1]; // secours : la saisie est normalement obligatoire

      for (let i = liste.length - 1; i >= 0; i--) {
        const it = liste[i];
        if (correspond(q, it.name + ' ' + it.artists)) return it;
      }
      return null;
    },

    // Le morceau en cours a change : met a jour les statuts.
    // Renvoie true si quelque chose a bouge (donc si l'overlay doit etre repousse).
    //
    // Spotify joue sa file dans l'ordre : quand une demande passe en lecture,
    // celles d'avant sont passees, meme si aucun releve ne les a vues jouer
    // (passees entre deux releves, ou jouees dans une autre version).
    marquerEnLecture(uri) {
      let change = false;
      for (const i of items) {
        if (i.status === 'playing' && i.uri !== uri) {
          i.status = 'done';
          change = true;
        }
      }
      const suivant = items.find((i) => i.uri === uri && i.status === 'pending');
      if (suivant) {
        suivant.status = 'playing';
        change = true;
        for (let k = items.length - 1; k >= 0; k--) {
          const i = items[k];
          if (i.id >= suivant.id) continue;
          if (i.status === 'pending') i.status = 'done';
          else if (i.status === 'cancelled') items.splice(k, 1);
          else continue;
          change = true;
        }
      }
      return change;
    },

    // Confronte la liste a la vraie file de Spotify (`uris`, dans l'ordre) et
    // au morceau en cours (`enCours`). Une demande que Spotify n'a plus, ni en
    // file ni en lecture, est passee : sans ca elle resterait « a venir » tout
    // le live (SK-D319, 17/10/2026 : file perdue en changeant d'appareil,
    // morceau passe entre deux releves...).
    //
    // Prudences :
    //   - Spotify ne renvoie qu'une vingtaine de morceaux. On ne conclut que si
    //     la reponse va au-dela des demandes, c'est-a-dire contient un morceau
    //     qui n'en est pas une (la suite de la playlist), ou est courte ;
    //   - une demande toute fraiche peut manquer a un releve fait juste avant
    //     son ajout : on ne touche pas aux demandes de moins de `delaiMs` ;
    //   - il faut deux releves de suite sans elle pour la retirer.
    // Renvoie true si la liste a change.
    reconcilier(
      { uris = [], enCours = null } = {},
      { maintenant = Date.now(), delaiMs = 20000, max = 20 } = {}
    ) {
      const presents = new Set(uris);
      const demandees = new Set(items.filter((i) => i.status === 'pending').map((i) => i.uri));
      const complete = uris.length < max || uris.some((u) => !demandees.has(u));
      if (!complete) return false;

      let change = false;
      for (let k = items.length - 1; k >= 0; k--) {
        const i = items[k];
        if (i.status !== 'pending' && i.status !== 'cancelled') continue;
        if (presents.has(i.uri) || i.uri === enCours || maintenant - i.at < delaiMs) {
          i.absences = 0;
          continue;
        }
        i.absences = (i.absences ?? 0) + 1;
        if (i.absences < 2) continue;
        if (i.status === 'pending') i.status = 'done';
        else items.splice(k, 1);
        change = true;
      }
      return change;
    },

    // Retire une demande annulee une fois qu'elle a ete passee.
    retirer(uri) {
      const idx = items.findIndex((i) => i.uri === uri && i.status === 'cancelled');
      if (idx >= 0) items.splice(idx, 1);
    },

    // On ne garde pas un historique infini.
    elaguer(max = 60) {
      while (items.length > max) items.shift();
    },
  };
}
