/* global console, process, setTimeout */
/**
 * Démarre ou arrête la COPIE PORTABLE de NVDA utilisée par la passe lecteur d'écran.
 *
 * Pourquoi un script et pas trois lignes de documentation : la passe du lot 19 se relit et se
 * REJOUE. Trois réglages la rendent exploitable, et aucun n'est le défaut de NVDA :
 *
 * - la synthèse est `silence`, sinon la machine parle pendant toute la capture ;
 * - le niveau de journalisation est DEBUG (10), sinon les énoncés ne sont pas écrits : NVDA les
 *   journalise au niveau IO (12), qui n'est atteint que par DEBUG ;
 * - la LANGUE de NVDA est un paramètre, parce qu'elle décide des mots de rôle entendus
 *   (« button » contre « bouton »). Une passe française avec un NVDA anglais décrirait une
 *   expérience que personne n'a.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const NVDA_EXE = 'C:/a11y/nvda/nvda.exe';
export const NVDA_INI = 'C:/a11y/nvda/userConfig/nvda.ini';
export const NVDA_LOG = 'C:/a11y/logs/nvda.log';

const CONFIG = (language) => `schemaVersion = 12
[general]
\tlanguage = ${language}
\tsaveConfigurationOnExit = False
\taskToExit = False
\tplayStartAndExitSounds = False
\tshowWelcomeDialogAtStartup = False
[speech]
\tsynth = silence
[braille]
\tdisplay = noBraille
[update]
\tautoCheck = False
\tstartupNotification = False
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function stopNvda() {
  spawnSync('taskkill', ['/F', '/IM', 'nvda.exe'], { stdio: 'ignore' });
}

/** Démarre NVDA dans la langue demandée, journal vidé, et rend le chemin du journal. */
export async function startNvda(language) {
  stopNvda();
  await sleep(1500);
  mkdirSync(dirname(NVDA_INI), { recursive: true });
  mkdirSync(dirname(NVDA_LOG), { recursive: true });
  writeFileSync(NVDA_INI, CONFIG(language), 'utf8');
  writeFileSync(NVDA_LOG, '', 'utf8');
  spawn(NVDA_EXE, ['-m', '-l', '10', '-f', NVDA_LOG], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  await sleep(12_000);
  return NVDA_LOG;
}

if (process.argv[2] === 'start') {
  await startNvda(process.argv[3] ?? 'en');
  console.log(`NVDA démarré en « ${process.argv[3] ?? 'en'} »`);
} else if (process.argv[2] === 'stop') {
  stopNvda();
  console.log('NVDA arrêté');
}
