// Connexion a l'API de stats officielle de Rocket League.
//
// Psyonix l'appelle « web socket », mais les versions actuelles du jeu ouvrent
// un simple socket TCP sur 127.0.0.1 (port 49123 par defaut) et y deversent des
// objets JSON colles les uns aux autres : ni longueur, ni separateur. Il faut
// donc les decouper nous-memes, en suivant les accolades.
//
// Trois pieges connus (releves par d'autres outils branches sur cette API) :
//   - `Data` arrive tantot en objet, tantot en CHAINE JSON a re-decoder ;
//   - un caractere accentue (pseudo, nom d'equipe) peut etre coupe entre deux
//     paquets TCP : on decode avec un StringDecoder, jamais paquet par paquet ;
//   - le jeu ferme sans prevenir quand on quitte : la deconnexion n'est vue que
//     par le keep-alive TCP, quelques secondes plus tard.
//
// Rien ici ne parle de Rocket League au-dela du format : c'est le module qui
// interprete les evenements.

import net from 'node:net';
import { StringDecoder } from 'node:string_decoder';

export const PORT_PAR_DEFAUT = 49123;

// Au-dela, ce qui s'accumule n'est plus un message en cours mais du bruit : on
// repart de zero plutot que de laisser grossir la memoire toute la soiree.
const TAMPON_MAX = 4 * 1024 * 1024;

// Extrait les objets JSON complets d'un texte. Ce qui suit le dernier objet
// complet (un message coupe en deux paquets) est rendu dans `reste`.
export function decouper(tampon) {
  const messages = [];
  let debut = -1;
  let profondeur = 0;
  let dansChaine = false;
  let echappe = false;
  let consomme = 0;

  for (let i = 0; i < tampon.length; i++) {
    const c = tampon[i];
    if (debut < 0) {
      // Entre deux objets : espaces, retours a la ligne... on les jette.
      if (c === '{') {
        debut = i;
        profondeur = 1;
      } else {
        consomme = i + 1;
      }
      continue;
    }
    if (dansChaine) {
      // Une accolade dans un pseudo ne compte pas, ni un guillemet echappe.
      if (echappe) echappe = false;
      else if (c === '\\') echappe = true;
      else if (c === '"') dansChaine = false;
      continue;
    }
    if (c === '"') dansChaine = true;
    else if (c === '{') profondeur++;
    else if (c === '}' && --profondeur === 0) {
      messages.push(tampon.slice(debut, i + 1));
      debut = -1;
      consomme = i + 1;
    }
  }
  return { messages, reste: tampon.slice(consomme) };
}

// Texte d'un message -> { evenement, data }, ou null si illisible.
export function lireMessage(texte) {
  let m;
  try {
    m = JSON.parse(texte);
  } catch {
    return null;
  }
  if (!m || typeof m.Event !== 'string') return null;
  let data = m.Data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = {};
    }
  }
  return { evenement: m.Event, data: data && typeof data === 'object' ? data : {} };
}

// Client qui se reconnecte tout seul.
//
//   surMessage({ evenement, data })
//   surEtat(connecte)            appele a chaque changement
//   planifier(fn, ms)            ctx.minuteur.delai en vrai (coupe a l'arret)
//   creerSocket                  injectable pour les tests
export function creerClient({
  port = PORT_PAR_DEFAUT,
  surMessage,
  surEtat = () => {},
  planifier,
  delaiReconnexionMs = 3000,
  creerSocket = (options) => net.createConnection(options),
}) {
  let socket = null;
  let connecte = false;
  let arrete = false;

  function connecter() {
    if (arrete) return;
    const decodeur = new StringDecoder('utf8');
    let tampon = '';
    const s = creerSocket({ host: '127.0.0.1', port });
    socket = s;

    s.on('connect', () => {
      // Sans keep-alive, un jeu ferme brutalement laisserait la connexion
      // « ouverte » pendant deux heures (reglage par defaut de Windows).
      s.setKeepAlive?.(true, 1000);
      connecte = true;
      surEtat(true);
    });

    s.on('data', (morceau) => {
      tampon += decodeur.write(morceau);
      const { messages, reste } = decouper(tampon);
      tampon = reste.length > TAMPON_MAX ? '' : reste;
      for (const texte of messages) {
        const message = lireMessage(texte);
        if (message) surMessage(message);
      }
    });

    // Jeu ferme = ECONNREFUSED toutes les 3 s : c'est l'etat normal hors jeu,
    // 'close' suit toujours et s'occupe de la suite.
    s.on('error', () => {});

    s.on('close', () => {
      if (socket !== s) return; // une ancienne connexion qui se termine
      socket = null;
      if (connecte) {
        connecte = false;
        surEtat(false);
      }
      if (!arrete) planifier(connecter, delaiReconnexionMs);
    });
  }

  return {
    demarrer: connecter,
    arreter() {
      arrete = true;
      socket?.destroy();
      socket = null;
    },
    estConnecte: () => connecte,
  };
}
