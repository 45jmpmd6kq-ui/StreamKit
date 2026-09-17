// Sequence d'exemple, pour placer la source dans OBS sans attendre un vrai
// pentakill : premier sang, un combat qui monte du double au pentakill, puis un
// Nashor vole et un ace. Rien ne part dans le chat, aucun clip.

import { creerRoster } from './joueurs.js';
import { presenter } from './moments.js';

const joueur = (nom, cle, equipe, champion = cle) => ({
  riotIdGameName: nom,
  riotId: nom + '#EUW',
  championName: champion,
  rawChampionName: 'game_character_displayname_' + cle,
  team: equipe,
});

export const JOUEURS_DEMO = [
  joueur('Pseudo', 'Ahri', 'ORDER'),
  joueur('Allié', 'Jinx', 'ORDER'),
  joueur('Rival1', 'Zed', 'CHAOS'),
  joueur('Rival2', 'LeeSin', 'CHAOS', 'Lee Sin'),
  joueur('Rival3', 'Darius', 'CHAOS'),
  joueur('Rival4', 'Thresh', 'CHAOS'),
  joueur('Rival5', 'Lux', 'CHAOS'),
];

// -> [{ apresMs, vue }] : chaque vue part vers l'overlay a son heure.
export function sequenceDemo(champion) {
  const roster = creerRoster(JOUEURS_DEMO, 'Pseudo#EUW');
  const rivaux = ['Rival1', 'Rival2', 'Rival3', 'Rival4', 'Rival5'].map((nom) => ({
    joueur: roster.trouver(nom),
    nom,
  }));
  const vue = (moment) => presenter(moment, { moi: roster.moi, champion });
  const multi = (niveau, temps) => ({
    type: 'multikill',
    id: 100 + niveau,
    temps,
    niveau,
    victimes: rivaux.slice(0, niveau),
  });

  return [
    { apresMs: 0, vue: vue({ type: 'premierSang', id: 1, temps: 192, victimes: rivaux.slice(0, 1) }) },
    { apresMs: 3000, vue: vue(multi(2, 1412)) },
    { apresMs: 4400, vue: vue(multi(3, 1415)) },
    { apresMs: 5800, vue: vue(multi(4, 1418)) },
    { apresMs: 7600, vue: vue(multi(5, 1421)) },
    { apresMs: 14000, vue: vue({ type: 'vol', id: 200, temps: 1625, objectif: 'nashor', dragon: '' }) },
    {
      apresMs: 20000,
      vue: vue({ type: 'ace', id: 300, temps: 1630, auteur: roster.trouver('Allié') }),
    },
  ];
}
