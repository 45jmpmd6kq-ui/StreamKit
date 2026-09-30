// Diffusion temps reel vers les navigateurs.
//
// Deux transports pour un meme canal :
//
//   SSE (EventSource)  le journal du dashboard, et les overlays d'avant la
//                      0.29.1 qu'OBS aurait encore en memoire ;
//   WebSocket          les overlays, depuis la 0.29.1.
//
// Pourquoi les overlays ont quitte SSE : toutes les sources Navigateur d'OBS
// partagent UN moteur Chromium, qui ne garde que 6 connexions HTTP ouvertes
// par hote. Un flux SSE en occupe une pour toujours. Au 7e overlay StreamKit
// charge dans OBS -- toutes scenes confondues -- la page attendait une place
// qui ne se liberait jamais, et la source restait vide (constate chez un
// streamer le 30/09/2026, reproduit sur un OBS 32.2.2 isole : 6 overlays,
// le 7e vide ; on en ferme un, il apparait). Les WebSocket n'entrent pas dans
// ce compte. Cote serveur, zero dependance : le protocole se limite ici a
// envoyer du texte et a repondre aux trames de controle.
//
// Un « canal » = un groupe d'abonnes (le journal, ou les overlays d'un module).
// Chaque canal garde le dernier etat connu : une source OBS qui se reconnecte
// au milieu du live retrouve immediatement ce qu'elle doit afficher, au lieu de
// rester vide jusqu'au prochain evenement.

import { createHash } from 'node:crypto';

const canaux = new Map(); // nom -> { clients:Set, dernierEtat:any }

// Battement de coeur : sans trafic, une source OBS en veille peut fermer la
// connexion sans prevenir. On envoie quelque chose toutes les 25 s.
const BATTEMENT = 25000;

function canal(nom) {
  if (!canaux.has(nom)) canaux.set(nom, { clients: new Set(), dernierEtat: null });
  return canaux.get(nom);
}

// --- SSE ------------------------------------------------------------------

export function brancher(nom, req, res, { etatInitial = true } = {}) {
  const c = canal(nom);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const client = {
    envoyer(type, data) {
      try {
        res.write('event: ' + type + '\n');
        res.write('data: ' + JSON.stringify(data) + '\n\n');
      } catch {
        /* client parti : il sera retire au prochain passage */
      }
    },
  };
  c.clients.add(client);

  if (etatInitial && c.dernierEtat) client.envoyer('etat', c.dernierEtat);

  const battement = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      fermer();
    }
  }, BATTEMENT);

  function fermer() {
    clearInterval(battement);
    c.clients.delete(client);
  }

  req.on('close', fermer);
  req.on('error', fermer);
  return fermer;
}

// --- WebSocket (RFC 6455, le strict necessaire) ----------------------------

const GUID_WS = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// Une trame serveur -> client : jamais masquee, toujours d'un seul tenant.
function trame(opcode, charge = Buffer.alloc(0)) {
  const n = charge.length;
  let tete;
  if (n < 126) {
    tete = Buffer.from([0x80 | opcode, n]);
  } else if (n < 65536) {
    tete = Buffer.alloc(4);
    tete[0] = 0x80 | opcode;
    tete[1] = 126;
    tete.writeUInt16BE(n, 2);
  } else {
    tete = Buffer.alloc(10);
    tete[0] = 0x80 | opcode;
    tete[1] = 127;
    tete.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([tete, charge]);
}

// Le message : « type », saut de ligne, puis les donnees en JSON. Le script
// commun des overlays (src/commun/flux.js) le redecoupe en { type, data } --
// la forme exacte d'un evenement EventSource, pour que les overlays n'aient
// rien d'autre a changer que leur constructeur.
export function messageWs(type, data) {
  return trame(0x1, Buffer.from(type + '\n' + JSON.stringify(data), 'utf8'));
}

// Accepte la poignee de main et abonne la socket au canal. Le serveur a deja
// verifie le chemin, l'hote et l'origine.
export function brancherWs(nom, req, socket, { etatInitial = true } = {}) {
  const cle = req.headers['sec-websocket-key'];
  if (!cle || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  const accepte = createHash('sha1')
    .update(cle + GUID_WS)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' +
      accepte +
      '\r\n\r\n'
  );
  socket.setNoDelay(true);

  const c = canal(nom);
  let ferme = false;
  const client = {
    envoyer(type, data) {
      if (ferme) return;
      try {
        socket.write(messageWs(type, data));
      } catch {
        fermer();
      }
    },
  };
  c.clients.add(client);

  if (etatInitial && c.dernierEtat) client.envoyer('etat', c.dernierEtat);

  // Un ping : le navigateur y repond tout seul, et ca garde la connexion vivante.
  const battement = setInterval(() => {
    try {
      socket.write(trame(0x9));
    } catch {
      fermer();
    }
  }, BATTEMENT);

  // Le client n'envoie rien d'utile : on ne lit que les trames de controle
  // (fermeture, ping). Le reste est ignore, sans rien accumuler.
  let tampon = Buffer.alloc(0);
  socket.on('data', (morceau) => {
    tampon = Buffer.concat([tampon, morceau]);
    for (;;) {
      if (tampon.length < 2) return;
      const opcode = tampon[0] & 0x0f;
      const masque = (tampon[1] & 0x80) !== 0;
      let n = tampon[1] & 0x7f;
      let pos = 2;
      if (n === 126) {
        if (tampon.length < 4) return;
        n = tampon.readUInt16BE(2);
        pos = 4;
      } else if (n === 127) {
        if (tampon.length < 10) return;
        const grand = tampon.readBigUInt64BE(2);
        // Un overlay n'envoie jamais rien d'aussi gros : on coupe.
        if (grand > 65536n) return fermer(true);
        n = Number(grand);
        pos = 10;
      }
      if (n > 65536) return fermer(true);
      const fin = pos + (masque ? 4 : 0) + n;
      if (tampon.length < fin) return;
      let charge = tampon.subarray(pos + (masque ? 4 : 0), fin);
      if (masque) {
        const m = tampon.subarray(pos, pos + 4);
        charge = Buffer.from(charge.map((o, i) => o ^ m[i % 4]));
      }
      tampon = tampon.subarray(fin);
      if (opcode === 0x8) return fermer(true);
      if (opcode === 0x9) {
        try {
          socket.write(trame(0xa, charge));
        } catch {
          /* ferme juste apres */
        }
      }
    }
  });

  function fermer(poli = false) {
    if (ferme) return;
    ferme = true;
    clearInterval(battement);
    c.clients.delete(client);
    try {
      if (poli) socket.end(trame(0x8));
      else socket.destroy();
    } catch {
      /* deja ferme */
    }
  }

  socket.on('close', () => fermer());
  socket.on('error', () => fermer());
  socket.on('end', () => fermer());
  return fermer;
}

// --- Commun ----------------------------------------------------------------

export function diffuser(nom, type, data) {
  const c = canal(nom);
  if (type === 'etat') c.dernierEtat = data; // on ne memorise que l'etat, pas les notifs
  for (const client of c.clients) client.envoyer(type, data);
  return c.clients.size;
}

export function nbClients(nom) {
  return canal(nom).clients.size;
}
