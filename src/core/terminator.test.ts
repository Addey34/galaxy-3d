import { describe, expect, it } from 'vitest';
import {
  ASTRONOMICAL_TWILIGHT_DOT,
  ATMOSPHERE_SCALE_HEIGHT_KM,
  CIVIL_TWILIGHT_DOT,
  TERMINATOR_GLSL,
  TERMINATOR_WRAP_ATMOSPHERE,
  TERMINATOR_WRAP_ATMOSPHERE_SHELL,
  TERMINATOR_WRAP_CLOUDS,
  TERMINATOR_WRAP_STORM,
  TERMINATOR_WRAP_VACUUM,
  terminatorDay,
  terminatorLight,
  terminatorNight,
  TERMINATOR_WRAP_TWILIGHT_SKY,
  terminatorTwilight,
  terminatorTwilightWarmth,
  twilightWarmthViewFactor,
  sunlitColumnFraction,
  TWILIGHT_BAND_PEAK,
  twilightWrapAtAltitude,
} from './terminator';

const sinDeg = (deg: number): number => Math.sin((deg * Math.PI) / 180);

describe('terminator constants', () => {
  it('expresses every width as the sine of a real twilight angle', () => {
    // Le point du module : aucune de ces valeurs n'est réglée à l'œil. Si l'une d'elles
    // devient un nombre arbitraire, c'est le retour au problème d'origine (six couches,
    // six conventions, des bandes visibles au terminateur).
    expect(ASTRONOMICAL_TWILIGHT_DOT).toBeCloseTo(sinDeg(18), 12);
    expect(CIVIL_TWILIGHT_DOT).toBeCloseTo(sinDeg(6), 12);
    // Le sol suit le crépuscule CIVIL, pas l'astronomique : 18° est l'instant où le CIEL
    // devient noir, 6° celui où le SOL cesse d'être utilement éclairé. Seule la coque
    // atmosphérique (la lueur du ciel au limbe) part de l'astronomique.
    expect(TERMINATOR_WRAP_ATMOSPHERE).toBe(CIVIL_TWILIGHT_DOT);
  });

  it('keeps an airless body visibly sharper than one with an atmosphere', () => {
    // Physique : sans diffusion, pas de crépuscule. Le wrap non nul de la Lune est un
    // adoucissement assumé, il doit rester nettement plus serré que celui de la Terre.
    // La comparaison se fait en ANGLE, pas en dot : sin est concave, donc sin(3°) est
    // très légèrement SUPÉRIEUR à sin(6°)/2 — comparer les dots ferait échouer un rapport
    // d'angles pourtant exactement de 1 à 2.
    const asDeg = (dot: number): number => (Math.asin(dot) * 180) / Math.PI;
    expect(TERMINATOR_WRAP_VACUUM).toBeLessThan(TERMINATOR_WRAP_ATMOSPHERE);
    expect(asDeg(TERMINATOR_WRAP_VACUUM)).toBeCloseTo(
      asDeg(TERMINATOR_WRAP_ATMOSPHERE) / 2,
      9
    );
  });
});

describe('twilightWrapAtAltitude', () => {
  it('widens the twilight with altitude, from the real horizon dip', () => {
    // Un point à l'altitude h voit le Soleil jusqu'à acos( R / (R+h) ) sous l'horizon du
    // sol. C'est ce qui fait que les nuages rougeoient quand le sol est déjà dans l'ombre.
    const ground = twilightWrapAtAltitude(0);
    expect(ground).toBeCloseTo(TERMINATOR_WRAP_ATMOSPHERE, 12);
    expect(TERMINATOR_WRAP_CLOUDS).toBeGreaterThan(ground);
    expect(TERMINATOR_WRAP_STORM).toBeGreaterThan(TERMINATOR_WRAP_CLOUDS);
    expect(TERMINATOR_WRAP_ATMOSPHERE_SHELL).toBeGreaterThan(
      TERMINATOR_WRAP_STORM
    );
  });

  it('matches the closed-form horizon dip, not a fudge factor', () => {
    // ~10 km au-dessus d'une Terre de 6371 km : l'horizon s'abaisse d'environ 3.2°.
    const dipDeg = (Math.acos(6371 / (6371 + 10)) * 180) / Math.PI;
    expect(dipDeg).toBeCloseTo(3.22, 1);
    expect(TERMINATOR_WRAP_CLOUDS).toBeCloseTo(
      TERMINATOR_WRAP_ATMOSPHERE + sinDeg(dipDeg),
      10
    );
  });

  it('never returns a narrower width than the ground for a negative altitude', () => {
    expect(twilightWrapAtAltitude(-100)).toBeCloseTo(
      TERMINATOR_WRAP_ATMOSPHERE,
      12
    );
  });
});

