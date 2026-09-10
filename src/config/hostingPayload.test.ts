import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CE QUE LE DÉPLOIEMENT A LE DROIT D'EMPORTER.
 *
 * Firebase Hosting facture le stockage sur la somme des versions RETENUES, pas sur la dernière.
 * Chaque déploiement en conserve donc une copie entière, et un fichier lourd se paie autant de
 * fois qu'il y a de versions gardées.
 *
 * Le noyau SPK `sat441l.bsp` pèse 638 Mo. Il n'est pas versionné dans Git, donc la CI ne peut
 * pas l'envoyer — mais `docs/SPK_DEPLOYMENT.md` documente un `firebase deploy` LOCAL, et là
 * `public/` le contient. Un seul déploiement depuis un poste de développement pousse donc
 * 638 Mo sans rien demander. C'est arrivé : le quota de 10 Go a fini par sauter, et le message
 * d'erreur (429 sur l'API Hosting) ne nomme évidemment pas le fichier fautif.
 *
 * L'application déployée ne demande jamais ce noyau : `SPK_SETTINGS.url` vaut `null` sans
 * `VITE_SPK_KERNEL_URL`, et cette variable n'est définie nulle part dans la CI. C'était donc du
 * poids mort. Le retirer ne coûte aucune fonctionnalité en ligne.
 */
describe('charge utile du déploiement', () => {
  const firebaseJson = JSON.parse(
    readFileSync(resolve(__dirname, '../../firebase.json'), 'utf8')
  ) as { hosting: { ignore?: string[]; public: string } };

  it('exclut le noyau SPK, qui pèse 638 Mo par version retenue', () => {
    const ignore = firebaseJson.hosting.ignore ?? [];
    const covers = ignore.some(
      (pattern) => pattern.includes('kernels') && pattern.includes('**')
    );
    expect(
      covers,
      `firebase.json n'exclut plus assets/kernels : un déploiement local repousserait 638 Mo et reboucherait le quota. Motifs actuels : ${JSON.stringify(ignore)}`
    ).toBe(true);
  });

  it('garde les exclusions de base', () => {
    // Sans ça, une réécriture distraite de la liste emporterait aussi ces trois-là.
    const ignore = firebaseJson.hosting.ignore ?? [];
    for (const required of ['firebase.json', '**/.*', '**/node_modules/**'])
      expect(ignore).toContain(required);
  });

  it('déploie bien le dossier construit', () => {
    expect(firebaseJson.hosting.public).toBe('dist');
  });
});
