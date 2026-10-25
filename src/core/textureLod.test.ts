import { describe, expect, it } from 'vitest';
import { APP_SETTINGS } from '@/config/engine';
import { LOD_REFERENCE_FOV_DEG, textureLodDistance } from './textureLod';

describe('distance de choix du palier de texture', () => {
  it('ne change rien au champ de référence', () => {
    expect(textureLodDistance(7, LOD_REFERENCE_FOV_DEG)).toBeCloseTo(7, 9);
  });

  it('un zoom optique qui rétrécit le champ rapproche le corps pour le choix du palier', () => {
    expect(textureLodDistance(8, 30)).toBeLessThan(8);
    // Un champ divisé par deux environ grossit le disque d'autant : la distance l'est aussi.
    expect(textureLodDistance(8, 32.5)).toBeCloseTo(4, 0);
    expect(textureLodDistance(8, 100)).toBeGreaterThan(8);
  });

  it('retombe sur la distance brute quand le champ est absurde', () => {
    expect(textureLodDistance(5, 0)).toBe(5);
    expect(textureLodDistance(5, Number.NaN)).toBe(5);
    expect(textureLodDistance(5, 180)).toBe(5);
  });

  it('la table de paliers donne à chaque palier au moins les texels que son bord proche demande', () => {
    // Un palier de largeur W suffit tant que le disque ne dépasse pas W / pi pixels. Le palier
    // le plus exigeant est celui de son BORD PROCHE, la distance où le palier précédent s'arrête.
    // Disque d'un corps à d rayons, champ de 65 degrés, 800 pixels, densité 2 : 2 512 / d.
    const widths = { '8k': 8192, '4k': 4096, '2k': 2048, '1k': 1024 } as const;
    const table = Object.values(APP_SETTINGS.performance.textureQuality).sort(
      (a, b) => a.distance - b.distance
    );
    for (let i = 1; i < table.length; i++) {
      const tier = table[i]!;
      const nearEdge = table[i - 1]!.distance;
      const disc = 2512 / nearEdge;
      const sufficient = widths[tier.quality as keyof typeof widths] / Math.PI;
      expect(
        sufficient,
        `${tier.quality} à ${nearEdge} rayons`
      ).toBeGreaterThanOrEqual(disc);
    }
  });
  it('la table ne télécharge pas un palier fin pour un disque que le palier plus grossier couvre déjà', () => {
    // Le palier fin sert jusqu'à sa distance lointaine ; là, le disque (densité 2, 800 pixels)
    // doit encore dépasser le quart de ce que le palier plus grossier sait montrer. Avec l'ancienne
    // table (10, 20, 40, 80) un 8k partait pour un disque de 250 pixels, que le 4k couvrait.
    const widths = { '8k': 8192, '4k': 4096, '2k': 2048, '1k': 1024 } as const;
    const table = Object.values(APP_SETTINGS.performance.textureQuality).sort(
      (a, b) => a.distance - b.distance
    );
    for (let i = 0; i + 1 < table.length; i++) {
      const fine = table[i]!;
      const coarse = table[i + 1]!;
      const disc = 2512 / fine.distance;
      const coarseSufficient =
        widths[coarse.quality as keyof typeof widths] / Math.PI;
      expect(
        disc * 4,
        `${fine.quality} jusqu'à ${fine.distance} rayons`
      ).toBeGreaterThanOrEqual(coarseSufficient);
    }
  });
});
