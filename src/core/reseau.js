// Un fetch qui ne peut pas rester pendu indefiniment.
//
// fetch() n'a AUCUN delai par defaut. Une connexion ouverte qui ne repond
// jamais -- portail captif d'hotel, VPN qui vient de tomber, proxy d'antivirus
// qui inspecte le HTTPS -- ne provoque donc pas d'erreur : elle attend. Et ce
// qui l'attend attend aussi :
//
//   - l'autorisation Twitch reste bloquee jusqu'a son propre delai de 5 minutes ;
//   - la verification de mise a jour ne rend jamais la main ;
//   - le bot musique se fige SANS la moindre erreur dans le journal, parce que
//     son intervalle saute les tics tant que le tour precedent tourne.
//
// AbortSignal.timeout leve une TimeoutError au bout du delai : pour l'appelant,
// c'est une erreur reseau comme une autre, qu'il sait deja traiter.

export const DELAI_DEFAUT = 15000;

export function fetchAvecDelai(url, options = {}, ms = DELAI_DEFAUT) {
  // Un appelant qui fournit deja son propre signal garde la main.
  return fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(ms) });
}
