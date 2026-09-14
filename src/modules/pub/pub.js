// Annonce de pub : ce qu'il faut afficher a chaque instant, sans rien savoir de
// Twitch ni d'OBS.
//
// Deux sources, qui ne se recouvrent pas :
//   - le PLANNING (API Get Ad Schedule) : l'heure de la prochaine pub
//     automatique et sa duree. C'est ce qui permet de prevenir AVANT ;
//   - l'EVENEMENT de debut de pub (EventSub) : une pub qui demarre vraiment,
//     automatique ou lancee a la main. Twitch n'envoie pas de fin : on la deduit
//     de la duree.
//
// D'ou quatre phases, recalculees chaque seconde :
//   avant     la prochaine pub est dans la fenetre d'avertissement
//   pendant   une pub tourne
//   fin       quelques secondes de « c'est reparti » juste apres
//   (rien)    l'overlay est invisible
//
// Pieges couverts :
//   - le planning n'est relu que toutes les 15 s : juste apres la pub, il peut
//     encore annoncer la pub qui vient de passer. Une pub demarree autour de
//     l'heure prevue « consomme » ce creneau ;
//   - une pub repoussee (snooze) deplace l'heure prevue : l'avertissement
//     disparait, puis revient en temps voulu ;
//   - une pub prevue qui ne demarre pas (live coupe, planning faux) ne laisse
//     pas le bandeau bloque sur 0:00.

// Une pub prevue a 20 h 00 peut demarrer quelques secondes avant ou apres.
const TOLERANCE_MS = 90_000;
// Au-dela de l'heure prevue sans pub, on cesse d'annoncer.
const ATTENTE_MAX_MS = 20_000;

export function calculerPhase({ planning, pub, maintenant, avertirMs, finMs = 5000 }) {
  if (pub) {
    const fin = pub.debutA + pub.duree * 1000;
    if (maintenant < fin) return { phase: 'pendant', depuis: pub.debutA, cible: fin, duree: pub.duree };
    if (maintenant < fin + finMs) return { phase: 'fin', depuis: fin, cible: fin + finMs, duree: pub.duree };
  }
  const prevue = planning?.prochaineA;
  if (prevue) {
    const consommee = pub && Math.abs(pub.debutA - prevue) <= TOLERANCE_MS;
    const reste = prevue - maintenant;
    if (!consommee && reste <= avertirMs && reste > -ATTENTE_MAX_MS) {
      return { phase: 'avant', depuis: prevue - avertirMs, cible: prevue, duree: planning.duree };
    }
  }
  return { phase: null };
}

// « 1 min 30 », « 45 s », « 2 min »
export function formaterDuree(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!m) return r + ' s';
  return r ? m + ' min ' + String(r).padStart(2, '0') : m + ' min';
}

export const remplir = (modele, valeurs) =>
  String(modele || '').replace(/\{(\w+)\}/g, (tout, cle) => (cle in valeurs ? valeurs[cle] : tout));

// publier(etat | null)    vers l'overlay, seulement quand la phase change
// dire(message)           dans le chat
// messages                { avant, pendant } : modeles, vide = pas de message
export function creerSuiviPub({
  publier,
  dire,
  avertirMs,
  finMs = 5000,
  messages = {},
  maintenant = Date.now,
}) {
  let planning = null;
  let pub = null;
  let simulation = false;
  let dernierePhase = null;
  const annoncees = []; // heures prevues deja annoncees dans le chat

  function tic() {
    const t = maintenant();
    const etat = calculerPhase({ planning, pub, maintenant: t, avertirMs, finMs });
    const cle = etat.phase ? etat.phase + ':' + etat.cible : null;
    if (cle === dernierePhase) return etat;
    dernierePhase = cle;

    if (etat.phase === 'avant' && !simulation) {
      // Une seule annonce par pub prevue, meme si le planning bouge de
      // quelques secondes d'une lecture a l'autre.
      const deja = annoncees.some((a) => Math.abs(a - etat.cible) <= TOLERANCE_MS);
      if (!deja && messages.avant) {
        annoncees.push(etat.cible);
        if (annoncees.length > 20) annoncees.shift();
        dire(
          remplir(messages.avant, {
            delai: formaterDuree(etat.cible - t),
            duree: formaterDuree(etat.duree * 1000),
          })
        );
      }
    }
    // Simulation terminee (sa fausse pub est passee) : on rend la main au
    // vrai planning, qui sera relu au prochain tour.
    if (etat.phase === null && simulation && pub) {
      simulation = false;
      planning = null;
      pub = null;
    }

    publier(etat.phase ? { ...etat, simulation } : null);
    return etat;
  }

  return {
    tic,
    // Planning relu chez Twitch. Ignore pendant une simulation : il effacerait
    // la fausse pub prevue.
    planning(p) {
      if (simulation) return;
      planning = p?.prochaineA ? { prochaineA: p.prochaineA, duree: p.duree || 0 } : null;
    },
    // Debut d'une vraie pub : elle interrompt une simulation.
    pub({ debutA, duree }) {
      // EventSub peut livrer deux fois le meme evenement (reconnexion) : sans
      // ca, le chat recevrait deux fois « pub en cours ».
      if (pub && !simulation && Math.abs(pub.debutA - debutA) < 5000) return tic();
      simulation = false;
      pub = { debutA, duree };
      if (messages.pendant)
        dire(remplir(messages.pendant, { duree: formaterDuree(duree * 1000), delai: '' }));
      return tic();
    },
    // Fausse pub : avertissement tout de suite, pub dans `dansMs`. Rien n'est
    // envoye dans le chat.
    simuler({ dansMs = 15000, duree = 30 } = {}) {
      const t = maintenant();
      simulation = true;
      planning = { prochaineA: t + dansMs, duree };
      pub = null;
      return { pubA: t + dansMs, duree };
    },
    demarrerSimulee({ debutA, duree }) {
      if (!simulation) return;
      pub = { debutA, duree };
      tic();
    },
    etat: () => ({ planning, pub, simulation }),
  };
}
