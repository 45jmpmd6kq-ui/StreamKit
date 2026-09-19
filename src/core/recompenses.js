// Recompenses de points de chaine : les creer, et les garder conformes aux
// reglages du module.
//
// Les reglages de StreamKit font foi -- le guide le promet : la recompense
// porte « le nom et le cout indiques dans leurs reglages ». Jusqu'a la 0.25.0
// pourtant, elle n'etait ecrite qu'a sa CREATION. Or allumer le module la cree
// aussitot, au cout par defaut : le streamer qui reglait son cout ensuite ne
// voyait rien bouger sur Twitch (vecu le 19/09/2026 avec Random Car). Chaque
// demarrage du module -- donc chaque Enregistrer -- aligne desormais Twitch sur
// les reglages.
//
// Seule l'application qui a CREE une recompense peut la modifier, la valider ou
// la rembourser. Une recompense du meme nom faite a la main dans le panneau
// Twitch bloque donc le module : Twitch refuse deux titres identiques, et
// StreamKit ne peut pas piloter celle-la. On le dit en clair plutot que de
// laisser passer l'erreur brute de l'API.
//
// Ce fichier ne connait que l'API qu'on lui passe : les tests lui donnent une
// fausse chaine Twitch.

// On ignore si Twitch tient compte de la casse pour refuser un doublon : on la
// neutralise des deux cotes.
const norme = (t) =>
  String(t ?? '')
    .trim()
    .toLowerCase();

export const points = (n) => Number(n).toLocaleString('fr-FR') + ' point' + (Math.abs(n) > 1 ? 's' : '');

// Le message de Twitch, sans l'URL ni la methode que Twurple colle autour.
export function messageTwitch(e) {
  try {
    const m = JSON.parse(e?.body ?? '')?.message;
    if (m) return String(m);
  } catch {
    /* corps absent ou pas en JSON */
  }
  return String(e?.message || e).split('\n')[0];
}

function doublon(titre) {
  return (
    'Une récompense « ' +
    titre +
    ' » existe déjà sur ta chaîne, mais StreamKit ne l’a pas créée : il ne peut ni la voir passer, ' +
    'ni la valider, ni la rembourser. Supprime-la dans les points de chaîne de ton tableau de bord ' +
    'Twitch, ou change le nom dans ce module, puis Enregistrer.'
  );
}

function traduire(e, action) {
  const m = messageTwitch(e);
  if (/partner or affiliate/i.test(m)) {
    return 'Points de chaîne indisponibles : Twitch les réserve aux chaînes Affiliées ou Partenaires.';
  }
  return 'Twitch : impossible de ' + action + ' (' + m + ').';
}

// La creation a echoue : est-ce parce que le titre est deja pris ailleurs ?
// Le message de Twitch le dit (CREATE_CUSTOM_REWARD_DUPLICATE_REWARD) ; faute
// de le reconnaitre, on regarde toutes les recompenses de la chaine.
async function titrePrisAilleurs(cp, broadcasterId, titre, e) {
  if (/DUPLICATE/i.test(messageTwitch(e))) return true;
  if (e?.statusCode !== 400) return false;
  try {
    const toutes = await cp.getCustomRewards(broadcasterId, false);
    return toutes.some((r) => norme(r.title) === norme(titre));
  } catch {
    return false;
  }
}

