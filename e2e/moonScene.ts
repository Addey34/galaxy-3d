/**
 * LA DATE DE TOUTE SCÈNE LUNAIRE DE LA SUITE, FIXÉE (ligne 44.2 de la file, 2026-10-01).
 *
 * POURQUOI. Un scénario qui démarre sur la Lune à la date COURANTE ne joue pas la même scène d'un
 * jour à l'autre, et c'est mesuré :
 *
 *  - `CameraSystem._approachDirection` place la caméra du côté du Soleil, pour montrer le
 *    terminateur. Selon la position relative du Soleil, de la Terre et de la Lune, la TERRE se
 *    retrouve, certains jours, dans le champ derrière la Lune ;
 *  - or la Terre est le corps le plus coûteux à dessiner (huit couches, nuages, atmosphère,
 *    lumières nocturnes). En rendu logiciel, celui des coureurs de CI, elle double le coût d'une
 *    image. Mesuré sur la même date (2026-09-26, 12 h UTC), en masquant la seule Terre par le
 *    tableau des réglages : **117, 119 et 117 ms avec elle, 66, 61 et 62 ms sans** ;
 *  - dans la vraie CI, sur un mois balayé de deux en deux jours, la médiane par image va de
 *    **244 à 464 ms selon la date seule** (run `36884843811`), pour un seuil de calme de 500.
 *
 * Le 2026-10-01, cela a rendu `main` rouge sans qu'un octet du produit change : le commit du
 * lot 43, sain à 10 h 27 UTC, échouait pareil à 14 h 35 (run `36877535772`), les quatre scénarios
 * lunaires de `places.spec.ts` plafonnant à ~560 ms par image. Et le lot 40 avait déjà rencontré
 * le même plateau dans `gazetteer.spec.ts`, l'avait attribué aux 9 087 noms de la couche de
 * surface (qui sont PLAFONNÉS avant d'être dessinés, donc ne dépendent pas de la vue) et avait
 * porté le seuil de cette page à 1 500 ms. L'explication était fausse et le remède masquait la
 * cause : cette exception est retirée.
 *
 * LA CORRECTION N'EST PAS UN SEUIL, C'EST LE DÉTERMINISME : une date fixée donne la même scène à
 * chaque run. Celle-ci a été MESURÉE parmi les moins chères du mois, Terre hors du coût : 247 ms
 * de médiane en CI, 68 ms ici en rendu logiciel. Un scénario qui a BESOIN de la date courante pour
 * ce qu'il prouve doit le dire et ne pas démarrer sur la Lune.
 *
 * LE BUDGET GLOBAL DE CALME EST PASSÉ À 1 500 ms LE 2026-10-03 (ligne 44.3), et ce n'est PAS le
 * retour du remède écarté ci-dessus. Celui-là était une exception propre à une page, posée sur
 * un faux diagnostic. Celui-ci vaut pour toute la suite et suit deux mesures : les textures en vol
 * sont désormais exclues par un signal réel (`data-textures-loading`), et GitHub sert des
 * processeurs dont une même vue coûte du simple au double (`e2e/mainThread.ts`). La date fixée
 * reste, puisqu'elle rend la scène identique d'un run à l'autre.
 */
export const MOON_SCENE_DATE = '2026-09-24T12:00:00Z';
