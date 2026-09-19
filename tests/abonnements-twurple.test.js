// Le piege de Twurple qui rendait sondages et recompenses muets, rejoue avec le
// VRAI EventSubWsListener : un faux serveur EventSub (WebSocket local) et une
// fausse API Twitch dont on regle la vitesse d'effacement et de creation.
//
// Jusqu'a la 0.25.0, redemarrer un module (chaque Enregistrer) effacait ses
// abonnements puis les reposait aussitot. Quand l'effacement de l'ancien est
// confirme apres la creation du nouveau, Twurple retire le nouveau de ses
// tables : Twitch envoie l'evenement, Twurple le jette (« unknown event »). Le
// premier test fige ce comportement de la bibliotheque -- s'il casse un jour,
// Twurple aura change et ce test le dira. Le second montre que les abonnements
// partages de StreamKit (creerCanaux) n'y sont plus exposes.

import test from 'node:test';
import assert from 'node:assert/strict';

import { EventSubWsListener } from '@twurple/eventsub-ws';
import { HelixEventSubSubscription } from '@twurple/api';
// `ws` vient avec Twurple (@d-fischer/connection) : pas de dependance en plus.
import { WebSocketServer } from 'ws';

import { creerCanaux, creerSuivi } from '../src/core/abonnements.js';

const DIFFUSEUR = '42';
const pause = (ms) =>
  new Promise((ok) => {
    setTimeout(ok, ms);
  });
const muet = Object.fromEntries(['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, () => {}]));

// Faux Twitch : serveur EventSub + API. `effacementMs` / `creationMs` : duree
// des appels d'API, pour ordonner les reponses a volonte.
async function fauxTwitch({ effacementMs, creationMs }) {
  const serveur = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((ok) => {
    serveur.once('listening', ok);
  });
  let socket = null;
  let n = 0;
  const actifs = new Set(); // abonnements existants chez « Twitch »
  const journalTwurple = [];

  const envoyer = (message_type, payload) =>
    socket.send(
      JSON.stringify({
        metadata: { message_id: 'm' + ++n, message_type, message_timestamp: new Date().toISOString() },
        payload,
      })
    );
  serveur.on('connection', (ws) => {
    socket = ws;
    envoyer('session_welcome', {
      session: { id: 'session-1', status: 'connected', keepalive_timeout_seconds: 30, reconnect_url: null },
    });
  });

  const apiClient = {
    _authProvider: { clientId: 'client' },
    eventSub: {
      async subscribeToChannelPollBeginEvents(_utilisateur, transport) {
        await pause(creationMs);
        const id = 'tw-' + ++n;
        actifs.add(id);
        return new HelixEventSubSubscription({
          id,
          status: 'enabled',
          type: 'channel.poll.begin',
          version: '1',
          condition: { broadcaster_user_id: DIFFUSEUR },
          created_at: new Date().toISOString(),
          transport,
          cost: 0,
        });
      },
    },
    asUser: async (_utilisateur, fn) =>
      fn({
        eventSub: {
          async deleteSubscription(id) {
            await pause(effacementMs);
            actifs.delete(id);
          },
        },
      }),
  };

  const listener = new EventSubWsListener({
    apiClient,
    url: 'ws://127.0.0.1:' + serveur.address().port,
    logger: { minLevel: 'error', custom: (_niveau, m) => journalTwurple.push(m.split('\n')[0]) },
  });
  listener.start();

  return {
    listener,
    actifs,
    journalTwurple,
    // Le streamer lance un sondage : Twitch l'envoie a chaque abonnement actif.
    async lancerSondage(titre) {
      for (const id of actifs) {
        envoyer('notification', {
          subscription: { id, type: 'channel.poll.begin', version: '1', status: 'enabled' },
          event: {
            id: 'sondage',
            broadcaster_user_id: DIFFUSEUR,
            broadcaster_user_login: 'streamer',
            broadcaster_user_name: 'Streamer',
            title: titre,
            choices: [{ id: 'a', title: 'Octane' }],
            bits_voting: { is_enabled: false, amount_per_vote: 0 },
            channel_points_voting: { is_enabled: false, amount_per_vote: 0 },
            started_at: new Date().toISOString(),
            ends_at: new Date(Date.now() + 60000).toISOString(),
          },
        });
      }
      await pause(200);
    },
    fermer() {
      listener.stop();
      serveur.close();
    },
  };
}

test('Twurple jette les evenements d un abonnement efface puis repose aussitot', async () => {
  // Effacement lent, creation rapide : la confirmation de l'effacement arrive
  // apres l'enregistrement du nouvel abonnement.
  const t = await fauxTwitch({ effacementMs: 300, creationMs: 20 });
  try {
    const recus = [];
    const ancien = t.listener.onChannelPollBegin(DIFFUSEUR, (e) => recus.push('ancien : ' + e.title));
    await pause(200);

    // Ce que faisait un redemarrage de module jusqu'a la 0.25.0.
    ancien.stop();
    t.listener.onChannelPollBegin(DIFFUSEUR, (e) => recus.push('nouveau : ' + e.title));
    await pause(500);

    assert.equal(t.actifs.size, 1, 'Twitch a bien un abonnement actif');
    await t.lancerSondage('Quelle voiture ?');
    assert.deepEqual(recus, [], 'et pourtant rien n arrive');
    assert.ok(t.journalTwurple.some((m) => /Notification from unknown event received/.test(m)));
  } finally {
    t.fermer();
  }
});

test('abonnements partages : le module redemarre recoit bien le sondage', async () => {
  const t = await fauxTwitch({ effacementMs: 300, creationMs: 20 });
  try {
    const canaux = creerCanaux({ suivi: creerSuivi({ logSocle: muet }) });
    const decl = {
      nom: 'sondage:debut',
      creer: (recevoir) => t.listener.onChannelPollBegin(DIFFUSEUR, recevoir),
      log: muet,
      quoi: 'sondages',
    };
    const recus = [];
    const debrancher = canaux.brancher(decl, (e) => recus.push('ancien : ' + e.title));
    await pause(200);

    // Enregistrer dans le module : il s'arrete, puis redemarre.
    debrancher();
    canaux.brancher(decl, (e) => recus.push('nouveau : ' + e.title));
    await pause(500);

    assert.equal(t.actifs.size, 1);
    await t.lancerSondage('Quelle voiture ?');
    assert.deepEqual(recus, ['nouveau : Quelle voiture ?']);
    assert.deepEqual(t.journalTwurple, []);
  } finally {
    t.fermer();
  }
});
