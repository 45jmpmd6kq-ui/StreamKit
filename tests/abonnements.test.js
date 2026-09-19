// Abonnements EventSub : partages entre redemarrages, et suivis.
//
// Un refus etait silencieux : le module s'affichait demarre et ne recevait
// rien -- pour Random Car, des utilisations sans machine a sous a l'ecran. On
// verifie ici que le refus arrive dans le journal du bon module, qu'un conflit
// (409) se retente, qu'un module qui redemarre garde l'abonnement Twitch, et
// que les messages de Twurple qui expliquent une panne arrivent au journal.
// Le comportement de Twurple lui-meme est teste dans abonnements-twurple.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  creerCanaux,
  creerJournalTwurple,
  creerSuivi,
  ESSAIS_CONFLIT,
  PAS_CONFLIT_MS,
  REPIT_MESSAGE_MS,
} from '../src/core/abonnements.js';

function journal() {
  const lignes = [];
  const log = Object.fromEntries(
    ['debug', 'info', 'ok', 'warn', 'err'].map((n) => [n, (m) => lignes.push([n, m])])
  );
  return { log, lignes, de: (niveau) => lignes.filter(([n]) => n === niveau).map(([, m]) => m) };
}

// Un abonnement Twurple : on ne compte que ses relances.
const abonnement = (id = 'channel.channel_points_custom_reward_redemption.add.42.roue') => ({
  id,
  demarrages: 0,
  start() {
    this.demarrages++;
  },
});

const refus = (statusCode, message) =>
  Object.assign(new Error('Encountered HTTP status code ' + statusCode), {
    statusCode,
    body: JSON.stringify({ status: statusCode, message }),
  });

function banc() {
  const socle = journal();
  const module = journal();
  const planifies = [];
  const suivi = creerSuivi({ logSocle: socle.log, planifier: (fn, ms) => planifies.push({ fn, ms }) });
  return { socle, module, planifies, suivi };
}

test('un refus s ecrit dans le journal du module qui a pose l abonnement', () => {
  const b = banc();
  const a = b.suivi.suivre(abonnement(), b.module.log, 'utilisations de la récompense');
  b.suivi.echec(a, refus(403, 'subscription missing proper authorization'));

  const [ligne] = b.module.de('err');
  assert.match(
    ligne,
    /Abonnement Twitch refusé \(utilisations de la récompense\) : 403 subscription missing proper authorization/
  );
  assert.equal(b.planifies.length, 0, 'un refus de droits ne se retente pas');
  assert.equal(b.socle.lignes.length, 0);
});

test('conflit (409) : retente, un peu plus tard a chaque fois, puis abandonne', () => {
  const b = banc();
  const a = b.suivi.suivre(abonnement(), b.module.log, 'utilisations de la récompense');

  for (let i = 1; i <= ESSAIS_CONFLIT; i++) {
    b.suivi.echec(a, refus(409, 'subscription already exists'));
    assert.equal(b.planifies.length, i);
    assert.equal(b.planifies[i - 1].ms, PAS_CONFLIT_MS * i);
    b.planifies[i - 1].fn();
    assert.equal(a.demarrages, i, 'l abonnement est relance');
  }
  assert.deepEqual(b.module.de('err'), []);

  b.suivi.echec(a, refus(409, 'subscription already exists'));
  assert.equal(b.planifies.length, ESSAIS_CONFLIT, 'plus de nouvel essai');
  assert.match(b.module.de('err')[0], /409 subscription already exists/);
});

test('un abonnement abandonne entre-temps n est pas relance', () => {
  // La connexion Twitch s'arrete pendant l'attente : le relancer ferait
  // revivre un abonnement dont plus personne ne veut.
  const b = banc();
  const a = b.suivi.suivre(abonnement(), b.module.log, 'sondages');
  b.suivi.echec(a, refus(409, 'subscription already exists'));
  b.suivi.oublier(a);
  b.planifies[0].fn();
  assert.equal(a.demarrages, 0);
});

test('retabli apres un conflit : le journal le dit, et les essais repartent de zero', () => {
  const b = banc();
  const a = b.suivi.suivre(abonnement(), b.module.log, 'utilisations de la récompense');
  b.suivi.echec(a, refus(409, 'subscription already exists'));
  b.suivi.succes(a);
  assert.deepEqual(b.module.de('ok'), ['Abonnement Twitch rétabli (utilisations de la récompense).']);

  b.suivi.echec(a, refus(409, 'subscription already exists'));
  assert.equal(b.planifies.at(-1).ms, PAS_CONFLIT_MS, 'premier essai d une nouvelle serie');
});

test('un abonnement que personne n a declare finit dans le journal du socle', () => {
  const b = banc();
  b.suivi.echec(abonnement('stream.online.42'), refus(429, 'Too Many Requests'));
  assert.deepEqual(b.socle.de('warn'), [
    'Abonnement Twitch refusé (stream.online.42) : 429 Too Many Requests',
  ]);
});

