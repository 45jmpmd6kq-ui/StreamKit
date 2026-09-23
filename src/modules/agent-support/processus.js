// Trouver, lancer et arreter l'agent de support : une session Claude Code
// lancee avec « --channels plugin:discord », reliee au bot Discord des rapports
// de bug. Le lanceur (.bat) et ses consignes vivent hors du depot, sur le PC du
// proprietaire ; ce module ne fait que le piloter.
//
// Tout est reconstruit a partir de la liste des processus, a chaque tour :
// l'agent a pu etre lance par StreamKit, par un double-clic sur le .bat, ou
// avoir survecu a un redemarrage de StreamKit. Aucun PID n'est retenu d'un
// tour sur l'autre -- un PID reutilise par Windows ferait tuer le mauvais
// programme.

import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// Present dans la ligne de commande du lanceur (.bat) et de son script
// PowerShell : c'est ce qui les distingue des autres cmd/powershell du PC.
const MARQUE_LANCEUR = /lancer-agent-support/i;

// Le fichier temoin : sa presence rend le module disponible, son contenu dit
// ou est le lanceur. Pose par le proprietaire (StreamKit-Support), jamais livre.
export const FICHIER_TEMOIN = 'agent-support.json';

export function lireLanceur(cheminTemoin) {
  if (!existsSync(cheminTemoin)) throw new Error('Fichier témoin absent : ' + cheminTemoin);
  let donnees;
  try {
    // trimStart() retire aussi le BOM que PowerShell 5.1 met en tete (JSON.parse le refuse)
    donnees = JSON.parse(readFileSync(cheminTemoin, 'utf8').trimStart());
  } catch {
    throw new Error('Fichier témoin illisible (JSON attendu) : ' + cheminTemoin);
  }
  const lanceur = typeof donnees?.lanceur === 'string' ? donnees.lanceur.trim() : '';
  if (!lanceur) throw new Error('Le fichier témoin ne dit pas où est le lanceur (clé « lanceur »).');
  // Il finit entre guillemets dans une ligne de commande cmd.exe.
  if (lanceur.includes('"')) throw new Error('Chemin du lanceur invalide (guillemet) : ' + lanceur);
  if (!existsSync(lanceur)) throw new Error('Lanceur introuvable : ' + lanceur);
  return lanceur;
}

// CreationDate sort de ConvertTo-Json (PowerShell 5.1) sous la forme
// « /Date(1790177781403)/ ».
function dateCim(v) {
  const m = /Date\((\d+)/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
}

// liste : [{ ProcessId, ParentProcessId, Name, CommandLine, CreationDate }]
export function analyser(liste) {
  const parPid = new Map(liste.map((p) => [p.ProcessId, p]));
  const ligne = (p) => p?.CommandLine ?? '';

  // Les sessions de l'appli de bureau sont aussi des claude.exe : seul
  // « --channels plugin:discord » designe l'agent.
  const agent = liste.find(
    (p) =>
      /^claude(\.exe)?$/i.test(p.Name) && /--channels\b/.test(ligne(p)) && /plugin:discord/.test(ligne(p))
  );

  if (!agent) {
    // Lanceur ouvert, Claude pas encore la (ou lanceur en erreur, fenetre en
    // pause) : on ne relance surtout pas par-dessus.
    const lanceur = liste.find(
      (p) => /^(cmd|powershell)(\.exe)?$/i.test(p.Name) && MARQUE_LANCEUR.test(ligne(p))
    );
    return lanceur ? { enMarche: false, demarrage: true, racine: lanceur.ProcessId } : { enMarche: false };
  }

  // Ce qu'il faut tuer pour fermer la fenetre : le plus haut des lanceurs.
  // Tuer Claude seul laisserait la fenetre du .bat en pause (« Appuyez sur
  // une touche »), puisque son code de sortie serait une erreur.
  let racine = agent;
  const vus = new Set([agent.ProcessId]);
  for (
    let p = parPid.get(racine.ParentProcessId);
    p && !vus.has(p.ProcessId);
    p = parPid.get(p.ParentProcessId)
  ) {
    vus.add(p.ProcessId);
    if (!MARQUE_LANCEUR.test(ligne(p))) break;
    racine = p;
  }

  // Le bot : le serveur du plugin (« bun server.ts ») parmi les descendants
  // de l'agent. Il meurt au demarrage si le jeton manque ou est refuse.
  let bot = false;
  const pile = [agent.ProcessId];
  const parcourus = new Set();
  while (pile.length && !bot) {
    const pid = pile.pop();
    if (parcourus.has(pid)) continue;
    parcourus.add(pid);
    for (const e of liste) {
      if (e.ParentProcessId !== pid) continue;
      if (/^bun(\.exe)?$/i.test(e.Name) && /\bserver\.ts\b/.test(ligne(e))) bot = true;
      pile.push(e.ProcessId);
    }
  }

  return {
    enMarche: true,
    pid: agent.ProcessId,
    racine: racine.ProcessId,
    depuis: dateCim(agent.CreationDate),
    bot,
  };
}

const PS_LISTE =
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ' +
  "Get-CimInstance Win32_Process -Filter \"Name='claude.exe' OR Name='bun.exe' OR Name='powershell.exe' OR Name='cmd.exe'\" | " +
  'Select-Object ProcessId, ParentProcessId, Name, CommandLine, CreationDate | ConvertTo-Json -Compress';

function lister() {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_LISTE],
      { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
      (err, sortie) => {
        if (err) return reject(new Error('liste des processus illisible : ' + (err.message || err)));
        const texte = String(sortie).trim();
        if (!texte) return resolve([]);
        try {
          const v = JSON.parse(texte);
          resolve(Array.isArray(v) ? v : [v]); // un seul processus : un objet, pas un tableau
        } catch {
          reject(new Error('liste des processus illisible (JSON)'));
        }
      }
    );
  });
}

// Une nouvelle fenetre, independante de StreamKit : l'agent survit a un
// redemarrage de StreamKit (mise a jour, reconnexion Twitch).
// « cmd /c » explicite : un .bat passe seul a start s'ouvre en « cmd /K », dont
// la fenetre survit au .bat -- apres un /exit de l'agent, elle resterait
// ouverte sur une invite vide, et passerait pour un lanceur bloque.
function lancer(lanceur) {
  const commande = `"start "Agent de support StreamKit" cmd.exe /d /c "${lanceur}""`;
  const p = spawn('cmd.exe', ['/d', '/s', '/c', commande], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
  p.on('error', () => {}); // cmd.exe absent : le tour suivant dira que rien ne tourne
  p.unref();
}

function tuer(pid) {
  return new Promise((resolve) => {
    execFile(
      'taskkill.exe',
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true, timeout: 10_000 },
      (err) => resolve(!err)
    );
  });
}

// Mettre la fenetre au premier plan. Claude Code titre le terminal au nom de la
// session (« Support StreamKit », precede d'un symbole quand il travaille) ;
// AppActivate accepte un titre qui commence ou finit par le texte donne.
// Windows peut refuser le premier plan a un programme en arriere-plan : la
// fenetre clignote alors dans la barre des taches, c'est deja ca.
function afficher() {
  const ps =
    '$s = New-Object -ComObject WScript.Shell; ' +
    "if ($s.AppActivate('Support StreamKit') -or $s.AppActivate('Agent de support StreamKit')) { 'ok' }";
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, timeout: 10_000 },
      (err, sortie) => resolve(!err && /ok/.test(String(sortie)))
    );
  });
}

// Les tests remplacent ces fonctions : on ne lance pas de vrais programmes.
export const io = { lister, lancer, tuer, afficher };