// Ce que StreamKit regle sur une recompense existante, et ce qui differe.
function ecarts(r, voulue) {
  const data = {};
  const changements = [];
  const noter = (cle, valeur, texte) => {
    data[cle] = valeur;
    changements.push(texte);
  };

  if (r.title !== voulue.titre)
    noter('title', voulue.titre, 'nom « ' + r.title + ' » → « ' + voulue.titre + ' »');
  if (r.cost !== voulue.cout)
    noter('cost', voulue.cout, 'coût ' + points(r.cost) + ' → ' + points(voulue.cout));
  // Le delai, seulement pour un module qui le regle : le bot musique n'en a
  // pas, et n'a pas a effacer celui que le streamer aurait pose sur Twitch.
  if (voulue.cooldownSec !== undefined) {
    const avant = r.globalCooldown ?? 0;
    const apres = Math.max(0, Number(voulue.cooldownSec) || 0);
    if (avant !== apres) noter('globalCooldown', apres, 'délai ' + avant + ' s → ' + apres + ' s');
  }
  if (voulue.prompt !== undefined && r.prompt !== voulue.prompt)
    noter('prompt', voulue.prompt, 'description');
  if (voulue.couleur && norme(r.backgroundColor) !== norme(voulue.couleur)) {
    noter('backgroundColor', voulue.couleur, 'couleur');
  }
  // Le module en a besoin pour marcher : le titre d'un morceau a demander, et
  // des utilisations qu'on peut encore rembourser (une validation automatique
  // l'interdit).
  if (!!r.userInputRequired !== !!voulue.saisieRequise) {
    noter(
      'userInputRequired',
      !!voulue.saisieRequise,
      voulue.saisieRequise ? 'saisie demandée' : 'sans saisie'
    );
  }
  if (!!r.autoFulfill !== !!voulue.autoFulfill) {
    noter(
      'autoFulfill',
      !!voulue.autoFulfill,
      'validation ' + (voulue.autoFulfill ? 'automatique' : 'par StreamKit')
    );
  }
  return { data, changements };
}

async function aligner(cp, broadcasterId, r, voulue) {
  const resultat = { id: r.id, titre: r.title, cout: r.cost, creee: false, changements: [] };
  const { data, changements } = ecarts(r, voulue);
  if (!changements.length) return resultat;
  try {
    await cp.updateCustomReward(broadcasterId, r.id, data);
    return { ...resultat, titre: data.title ?? r.title, cout: data.cost ?? r.cost, changements };
  } catch (e) {
    // La recompense marche toujours, avec ses anciennes valeurs : on previent
    // sans arreter le module.
    const m = messageTwitch(e);
    const raison =
      data.title && /DUPLICATE/i.test(m)
        ? 'le nom « ' + voulue.titre + ' » est déjà pris par une autre récompense de ta chaîne'
        : m;
    return {
      ...resultat,
      avertissement:
        'Twitch refuse de mettre à jour la récompense « ' +
        r.title +
        ' » (' +
        changements.join(', ') +
        ') : ' +
        raison +
        '. Elle garde ses anciens réglages.',
    };
  }
}

// Trouve la recompense du module -- par son identifiant retenu, sinon par son
// nom -- et l'aligne sur les reglages, ou la cree. L'identifiant retenu permet
// de RENOMMER : sans lui, un nouveau nom creait une seconde recompense, et
// l'ancienne restait sur la chaine, utilisable mais plus surveillee.
//
// Retour : { id, titre, cout, creee, changements, avertissement? }. Leve une
// erreur lisible par le streamer quand le module ne peut pas marcher.
export async function assurerRecompense(api, broadcasterId, voulue, { idConnu } = {}) {
  const cp = api.channelPoints;

  let gerables;
  try {
    gerables = await cp.getCustomRewards(broadcasterId, true);
  } catch (e) {
    throw new Error(traduire(e, 'lire les récompenses de ta chaîne'), { cause: e });
  }

  const trouvee =
    (idConnu && gerables.find((r) => r.id === idConnu)) ||
    gerables.find((r) => norme(r.title) === norme(voulue.titre));
  if (trouvee) return aligner(cp, broadcasterId, trouvee, voulue);

  try {
    const r = await cp.createCustomReward(broadcasterId, {
      title: voulue.titre,
      cost: voulue.cout,
      prompt: voulue.prompt,
      userInputRequired: !!voulue.saisieRequise,
      autoFulfill: !!voulue.autoFulfill,
      backgroundColor: voulue.couleur,
      isEnabled: true,
      ...(voulue.cooldownSec > 0 ? { globalCooldown: voulue.cooldownSec } : {}),
    });
    return { id: r.id, titre: r.title, cout: r.cost, creee: true, changements: [] };
  } catch (e) {
    if (await titrePrisAilleurs(cp, broadcasterId, voulue.titre, e)) {
      throw new Error(doublon(voulue.titre), { cause: e });
    }
    throw new Error(traduire(e, 'créer la récompense « ' + voulue.titre + ' »'), { cause: e });
  }
}
