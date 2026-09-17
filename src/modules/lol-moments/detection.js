// Des evenements de la partie aux moments forts du streamer.
//
// L'API renvoie a chaque appel la liste COMPLETE des evenements depuis le debut
// de la partie, chacun numerote (EventID, croissant). On ne traite que les
// nouveaux, en deux passes :
//  1. les kills, dans l'ordre : ils font la serie en cours (legendaire) et la
//     liste des victimes ;
//  2. le reste (multikill, premier sang, ace, objectif vole), qui renvoie aux
//     kills. Le jeu publie l'evenement « Multikill » ou « FirstBlood » dans la
//     meme seconde que le kill concerne, sans garantir lequel vient en premier.
//
// Un detecteur par partie : sa memoire (derniere ID, serie, victimes) ne vaut
// que pour elle.

export const SERIE_LEGENDAIRE = 8;

// Objectifs dont le vol compte. Les larves du Neant ne sont pas « volables »
// au sens du jeu (pas de champ Stolen).
const OBJECTIFS = {
  DragonKill: 'dragon',
  HeraldKill: 'heraut',
  BaronKill: 'nashor',
  AtakhanKill: 'atakhan',
};

// Le jeu ecrit « True » / « False », en texte.
const vrai = (v) => v === true || String(v).toLowerCase() === 'true';

// Marge sur l'heure de jeu pour rattacher un evenement a son kill.
const MEME_INSTANT_S = 1;

export function creerDetecteur({ serieLegendaire = SERIE_LEGENDAIRE } = {}) {
  let derniereId = -1;
  let serie = 0;
  let legendaireAnnonce = false;
  const victimes = []; // kills du streamer : { id, temps, joueur, nom }

  function tuer(e, roster, temps, moments) {
    if (roster.estMoi(e.VictimName)) {
      // Mort, y compris sous une tour ou un monstre : la serie repart de zero.
      serie = 0;
      legendaireAnnonce = false;
      return;
    }
    if (!roster.estMoi(e.KillerName)) return;
    victimes.push({
      id: e.EventID,
      temps,
      joueur: roster.trouver(e.VictimName),
      nom: String(e.VictimName ?? ''),
    });
    serie++;
    if (serie >= serieLegendaire && !legendaireAnnonce) {
      legendaireAnnonce = true;
      moments.push({ type: 'legendaire', id: e.EventID, temps, serie });
    }
  }

  // Les n derniers kills du streamer jusqu'a cet instant.
  const derniersKills = (temps, n) => victimes.filter((v) => v.temps <= temps + MEME_INSTANT_S).slice(-n);

  function lire(e, roster, temps) {
    switch (e.EventName) {
      case 'Multikill': {
        if (!roster.estMoi(e.KillerName)) return null;
        const niveau = Math.min(5, Math.max(2, Math.trunc(Number(e.KillStreak)) || 2));
        return { type: 'multikill', id: e.EventID, temps, niveau, victimes: derniersKills(temps, niveau) };
      }
      case 'FirstBlood': {
        if (!roster.estMoi(e.Recipient)) return null;
        const proche = victimes.filter((v) => Math.abs(v.temps - temps) <= MEME_INSTANT_S).slice(-1);
        return {
          type: 'premierSang',
          id: e.EventID,
          temps,
          victimes: proche.length ? proche : victimes.slice(0, 1),
        };
      }
      case 'Ace': {
        const auteur = roster.trouver(e.Acer);
        const equipe = String(e.AcingTeam || auteur?.equipe || '');
        if (!equipe || equipe !== roster.moi.equipe) return null;
        return { type: 'ace', id: e.EventID, temps, auteur };
      }
      default: {
        const objectif = OBJECTIFS[e.EventName];
        if (!objectif || !vrai(e.Stolen) || !roster.estMoi(e.KillerName)) return null;
        return { type: 'vol', id: e.EventID, temps, objectif, dragon: String(e.DragonType || '') };
      }
    }
  }

  return {
    get derniereId() {
      return derniereId;
    },

    // -> moments nouveaux, dans l'ordre de la partie.
    // ignorerAvant (secondes de jeu) : StreamKit lance en pleine partie. Ce qui
    // est plus ancien n'est pas annonce, mais compte quand meme pour la serie.
    traiter(evenements, roster, { ignorerAvant = -Infinity } = {}) {
      if (!roster?.moi) return [];
      const nouveaux = (Array.isArray(evenements) ? evenements : [])
        .filter((e) => Number.isInteger(e?.EventID) && e.EventID > derniereId)
        .sort((a, b) => a.EventID - b.EventID);
      if (!nouveaux.length) return [];
      derniereId = nouveaux[nouveaux.length - 1].EventID;

      const moments = [];
      for (const e of nouveaux) {
        if (e.EventName === 'ChampionKill') tuer(e, roster, Number(e.EventTime) || 0, moments);
      }
      for (const e of nouveaux) {
        if (e.EventName === 'ChampionKill') continue;
        const m = lire(e, roster, Number(e.EventTime) || 0);
        if (m) moments.push(m);
      }
      return moments.filter((m) => m.temps >= ignorerAvant).sort((a, b) => a.id - b.id);
    },
  };
}