test('revocation par Twitch : dite dans le journal du module, avec la marche a suivre', () => {
  const b = banc();
  const a = b.suivi.suivre(abonnement(), b.module.log, 'sondages');
  b.suivi.revoque(a, 'authorization_revoked');
  assert.match(
    b.module.de('err')[0],
    /Twitch a coupé l’abonnement \(sondages\) : l’autorisation de StreamKit a été retirée/
  );
  assert.match(b.module.de('err')[0], /reconnecte ta chaîne/);
});

// --- Abonnements partages ----------------------------------------------------

// Une fausse fabrique d'abonnements : compte les creations, et garde de quoi
// simuler un evenement Twitch.
function fabrique() {
  const crees = [];
  return {
    crees,
    creer: (recevoir) => {
      const a = { id: 'channel.poll.begin.42', recevoir, start() {} };
      crees.push(a);
      return a;
    },
  };
}

function canaux() {
  const socle = journal();
  const suivi = creerSuivi({ logSocle: socle.log, planifier: () => {} });
  return { canaux: creerCanaux({ suivi }), suivi };
}

test('un module qui redemarre garde l abonnement Twitch : seul son gestionnaire change', async () => {
  // Le coeur du correctif : effacer puis reposer l'abonnement perdait les
  // evenements (voir abonnements-twurple).
  const { canaux: c } = canaux();
  const f = fabrique();
  const recus = [];
  const decl = { nom: 'sondage:debut', creer: f.creer, log: journal().log, quoi: 'sondages' };

  const debrancher = c.brancher(decl, (e) => recus.push('avant : ' + e));
  debrancher(); // Enregistrer : le module s'arrete...
  c.brancher(decl, (e) => recus.push('apres : ' + e)); // ...et redemarre

  assert.equal(f.crees.length, 1, 'aucun second abonnement demande a Twitch');
  await f.crees[0].recevoir('sondage lancé');
  assert.deepEqual(recus, ['apres : sondage lancé']);
});

test('deux gestionnaires sur le meme evenement : chacun le recoit, meme si l autre plante', async () => {
  const { canaux: c } = canaux();
  const f = fabrique();
  const log = journal();
  const recus = [];
  const decl = { nom: 'sondage:debut', creer: f.creer, log: log.log, quoi: 'sondages' };
  c.brancher(decl, () => {
    throw new Error('boum');
  });
  c.brancher(decl, (e) => recus.push(e));

  await f.crees[0].recevoir('x');
  assert.deepEqual(recus, ['x']);
  assert.match(log.de('err')[0], /erreur sur un événement Twitch \(sondages\) : boum/);
});

test('une nouvelle connexion repose ses abonnements, une revocation aussi', () => {
  const { canaux: c } = canaux();
  const f = fabrique();
  const decl = { nom: 'pub', creer: f.creer, log: journal().log, quoi: 'pubs' };
  c.brancher(decl, () => {});

  c.vider(); // Twitch reconnecte : l'ancien listener est parti avec ses abonnements
  c.brancher(decl, () => {});
  assert.equal(f.crees.length, 2);

  c.retirer(f.crees[1]); // revoque par Twitch
  c.brancher(decl, () => {});
  assert.equal(f.crees.length, 3);
  assert.equal(c.nombre(), 1);
});

// --- Journal de Twurple ------------------------------------------------------

function twurple() {
  const j = journal();
  let t = 0;
  const ecrire = creerJournalTwurple({ log: j.log, maintenant: () => t });
  return { j, ecrire, avancer: (ms) => (t += ms) };
}

test('evenement jete comme trop ancien : c est l horloge du PC, dit une fois par 10 minutes', () => {
  const b = twurple();
  for (let i = 0; i < 5; i++) b.ecrire(4, 'Old notification(s) prevented for event: channel.poll.begin.42');
  assert.equal(b.j.de('warn').length, 1);
  assert.match(b.j.de('warn')[0], /l’horloge de ce PC est sans doute en avance/);

  b.avancer(REPIT_MESSAGE_MS);
  b.ecrire(4, 'Old notification(s) prevented for event: channel.poll.begin.42');
  assert.equal(b.j.de('warn').length, 2);
});

test('evenement pour un abonnement inconnu : dit, sans inonder', () => {
  const b = twurple();
  b.ecrire(1, 'Notification from unknown event received: tw-2');
  b.ecrire(1, 'Notification from unknown event received: tw-2');
  assert.equal(b.j.de('warn').length, 1);
  assert.match(b.j.de('warn')[0], /abonnement que StreamKit ne suit plus/);
});

test('le reste : erreurs et avertissements passent, les paquets recus non', () => {
  const b = twurple();
  b.ecrire(1, 'Subscription channel.poll.begin.42 failed to subscribe: 409'); // deja dit par le suivi
  b.ecrire(4, 'Received data: {"metadata":{}}');
  b.ecrire(4, 'Duplicate notification prevented for event: x');
  b.ecrire(2, 'Unknown message type encountered: bizarre\ndetail');
  b.ecrire(3, 'Connection established');
  assert.deepEqual(b.j.lignes, [
    ['warn', 'Twurple : Unknown message type encountered: bizarre'],
    ['debug', 'Twurple : Connection established'],
  ]);
});
