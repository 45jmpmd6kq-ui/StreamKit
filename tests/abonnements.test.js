// Abonnements EventSub refuses par Twitch.
//
// Un refus etait silencieux : le module s'affichait demarre et ne recevait
// rien -- pour Random Car, des utilisations sans machine a sous a l'ecran. On
// verifie ici que le refus arrive dans le journal du bon module, et que le
// conflit d'un redemarrage (l'ancien abonnement pas encore efface) se retente.

import test from 'node:test';
import assert from 'node:assert/strict';

import { creerSuivi, ESSAIS_CONFLIT, PAS_CONFLIT_MS } from '../src/core/abonnements.js';

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

test('conflit au redemarrage : retente, un peu plus tard a chaque fois, puis abandonne', () => {
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

test('un abonnement retire entre-temps n est pas relance', () => {
  // Le streamer eteint le module pendant l'attente : le relancer ferait
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
