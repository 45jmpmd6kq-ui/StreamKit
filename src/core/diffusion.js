// Diffusion temps reel vers les navigateurs (SSE).
//
// SSE plutot que WebSocket : c'est unidirectionnel (serveur -> page), ca suffit
// pour un overlay et pour un flux de journal, ca traverse les proxys, et le
// navigateur d'OBS reconnecte tout seul. Zero dependance.
//
// Un « canal » = un groupe d'abonnes (le journal, ou les overlays d'un module).
// Chaque canal garde le dernier etat connu : une source OBS qui se reconnecte
// au milieu du live retrouve immediatement ce qu'elle doit afficher, au lieu de
// rester vide jusqu'au prochain evenement.

const canaux = new Map(); // nom -> { clients:Set, dernierEtat:any }

function canal(nom) {
  if (!canaux.has(nom)) canaux.set(nom, { clients: new Set(), dernierEtat: null });
  return canaux.get(nom);
}

export function brancher(nom, req, res, { etatInitial = true } = {}) {
  const c = canal(nom);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const client = { res };
  c.clients.add(client);

  if (etatInitial && c.dernierEtat) envoyer(res, 'etat', c.dernierEtat);

  // Battement de coeur : sans trafic, une source OBS en veille peut fermer la
  // connexion sans prevenir. On envoie un commentaire toutes les 25 s.
  const battement = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      fermer();
    }
  }, 25000);

  function fermer() {
    clearInterval(battement);
    c.clients.delete(client);
  }

  req.on('close', fermer);
  req.on('error', fermer);
  return fermer;
}

function envoyer(res, type, data) {
  try {
    res.write('event: ' + type + '\n');
    res.write('data: ' + JSON.stringify(data) + '\n\n');
  } catch {
    /* client parti : il sera retire au prochain passage */
  }
}

export function diffuser(nom, type, data) {
  const c = canal(nom);
  if (type === 'etat') c.dernierEtat = data; // on ne memorise que l'etat, pas les notifs
  for (const client of c.clients) envoyer(client.res, type, data);
  return c.clients.size;
}

export function nbClients(nom) {
  return canal(nom).clients.size;
}
