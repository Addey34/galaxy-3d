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

/**
 * CE QUE CHAQUE RÉPONSE DOIT PORTER, ET CE QUI NE DOIT SURTOUT PAS ÊTRE FIGÉ.
 *
 * Ces deux familles de règles vivent dans le même fichier et n'étaient tenues par rien : leur
 * disparition ne casse aucun test, ne ralentit rien, et ne se voit qu'en interrogeant le site
 * déployé à la main. Une en-tête de sécurité retirée par inadvertance ne se manifeste que le
 * jour où elle aurait servi.
 *
 * Le cache mérite la même attention, pour une raison différente et sans retour arrière : les
 * vignettes de partage ont un nom STABLE et des octets réécrits à chaque build. Les faire
 * tomber sous la règle immuable d'un an de `/assets/**` figerait une image fausse chez tous
 * ceux qui l'ont déjà vue, et aucun redéploiement ne la corrigerait.
 *
 * Le pendant en ligne — ce que la production sert VRAIMENT — est vérifié après chaque
 * déploiement par `scripts/check-deployed-bundle.mjs`. Ici on attrape la faute au commit.
 */
describe('en-têtes du site déployé', () => {
  const config = JSON.parse(
    readFileSync(resolve(__dirname, '../../firebase.json'), 'utf8')
  ) as {
    hosting: {
      headers?: { source: string; headers: { key: string; value: string }[] }[];
    };
  };
  const blocks = config.hosting.headers ?? [];
  const catchAll = blocks.find((block) => block.source === '**');

  it('applique un bloc de sécurité à TOUTES les réponses', () => {
    expect(
      catchAll,
      'aucun bloc `**` : les en-têtes ne couvriraient qu’une partie du site'
    ).toBeDefined();
  });

  it.each([
    ['Content-Security-Policy'],
    ['X-Content-Type-Options'],
    ['X-Frame-Options'],
    ['Referrer-Policy'],
    ['Permissions-Policy'],
    ['Cross-Origin-Opener-Policy'],
    ['Cross-Origin-Resource-Policy'],
    ['Strict-Transport-Security'],
  ])('sert %s sur chaque réponse', (key) => {
    const found = catchAll?.headers.find((header) => header.key === key);
    expect(found?.value, `${key} absente du bloc \`**\``).toBeTruthy();
  });

  it('garde une CSP qui verrouille vraiment quelque chose', () => {
    // Une CSP réduite à `default-src *` passerait le test précédent en ne protégeant rien.
    const csp =
      catchAll?.headers.find((h) => h.key === 'Content-Security-Policy')
        ?.value ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('default-src *');
  });

  it('ne fige JAMAIS les vignettes de partage', () => {
    // Elles vivent hors de `/assets/**` exprès. Aucune règle ne doit les rattraper.
    for (const block of blocks) {
      const longLived = block.headers.some(
        (header) =>
          header.key === 'Cache-Control' &&
          (/immutable/i.test(header.value) ||
            /max-age=\d{7,}/.test(header.value))
      );
      if (!longLived) continue;
      expect(
        block.source.startsWith('/assets/'),
        `« ${block.source} » porte un cache long ; seul /assets/** peut en avoir, ` +
          `car ses noms sont hachés. Une vignette figée un an ne se corrige plus.`
      ).toBe(true);
    }
  });

  it('garde le cache long là où il est légitime', () => {
    // L'autre moitié : sans lui, le bundle serait retéléchargé à chaque visite.
    const assets = blocks.find((block) => block.source === '/assets/**');
    expect(assets?.headers.find((h) => h.key === 'Cache-Control')?.value).toBe(
      'public, max-age=31536000, immutable'
    );
  });
});
