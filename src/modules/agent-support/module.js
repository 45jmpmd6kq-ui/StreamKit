// Agent de support : lance et surveille, depuis StreamKit, la session Claude
// Code reliee au bot Discord des rapports de bug. Le lanceur et les consignes de
// l'agent vivent hors du depot (dossier StreamKit-Support du proprietaire).
//
// Ce module n'existe que sur le PC du proprietaire : sans fichier temoin dans
// le dossier de donnees, disponible() le tient hors du registre. Chez un
// streamer, il n'apparait nulle part.
//
// Interrupteur allume = l'agent tourne ; l'eteindre ferme sa fenetre. Mais
// StreamKit arrete tous ses modules quand il se ferme, se met a jour ou se
// reconnecte a Twitch : ces arrets-la laissent l'agent vivre (il peut etre en
// pleine publication), et le module le reprend au demarrage suivant.

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { FICHIER_TEMOIN, lireLanceur, analyser, io } from './processus.js';

const RYTHME_MS = 10_000;
// Fenetre ouverte mais Claude pas encore la : au-dela, le lanceur est bloque.
const DEMARRAGE_MAX_MS = 60_000;
// Le serveur du bot met quelques secondes a se connecter apres Claude.
const CONNEXION_BOT_MS = 30_000;

// Fixe par disponible() au chargement : un module n'a pas d'autre acces au
// dossier de donnees.
let cheminTemoin = null;

// Dernier lancement, tous contextes confondus : une fenetre qui s'ouvre met un
// instant a apparaitre dans la liste des processus, et deux agents sur le meme
// bot repondraient deux fois a chaque message.
let dernierLancement = 0;

const heure = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

async function observer() {
  const e = analyser(await io.lister());
  if (!e.enMarche && !e.demarrage && Date.now() - dernierLancement < 20_000) return { ...e, demarrage: true };
  return e;
}

// Lance l'agent, sauf s'il tourne deja ou s'il est en train de demarrer.
async function assurerAgent(log) {
  const lanceur = lireLanceur(cheminTemoin);
  const e = await observer();
  if (e.enMarche) {
    log.info('Agent déjà en marche (lancé à ' + heure(e.depuis) + ') : StreamKit le reprend.');
    return { e, message: 'Déjà en marche' };
  }
  if (e.demarrage) return { e, message: 'Démarrage déjà en cours' };
  io.lancer(lanceur);
  dernierLancement = Date.now();
  log.ok("Agent lancé : sa fenêtre s'ouvre.");
  return { e: { enMarche: false, demarrage: true }, message: 'Agent lancé' };
}

function ligneSante(e, demarrageDepuis) {
  const l = (etat, detail, aide = '') => [
    { id: 'agent-support', nom: 'Agent de support', etat, detail, aide },
  ];
  if (!e) return l('inactif', "Recherche de l'agent…");
  if (e.erreur) return l('attention', e.erreur);
  if (e.enMarche && e.bot) return l('ok', 'Bot connecté · lancé à ' + heure(e.depuis));
  if (e.enMarche) {
    if (e.depuis && Date.now() - e.depuis < CONNEXION_BOT_MS) return l('inactif', 'Connexion du bot…');
    return l(
      'attention',
      "Claude tourne, mais le bot Discord n'est pas connecté",
      "Jeton absent ou refusé : relance poser-jeton-bot.bat, ferme la fenêtre de l'agent, puis « Lancer l'agent »."
    );
  }
  if (e.demarrage) {
    if (Date.now() - (demarrageDepuis ?? Date.now()) < DEMARRAGE_MAX_MS)
      return l('inactif', "Démarrage de l'agent…");
    return l('attention', "Le lanceur n'est pas allé au bout", 'Sa fenêtre dit pourquoi.');
  }
  return l('attention', "Fenêtre de l'agent fermée", "« Lancer l'agent » dans le module pour le relancer.");
}

export default {
  id: 'agent-support',
  nom: 'Agent de support',
  description: 'Lance l’agent Claude qui traite les rapports de bug sur Discord, et dit s’il est connecté.',
  icone: '🤖',
  categorie: 'outils',
  scopes: [], // rien a demander a Twitch : il demarre meme sans chaine connectee

  disponible({ donnees }) {
    cheminTemoin = join(donnees, FICHIER_TEMOIN);
    return existsSync(cheminTemoin);
  },

  libellesActions: {
    lancerAgent: "Lancer l'agent",
    afficher: 'Afficher la fenêtre',
  },
  actions: {
    async lancerAgent(ctx) {
      const { message } = await assurerAgent(ctx.log);
      return { message };
    },
    async afficher() {
      if (!(await io.afficher())) throw new Error("Fenêtre de l'agent introuvable : est-il lancé ?");
      return { message: 'Fenêtre affichée' };
    },
  },

  async sante(ctx) {
    return ctx._santeAgent?.() ?? [];
  },

  async diagnostic() {
    let lanceur;
    try {
      lanceur = lireLanceur(cheminTemoin);
    } catch (e) {
      lanceur = e.message;
    }
    const e = await observer().catch((err) => ({ erreur: err.message }));
    return { lanceur, agent: e };
  },

  async demarrer(ctx) {
    let etat = null;
    let demarrageDepuis = null;
    const noter = (e) => {
      demarrageDepuis = e.demarrage ? (demarrageDepuis ?? Date.now()) : null;
      etat = e;
    };
    ctx._santeAgent = () => ligneSante(etat, demarrageDepuis);

    noter((await assurerAgent(ctx.log)).e); // temoin ou lanceur fautif : le module passe en erreur, message compris
    ctx.minuteur.intervalle(async () => {
      try {
        noter(await observer());
      } catch (err) {
        etat = { erreur: err.message };
      }
    }, RYTHME_MS);

    return {
      async arreter({ desactive } = {}) {
        if (!desactive) return; // StreamKit s'arrete ou redemarre ses modules : l'agent continue
        dernierLancement = 0; // rallumer aussitot doit relancer, pas « attendre le demarrage »
        const e = await observer().catch(() => null);
        if (!e?.racine) return ctx.log.info('Agent déjà arrêté.');
        if (await io.tuer(e.racine)) ctx.log.ok('Agent arrêté, fenêtre fermée.');
        else ctx.log.warn("L'agent ne s'est pas arrêté : ferme sa fenêtre à la main.");
      },
    };
  },
};