describe('terminatorLight (direct illumination of a lit surface)', () => {
  const w = TERMINATOR_WRAP_ATMOSPHERE;

  it('leaves the lit side as exact Lambert', () => {
    // Le wrap linéaire précédent surexposait TOUT le disque (+11 % à raw = 0.5) : le jour
    // était délavé. Au-delà de +w la courbe doit rendre le dot brut, à l'identique.
    for (const raw of [w, 0.5, 0.75, 1])
      expect(terminatorLight(raw, w)).toBeCloseTo(raw, 12);
  });

  it('reaches zero with a zero slope, not a hard edge', () => {
    // La cause du « noir d'un coup » : le wrap linéaire touchait 0 avec une pente non
    // nulle → cassure de dérivée = arête franche. Ici l'extinction est tangente.
    expect(terminatorLight(-w, w)).toBe(0);
    const eps = 1e-4;
    const slopeNearEnd = (terminatorLight(-w + eps, w) - 0) / eps;
    const slopeMidBand =
      (terminatorLight(-w / 2 + eps, w) - terminatorLight(-w / 2, w)) / eps;
    expect(slopeNearEnd).toBeLessThan(0.01);
    expect(slopeMidBand).toBeGreaterThan(slopeNearEnd * 10);
  });

  it('stays continuous and monotonic across the whole band', () => {
    let previous = -1;
    for (let raw = -1; raw <= 1.0001; raw += 0.005) {
      const value = terminatorLight(raw, w);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });

  it('joins the Lambert branch tangentially (C1, no visible crease)', () => {
    // wrap·s² − raw = wrap·(s−1)² ≥ 0, nul seulement en s = 1 : le max lui-même est C1.
    // Sans ça, le raccord anguleux se verrait comme une ligne claire au bord du jour.
    const eps = 1e-5;
    const before = (terminatorLight(w, w) - terminatorLight(w - eps, w)) / eps;
    const after = (terminatorLight(w + eps, w) - terminatorLight(w, w)) / eps;
    expect(before).toBeCloseTo(after, 3);
    expect(after).toBeCloseTo(1, 3);
  });

  it('keeps the geometric terminator dim enough not to flood the night side', () => {
    // Le garde-fou qui rend l'élargissement à 18° sûr : un wrap LINÉAIRE éclairerait la
    // bande à w/(1+w) ≈ 0.237. La queue quadratique ne donne que w/4.
    expect(terminatorLight(0, w)).toBeCloseTo(w / 4, 12);
    expect(terminatorLight(0, w)).toBeLessThan(w / (1 + w) / 3);
  });
});

describe('terminatorDay (day fraction of an overlaid layer)', () => {
  it('shares its extinction point with terminatorLight for the same width', () => {
    // C'EST le point qui aligne les couches : à largeur égale, calque et surface
    // s'éteignent au même instant. Toute divergence ici ramène les bandes visibles.
    for (const w of [TERMINATOR_WRAP_VACUUM, TERMINATOR_WRAP_ATMOSPHERE, 0.5]) {
      expect(terminatorDay(-w, w)).toBe(0);
      expect(terminatorLight(-w, w)).toBe(0);
      expect(terminatorDay(w, w)).toBeCloseTo(1, 12);
    }
  });

  it('is flat at both ends (smootherstep, not smoothstep)', () => {
    // Dérivée seconde nulle aux deux bornes : le raccord avec les paliers plats est
    // imperceptible. Un smoothstep cubique laisse un coude visible en début de rampe.
    const w = TERMINATOR_WRAP_ATMOSPHERE;
    const eps = 1e-3;
    expect(terminatorDay(-w + eps, w)).toBeLessThan(1e-4);
    expect(1 - terminatorDay(w - eps, w)).toBeLessThan(1e-4);
    expect(terminatorDay(0, w)).toBeCloseTo(0.5, 12);
  });

  it('keeps a high-altitude layer lit after the ground below it goes dark', () => {
    // Le résultat observable de tout ce module : à l'instant où le sol s'éteint
    // (dot = -TERMINATOR_WRAP_ATMOSPHERE), les nuages et les sommets d'orage sont
    // encore éclairés, et le halo atmosphérique plus encore.
    const groundOut = -TERMINATOR_WRAP_ATMOSPHERE;
    expect(terminatorLight(groundOut, TERMINATOR_WRAP_ATMOSPHERE)).toBe(0);
    const clouds = terminatorDay(groundOut, TERMINATOR_WRAP_CLOUDS);
    const storm = terminatorDay(groundOut, TERMINATOR_WRAP_STORM);
    const shell = terminatorDay(groundOut, TERMINATOR_WRAP_ATMOSPHERE_SHELL);
    expect(clouds).toBeGreaterThan(0);
    expect(storm).toBeGreaterThan(clouds);
    expect(shell).toBeGreaterThan(storm);
  });
});

describe('terminatorNight (layers that appear at night)', () => {
  it('starts exactly at sunset and never bleeds onto the day side', () => {
    // La crainte qui avait fait reculer le seuil à -0.12 (~27 min de retard) : au-dessus
    // du seuil le clamp force 0 EXACTEMENT, quel que soit le seuil.
    const onset = 0;
    const ramp = CIVIL_TWILIGHT_DOT;
    for (const raw of [1, 0.5, 0.2, 0.05, 1e-6])
      expect(terminatorNight(raw, onset, ramp)).toBe(0);
    expect(terminatorNight(onset, onset, ramp)).toBe(0);
    expect(terminatorNight(-ramp, onset, ramp)).toBeCloseTo(1, 12);
    expect(terminatorNight(-1, onset, ramp)).toBe(1);
  });

  it('rises monotonically through the ramp', () => {
    let previous = -1;
    for (let raw = 0.2; raw >= -0.5; raw -= 0.005) {
      const value = terminatorNight(raw, 0, CIVIL_TWILIGHT_DOT);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });

  it('extinguishes the ground with a flat tangent, so the lights can start there', () => {
    // Le bout de la bande : c'est la que le sol atteint zero, et c'est aussi la que les
    // lumieres de ville atteignent leur plein regime (SHADER_SETTINGS.nightLights monte de
    // 0 a -TERMINATOR_WRAP_ATMOSPHERE). Les deux rampes couvrent donc la meme bande.
    //
    // Ce que ce test verifie, cote sol : l'extinction arrive bien a -wrap, et elle y arrive
    // avec une PENTE NULLE — sans cette tangence, le bord de l'ombre montrerait une arete.
    const meet = -TERMINATOR_WRAP_ATMOSPHERE;
    expect(terminatorLight(meet, TERMINATOR_WRAP_ATMOSPHERE)).toBe(0);

    const eps = 1e-4;
    const slope =
      (terminatorLight(meet + eps, TERMINATOR_WRAP_ATMOSPHERE) -
        terminatorLight(meet, TERMINATOR_WRAP_ATMOSPHERE)) /
      eps;
    expect(Math.abs(slope)).toBeLessThan(1e-3);

    // Et au-dessus du point de rencontre le sol garde un eclairement strictement positif
    // sur toute la bande : c'est exactement le domaine ou les lumieres doivent rester nulles.
    expect(
      terminatorLight(meet / 2, TERMINATOR_WRAP_ATMOSPHERE)
    ).toBeGreaterThan(0);
    expect(terminatorLight(0, TERMINATOR_WRAP_ATMOSPHERE)).toBeGreaterThan(0);
  });
});

describe('terminatorTwilight (bandeau crépusculaire)', () => {
  const w = TERMINATOR_WRAP_ATMOSPHERE;

  it('suit la montée de l’ombre dans la colonne d’air, sans réglage', () => {
    // Aucune constante libre : `exp( -R·(1/cos h − 1) / H )`. Ces quatre valeurs se
    // recalculent à la main depuis le rayon terrestre et la hauteur d'échelle — si l'une
    // bouge, c'est que la formule a changé, pas qu'un curseur a été tourné.
    expect(ATMOSPHERE_SCALE_HEIGHT_KM).toBe(8);
    expect(sunlitColumnFraction(0)).toBe(1);
    expect(sunlitColumnFraction(0.5)).toBe(1);
    expect(sunlitColumnFraction(-sinDeg(1))).toBeCloseTo(0.886, 3);
    expect(sunlitColumnFraction(-sinDeg(3))).toBeCloseTo(0.335, 3);
    expect(sunlitColumnFraction(-sinDeg(6))).toBeCloseTo(0.0124, 4);

    // Décroissance stricte sous l'horizon : l'ombre ne redescend jamais.
    let previous = 1;
    for (let deg = 0; deg <= 12; deg += 0.25) {
      const value = sunlitColumnFraction(-sinDeg(deg));
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('laisse le côté éclairé strictement intact', () => {
    // Règle produit : ce terme ne doit RIEN changer au rendu du jour. Il s'annule
    // exactement en +wrap grâce au facteur `1 − terminatorDay`, pas « presque ».
    for (const raw of [w, w + 1e-9, 0.2, 0.5, 1])
      expect(terminatorTwilight(raw, w)).toBe(0);
  });

  it('s’éteint avant la nuit profonde, pour ne pas voiler les lumières de ville', () => {
    // Un plancher résiduel sur la face nuit écraserait le contraste des villes — le
    // défaut symétrique de celui qu'on corrige. La colonne n'est plus éclairée du tout
    // dès la fin du crépuscule NAUTIQUE, donc la lueur s'éteint d'elle-même.
    expect(terminatorTwilight(-sinDeg(9), w)).toBeLessThan(1e-3);
    expect(terminatorTwilight(-sinDeg(12), w)).toBeLessThan(1e-6);
    expect(terminatorTwilight(-1, w)).toBe(0);
  });

  it('culmine dans la bande que le rendu laissait noire', () => {
    // Mesure sur le rendu réel avant correction (Terre texturée, statistique pixel par
    // pixel du disque) : 4 % de pixels au-dessus du plancher d'affichage à +0,6°, puis
    // 0 % de 0° à −2°. Le maximum de la lueur doit tomber DANS cet intervalle, sinon
    // elle éclaire à côté du trou.
    // Balayé à la largeur que le matériau emploie VRAIMENT (celle de la coque, pas du sol) :
    // c'est elle qui fixe `TWILIGHT_BAND_PEAK`, donc l'amplitude ancrée par continuité.
    let argmax = 0;
    let peak = 0;
    for (let raw = -0.3; raw <= 0.3; raw += 1e-4) {
      const value = terminatorTwilight(raw, TERMINATOR_WRAP_TWILIGHT_SKY);
      if (value > peak) {
        peak = value;
        argmax = raw;
      }
    }
    expect(argmax).toBeLessThan(sinDeg(0.6));
    expect(argmax).toBeGreaterThan(-sinDeg(2));
    // Et `TWILIGHT_BAND_PEAK` dit bien la vérité : c'est lui qui normalise l'amplitude
    // câblée dans le matériau (cf. config/layerConfig.ts).
    expect(TWILIGHT_BAND_PEAK).toBeCloseTo(peak, 6);
  });

  it('domine le sol partout où le sol s’est effondré', () => {
    // LA propriété qui distingue ce terme de `terminatorLight` : sous l'horizon, l'image
    // ne doit plus dépendre de l'albédo. Un éclairement de SOL y reste noir au-dessus de
    // l'océan — c'est-à-dire sur 71 % de la planète — quelle que soit la courbe qu'on lui
    // donne. La lueur du ciel, elle, ne multiplie aucune texture.
    const peak = TWILIGHT_BAND_PEAK;
    for (let raw = 0; raw >= -w; raw -= 0.001) {
      const sky = (terminatorTwilight(raw, w) / peak) * w;
      expect(sky).toBeGreaterThanOrEqual(terminatorLight(raw, w));
    }
  });
});

describe('terminatorTwilightWarmth (couleur du bandeau)', () => {
  const w = TERMINATOR_WRAP_ATMOSPHERE;
  const bandPeak = TWILIGHT_BAND_PEAK;

  it('reste bornée et vaut exactement 1 au terminateur', () => {
    for (let raw = -1; raw <= 1; raw += 0.005) {
      const warmth = terminatorTwilightWarmth(raw, w);
      expect(warmth).toBeGreaterThanOrEqual(0);
      expect(warmth).toBeLessThanOrEqual(1);
    }
    // Le cœur doré est posé sur le terminateur géométrique, pas à côté.
    expect(terminatorTwilightWarmth(0, w)).toBeCloseTo(1, 6);
  });

  it('laisse le BLEU tomber sur une partie encore lumineuse de la bande', () => {
    // LA propriété pour laquelle cette fonction existe, et la seule qui décrive le défaut
    // corrigé. Quand la teinte était pilotée par `sunlitColumnFraction` — qui est aussi un
    // facteur de la luminosité — la moitié bleue ne commençait que là où la bande s'était
    // déjà éteinte : rendu, un bandeau brun-rouge uniforme. Il faut donc qu'il existe un
    // endroit où la bande porte encore la MOITIÉ de son amplitude maximale ET où la teinte
    // est franchement froide.
    // Cherché SOUS l'horizon seulement : c'est là que le ciel bleu de crépuscule se voit. Le
    // jour a son propre bleu, qui ne dit rien de ce défaut-ci.
    let coldestWhereBright = 1;
    let atDeg = 0;
    for (let deg = 0; deg >= -14; deg -= 0.01) {
      const raw = sinDeg(deg);
      if (
        terminatorTwilight(raw, TERMINATOR_WRAP_TWILIGHT_SKY) <
        0.4 * bandPeak
      )
        continue;
      const warmth = terminatorTwilightWarmth(raw, w);
      if (warmth < coldestWhereBright) {
        coldestWhereBright = warmth;
        atDeg = deg;
      }
    }
    expect(atDeg).toBeLessThan(-1);
    expect(coldestWhereBright).toBeLessThan(0.2);
    // Et l'ANCIEN pilote, au même endroit, était plusieurs fois plus chaud : c'est la mesure
    // directe de ce que la séparation a changé, pas un seuil choisi après coup.
    const oldDriver = sunlitColumnFraction(sinDeg(atDeg));
    expect(oldDriver / Math.max(coldestWhereBright, 1e-6)).toBeGreaterThan(2.5);
  });

  it('ne teinte pas en or le ciel du plein jour', () => {
    // `sunlitColumnFraction` vaut 1 sur TOUT l'hémisphère éclairé : à lui seul il tenait la
    // teinte chaude à fond jusqu'à `+wrap`. Mesuré à l'écran, le sol à +2,9° de hauteur
    // solaire sortait avec un rapport rouge/bleu de 3,5 — un lavis rouge en plein jour.
    // À 3° de hauteur le ciel est bleu ; la chaudeur doit y être résiduelle.
    expect(terminatorTwilightWarmth(sinDeg(3), w)).toBeLessThan(0.15);
    expect(terminatorTwilightWarmth(sinDeg(5), w)).toBeLessThan(0.02);
    // Et elle s'annule exactement là où la bande elle-même s'annule : aucune teinte ne
    // survit à son propre support.
    expect(terminatorTwilightWarmth(w, w)).toBe(0);
    expect(terminatorTwilight(w, w)).toBe(0);
  });

  it('s’éteint en nuit profonde comme la bande qu’elle colore', () => {
    // Aucune queue chaude ne doit traîner sous la bande : une teinte sans support est une
    // couleur posée sur du noir, donc invisible au mieux, une frange au pire.
    expect(terminatorTwilightWarmth(-sinDeg(5), w)).toBeLessThan(0.01);
    expect(terminatorTwilightWarmth(-1, w)).toBeCloseTo(0, 9);
  });

  it('décroît de façon monotone des deux côtés du terminateur', () => {
    // Une teinte non monotone se lit comme un liseré : une bande de couleur qui revient.
    let previous = terminatorTwilightWarmth(sinDeg(-8), w);
    for (let deg = -8; deg <= 0; deg += 0.02) {
      const value = terminatorTwilightWarmth(sinDeg(deg), w);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
    previous = terminatorTwilightWarmth(0, w);
    for (let deg = 0; deg <= 8; deg += 0.02) {
      const value = terminatorTwilightWarmth(sinDeg(deg), w);
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      previous = value;
    }
  });
});

describe('GLSL mirror', () => {
  // Le GLSL ne peut pas être exécuté hors d'un contexte WebGL : la seule protection réelle
  // est l'adjacence dans le fichier. Ces assertions attrapent au moins une suppression ou
  // un renommage accidentel, et le glissement le plus probable — une borne ou un
  // coefficient édité d'un seul côté.
  it('declares the three shared functions', () => {
    for (const signature of [
      'float terminatorLight( float raw, float wrap )',
      'float terminatorDay( float raw, float wrap )',
      'float terminatorNight( float raw, float onset, float rampWidth )',
      'float terminatorSunlitColumn( float raw )',
      'float terminatorTwilight( float raw, float wrap )',
      'float terminatorTwilightWarmth( float raw, float wrap )',
      'float twilightWarmthViewFactor( float viewCos )',
    ])
      expect(TERMINATOR_GLSL).toContain(signature);
  });

  it('keeps the same coefficients as the JS mirror', () => {
    expect(TERMINATOR_GLSL).toContain('t * ( t * 6.0 - 15.0 ) + 10.0');
    expect(TERMINATOR_GLSL).toContain('( raw + wrap ) / ( 2.0 * wrap )');
    expect(TERMINATOR_GLSL).toContain('max( raw, wrap * s * s )');
    expect(TERMINATOR_GLSL).toContain('( raw - onset ) / -rampWidth');
    // Le rayon terrestre et la hauteur d'échelle traversent le template : une édition d'un
    // seul côté ferait diverger le bandeau rendu de celui que ces tests décrivent.
    expect(TERMINATOR_GLSL).toContain(
      '6371.0 * raw * raw / ( c * ( 1.0 + c ) )'
    );
    expect(TERMINATOR_GLSL).toContain('exp( - shadowTopKm / 8.0 )');
    expect(TERMINATOR_GLSL).toContain(
      'terminatorSunlitColumn( raw ) * ( 1.0 - terminatorDay( raw, wrap ) )'
    );
    // Le demi-seuil de la retombée côté jour et le carré de la colonne : les deux
    // coefficients qui décident où la bande est dorée plutôt que bleue.
    expect(TERMINATOR_GLSL).toContain(
      '( 1.0 - terminatorDay( raw, wrap ) ) / 0.5'
    );
    expect(TERMINATOR_GLSL).toContain(
      'column * column * terminatorSmootherstep01( nearHorizon )'
    );
  });
});

describe('twilightWarmthViewFactor (l’or n’existe qu’en vue rasante)', () => {
  it('ne met AUCUN or au centre du disque', () => {
    // Mesuré sur une image Galileo de la Terre à moitié éclairée, où le terminateur traverse
    // le disque comme dans cette application : le rapport rouge/bleu n'y dépasse jamais 0,75.
    // Il n'y a pas d'or en travers du disque, et en peindre un était une erreur de géométrie.
    expect(twilightWarmthViewFactor(1)).toBe(0);
    expect(twilightWarmthViewFactor(-1)).toBe(0);
    expect(twilightWarmthViewFactor(0.95)).toBeLessThan(0.01);
  });

  it('le donne pleinement au limbe, où le regard traverse par la tranche', () => {
    // Mesuré sur une vue ISS du limbe au lever orbital : or à 1,84, orange à 2,60, rouge à
    // 6,6 — et à des luminances de 175, 152 et 94. L'or y est réel ET lumineux.
    expect(twilightWarmthViewFactor(0)).toBe(1);
  });

  it('monte de façon monotone vers le limbe', () => {
    let previous = 0;
    for (let viewCos = 1; viewCos >= 0; viewCos -= 0.01) {
      const value = twilightWarmthViewFactor(viewCos);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it('traite les deux faces de la même manière', () => {
    // `dot` change de signe selon l'orientation ; la géométrie du regard, non.
    for (const c of [0.2, 0.5, 0.8])
      expect(twilightWarmthViewFactor(c)).toBeCloseTo(
        twilightWarmthViewFactor(-c),
        12
      );
  });

  it('reste borné sur un produit scalaire hors domaine', () => {
    // Une normale non normalisée peut donner un `dot` hors [-1, 1] ; la chaudeur ne doit ni
    // devenir négative ni dépasser 1, sans quoi le mélange de teintes sortirait de sa plage.
    //
    // Le cas NaN n'est PAS testé, et c'est délibéré : `clamp` le propage, des deux côtés du
    // miroir. Le rattraper en JavaScript seulement ferait diverger le GLSL, alors que
    // l'adjacence des deux écritures est la seule protection qu'a ce fichier. Et un `dot` NaN
    // supposerait une normale déjà NaN — tout aurait cassé bien avant d'arriver ici.
    for (const c of [-3, 3, 1e9]) {
      const value = twilightWarmthViewFactor(c);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
