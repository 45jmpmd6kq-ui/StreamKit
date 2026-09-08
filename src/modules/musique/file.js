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
    ajouter({ uri, name, artists, requester }) {
      const item = { id: ++seq, uri, name, artists, requester, status: 'pending', at: Date.now() };
      items.push(item);
      return item;
    },

    enAttente: pending,

    // Liste « a venir » pour l'overlay : les demandes en attente ET celles
    // annulees pas encore passees (affichees barrees).
    aVenir() {
      return items
        .filter((i) => i.status === 'pending' || i.status === 'cancelled')
        .map((i) => ({
          name: i.name,
          artists: i.artists,
          requester: i.requester,
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
