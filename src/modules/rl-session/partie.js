// Du flux d'evenements de l'API au resultat d'une partie.
//
// L'API ne dit jamais « tu as gagne » : elle dit quelle equipe gagne
// (MatchEnded.WinnerTeamNum), et c'est a nous de savoir dans quelle equipe joue
// le streamer. D'ou l'essentiel de ce fichier : reconnaitre son joueur, et
// ecarter tout ce qui ressemble a une fin de partie sans en etre une.
//
// Pieges couverts, tous observes sur le vrai jeu par d'autres outils branches
// sur la meme API :
//   - un REPLAY ouvert depuis l'historique rejoue MatchCreated, les buts et
//     MatchEnded : rien ne doit compter jusqu'a la sortie du replay ;
//   - un lobby annule (adversaires jamais arrives) peut emettre MatchEnded sans
//     un seul UpdateState : sans equipe connue, on ne compte pas ;
//   - apres MatchEnded, le jeu continue d'envoyer des UpdateState (podium) : ils
//     ne doivent pas rouvrir une partie ;
//   - MatchEnded arrive parfois SANS WinnerTeamNum (forfait, deconnexion de
//     l'hote) : on tranche au score, et une egalite ne compte pas ;
//   - StreamKit peut demarrer en pleine partie : le premier UpdateState ouvre
//     la partie a la volee.
//
// Ce fichier ne filtre pas classe / non classe : il rapporte chaque partie
// terminee, le module decide ce qui compte.

// Joueur du streamer dans la liste de l'API. Par identifiant de plateforme
// d'abord (« Epic|<id>|0 », lu dans Launch.log) : il ne change pas quand on
// change de pseudo. Le pseudo ne sert que de repli.
export function trouverJoueur(joueurs, { primaryId, pseudo } = {}) {
  if (!Array.isArray(joueurs)) return null;
  if (primaryId) {
    const exact = joueurs.find((j) => j?.PrimaryId === primaryId);
    if (exact) return exact;
  }
  const nom = String(pseudo || '')
    .trim()
    .toLowerCase();
  if (nom) {
    return joueurs.find((j) => String(j?.Name || '').toLowerCase() === nom) ?? null;
  }
  return null;
}

const equipeValide = (n) => n === 0 || n === 1;

// identite()            -> { primaryId, pseudo }
// playlist({ forcer })  -> numero de playlist en cours d'apres Launch.log, ou null
// surResultat(r)        -> une partie terminee : { victoire, guid, playlist, taille, scores, source }
// surIgnoree(raison)    -> une fin de partie ecartee (journal du module)
export function creerSuiviParties({ identite, playlist, surResultat, surIgnoree = () => {} }) {
  let enReplay = false;
  let partie = null;
  const comptees = []; // derniers MatchGuid comptes, contre les doublons

  function ouvrir(data) {
    partie = {
      guid: data?.MatchGuid || null,
      equipe: null,
      taille: 0,
      scores: null,
      // Instantane pris AU DEBUT : c'est la file d'attente de CETTE partie qui
      // compte, pas celle qu'on aura relancee entre-temps.
      playlist: playlist({ forcer: true }),
      finie: false,
    };
  }

  function finir(gagnantApi) {
    if (!partie || partie.finie) return;
    partie.finie = true;

    if (partie.equipe == null) {
      surIgnoree('equipe du joueur inconnue (lobby annule, ou StreamKit lance apres la fin)');
      return;
    }
    let gagnant = equipeValide(gagnantApi) ? gagnantApi : null;
    let source = 'api';
    if (gagnant == null && partie.scores && partie.scores[0] !== partie.scores[1]) {
      gagnant = partie.scores[0] > partie.scores[1] ? 0 : 1;
      source = 'score';
    }
    if (gagnant == null) {
      surIgnoree('aucun vainqueur (egalite ou partie interrompue)');
      return;
    }
    if (partie.guid) {
      if (comptees.includes(partie.guid)) return;
      comptees.push(partie.guid);
      if (comptees.length > 50) comptees.shift();
    }

    surResultat({
      victoire: gagnant === partie.equipe,
      guid: partie.guid,
      playlist: partie.playlist,
      taille: partie.taille,
      scores: partie.scores,
      source,
    });
  }

  function recevoir({ evenement, data }) {
    switch (evenement) {
      case 'ReplayCreated':
        enReplay = true;
        partie = null;
        return;

      case 'MatchCreated':
      case 'MatchInitialized': {
        if (enReplay) return;
        // MatchInitialized suit MatchCreated pour la MEME partie : on garde ce
        // qu'on sait deja (equipe, playlist) au lieu de repartir de zero.
        const guid = data?.MatchGuid || null;
        const memePartie = partie && !partie.finie && (partie.guid === guid || !partie.guid || !guid);
        if (!memePartie) ouvrir(data);
        else if (guid && !partie.guid) partie.guid = guid;
        return;
      }

      case 'UpdateState': {
        if (enReplay) return;
        const jeu = data?.Game || {};
        if (!partie) {
          // Podium d'une partie qu'on n'a pas vue commencer : trop tard.
          if (jeu.bHasWinner) return;
          ouvrir(data);
        }
        if (partie.finie) return; // podium : la partie est deja tranchee
        if (!partie.guid && data?.MatchGuid) partie.guid = data.MatchGuid;

        const joueurs = Array.isArray(data?.Players) ? data.Players : [];
        const moi = trouverJoueur(joueurs, identite());
        if (moi && equipeValide(moi.TeamNum)) partie.equipe = moi.TeamNum;

        const parEquipe = [0, 0];
        for (const j of joueurs) if (equipeValide(j?.TeamNum)) parEquipe[j.TeamNum]++;
        // Le plus grand effectif vu : un coequipier qui quitte ne fait pas
        // passer un 3v3 pour un 2v2.
        partie.taille = Math.max(partie.taille, ...parEquipe);

        const equipes = Array.isArray(jeu.Teams) ? jeu.Teams : [];
        const score = (n) => Number(equipes.find((t) => t?.TeamNum === n)?.Score ?? 0);
        if (equipes.length) partie.scores = [score(0), score(1)];

        // La ligne de file d'attente peut arriver dans Launch.log un peu apres
        // le debut : on complete tant qu'elle manque (sans relire le fichier a
        // chaque image, la lecture periodique suffit).
        if (partie.playlist == null) partie.playlist = playlist({ forcer: false });
        return;
      }

      case 'MatchEnded':
        if (enReplay) return;
        finir(data?.WinnerTeamNum);
        return;

      case 'MatchDestroyed':
        // Quitter une partie avant MatchEnded : abandon ou deconnexion. On ne
        // devine pas un resultat au score -- on pourrait offrir une victoire a
        // quelqu'un qui a quitte en menant.
        if (!enReplay && partie && !partie.finie) {
          partie.finie = true;
          surIgnoree('partie quittee avant la fin');
        }
        enReplay = false;
        partie = null;
        return;

      default:
    }
  }

  return {
    recevoir,
    enPartie: () => !!partie && !partie.finie,
  };
}
