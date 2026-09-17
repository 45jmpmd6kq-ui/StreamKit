// Ce que devient chaque moment fort : a l'ecran, dans le chat, en clip.
//
// Deux formats a l'ecran (maquette C, choisie le 17/09/2026) :
//  - CARTE, sur le cote : ce qui arrive en plein combat -- premier sang, double
//    a quadra kill, ace. Discrete, elle ne cache pas la suite du combat. La
//    carte du multikill « monte en grade » tant que le combat continue ;
//  - ANNONCE, au centre : ce qui cloture un combat ou n'arrive presque jamais --
//    pentakill, objectif vole, legendaire.

export const NIVEAUX = [
  { valeur: 'off', label: 'Ignoré' },
  { valeur: 'ecran', label: 'À l’écran' },
  { valeur: 'chat', label: 'À l’écran + message dans le chat' },
  { valeur: 'clip', label: 'À l’écran + message + clip' },
];

// Un reglage par moment, dans l'ordre du formulaire.
export const REGLAGES = [
  { cle: 'premierSang', label: 'Premier sang', defaut: 'ecran' },
  { cle: 'doubleKill', label: 'Double kill', defaut: 'ecran' },
  { cle: 'tripleKill', label: 'Triple kill', defaut: 'ecran' },
  { cle: 'quadraKill', label: 'Quadra kill', defaut: 'clip' },
  { cle: 'pentakill', label: 'Pentakill', defaut: 'clip' },
  { cle: 'ace', label: 'Ace de ton équipe', defaut: 'ecran' },
  { cle: 'vol', label: 'Dragon, Héraut ou Nashor volé par toi', defaut: 'clip' },
  { cle: 'legendaire', label: 'Légendaire (8 kills sans mourir)', defaut: 'chat' },
];

// Quand deux clips se disputent le meme combat, le plus fort l'emporte.
export const IMPORTANCE = {
  premierSang: 1,
  doubleKill: 1,
  tripleKill: 2,
  ace: 2,
  legendaire: 3,
  quadraKill: 3,
  vol: 4,
  pentakill: 5,
};

const MULTIKILLS = {
  2: { cle: 'doubleKill', titre: 'Double kill' },
  3: { cle: 'tripleKill', titre: 'Triple kill' },
  4: { cle: 'quadraKill', titre: 'Quadra kill' },
  5: { cle: 'pentakill', titre: 'Pentakill' },
};

const DRAGONS = {
  Fire: { nom: 'Dragon infernal', accent: 'orange' },
  Water: { nom: 'Dragon des océans', accent: 'bleu' },
  Earth: { nom: 'Dragon des montagnes', accent: 'terre' },
  Air: { nom: 'Dragon des nuages', accent: 'ciel' },
  Hextech: { nom: 'Dragon hextech', accent: 'cyan' },
  Chemtech: { nom: 'Dragon chimtech', accent: 'vert' },
  Elder: { nom: 'Dragon ancestral', accent: 'ancestral' },
};

const OBJECTIFS = {
  dragon: { titre: 'Dragon volé', message: '🐉' },
  heraut: { titre: 'Héraut volé', message: '👁️' },
  nashor: { titre: 'Nashor volé', message: '👁️' },
  atakhan: { titre: 'Atakhan volé', message: '👁️' },
};

export function cleReglage(moment) {
  if (moment.type === 'multikill') return MULTIKILLS[moment.niveau]?.cle ?? 'doubleKill';
  return moment.type;
}

export function niveau(config, cle) {
  const v = config?.[cle];
  return NIVEAUX.some((n) => n.valeur === v) ? v : (REGLAGES.find((r) => r.cle === cle)?.defaut ?? 'off');
}

export const avecChat = (n) => n === 'chat' || n === 'clip';

// 1421.7 s de jeu -> « 23:41 »
export function horloge(secondes) {
  const s = Math.max(0, Math.floor(Number(secondes) || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// -> ce que l'overlay affiche. `champion(joueur)` rend { nom, icone, initiales }.
export function presenter(moment, { moi, champion }) {
  const toi = champion(moi);
  const quand = horloge(moment.temps);
  const victimes = (moment.victimes ?? []).map((v) => champion(v.joueur, v.nom));
  const base = { id: 'm' + moment.id, cle: cleReglage(moment), champion: toi, victimes: [] };

  switch (moment.type) {
    case 'multikill': {
      const m = MULTIKILLS[moment.niveau] ?? MULTIKILLS[2];
      return {
        ...base,
        format: moment.niveau >= 5 ? 'annonce' : 'carte',
        // Toutes les cartes d'un meme combat n'en font qu'une, qui monte en grade.
        groupe: 'multikill',
        titre: m.titre,
        detail: toi.nom + ' · ' + quand,
        accent: 'or',
        embleme: 'portrait',
        victimes,
      };
    }
    case 'premierSang': {
      const cible = victimes[0];
      return {
        ...base,
        format: 'carte',
        titre: 'Premier sang',
        detail: (cible ? 'Sur ' + cible.nom + ' · ' : toi.nom + ' · ') + quand,
        accent: 'rouge',
        embleme: 'portrait',
        victimes: victimes.slice(0, 1),
      };
    }
    case 'ace': {
      const auteur = moment.auteur ? champion(moment.auteur) : toi;
      return {
        ...base,
        champion: auteur,
        format: 'carte',
        titre: 'Ace',
        detail: 'Par ' + auteur.nom + ' · ' + quand,
        accent: 'bleu',
        embleme: 'portrait',
      };
    }
    case 'vol': {
      const objectif = OBJECTIFS[moment.objectif] ?? { titre: 'Objectif volé' };
      const dragon = moment.objectif === 'dragon' ? DRAGONS[moment.dragon] : null;
      return {
        ...base,
        format: 'annonce',
        titre: objectif.titre,
        detail: (dragon ? dragon.nom + ' · ' : '') + toi.nom + ' · ' + quand,
        accent: dragon ? dragon.accent : 'violet',
        embleme: moment.objectif === 'dragon' ? 'flamme' : 'oeil',
      };
    }
    case 'legendaire':
      return {
        ...base,
        format: 'annonce',
        titre: 'Légendaire',
        detail: toi.nom + ' · ' + moment.serie + ' kills sans mourir · ' + quand,
        accent: 'serie',
        embleme: 'portrait',
      };
    default:
      return null;
  }
}

export function messageChat(moment, vue) {
  const nom = vue.champion?.nom || 'le streamer';
  switch (moment.type) {
    case 'multikill':
      return moment.niveau >= 5
        ? '🔥 PENTAKILL avec ' + nom + ' à ' + horloge(moment.temps) + ' !'
        : '⚔️ ' + vue.titre.toUpperCase() + ' avec ' + nom + ' !';
    case 'premierSang': {
      const cible = vue.victimes?.[0]?.nom;
      return '🩸 Premier sang pour ' + nom + (cible ? ' sur ' + cible : '') + ' !';
    }
    case 'ace':
      return '💥 ACE pour l’équipe, signé ' + nom + ' !';
    case 'vol': {
      const quoi =
        moment.objectif === 'dragon'
          ? DRAGONS[moment.dragon]?.nom || 'Dragon'
          : vue.titre.replace(/ volé$/, '');
      return (OBJECTIFS[moment.objectif]?.message ?? '👁️') + ' ' + quoi + ' volé par ' + nom + ' !';
    }
    case 'legendaire':
      return '🌟 LÉGENDAIRE : ' + moment.serie + ' kills sans mourir avec ' + nom + ' !';
    default:
      return '';
  }
}

// « Pentakill · Ahri · 23:41 » : de quoi retrouver le clip dans la liste de Twitch.
export function titreClip(moment, vue) {
  return [vue.titre, vue.champion?.nom, horloge(moment.temps)].filter(Boolean).join(' · ');
}
