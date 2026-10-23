import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classify,
  DRIFT_GENERATORS,
  excerpt,
} from '../../scripts/check-data-drift.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/**
 * Des sorties RÉELLES, relevées le 2026-10-23 en lançant chaque `--check` contre les sources.
 * Un fragment inventé aurait la forme que le classeur attend ; ceux-ci ont la forme que les
 * générateurs produisent vraiment, y compris la trace d'un plantage.
 */
const REAL = {
  gazetteerDrift:
    '\nA DERIVE de la source : donaldjohanson, adoptions, manifest. Relancer sans --check.\n[ELIFECYCLE] Command failed with exit code 1.',
  atmosphereDrift:
    'dérive : D:\\Dev\\projects\\Galaxy\\public\\assets\\atmosphere-profiles\\jupiter.json\ndérive : D:\\Dev\\projects\\Galaxy\\src\\config\\atmosphereProfileIndex.json\n[ELIFECYCLE] Command failed with exit code 1.',
  contactsDrift:
    '$ node scripts/generate-surface-contacts.mjs "--check"\nD:\\Dev\\projects\\Galaxy\\src\\seo\\surfaceContacts.json a dérivé : relancer pnpm contacts:generate\n[ELIFECYCLE] Command failed with exit code 1.',
  instrumentsDrift:
    'DÉRIVE : hayabusa2, index ne correspond plus à la source. Relancer « pnpm instruments:generate » sans --check.',
  horizonsCrash:
    'file:///D:/Dev/projects/Galaxy/scripts/horizons-relative.mjs:88\n      throw new Error(\nError: Horizons sans table (hera / didymos 2026-11-02 17:43:00 (1m)) :\nAPI ERROR: HTTP code 500\n    at horizons (file:///D:/Dev/projects/Galaxy/scripts/horizons-relative.mjs:88:15)\nNode.js v24.19.0',
  registryCrash:
    'Error: le registre rend DEUX lignes divergentes pour urn:nasa:pds:context:investigation:mission.hayabusa :\n  {"name":"HAYABUSA"}\nChoisir entre elles serait arbitraire.\n    at file:///D:/Dev/projects/Galaxy/scripts/generate-mission-index.mjs:375:13',
  perihelionOk: '48 périhélies, à jour',
};

describe('guetteur de dérive des données : le verdict', () => {
  it('un code 0 est à jour, quelle que soit la sortie', () => {
    expect(classify(0, REAL.perihelionOk)).toBe('ok');
    expect(classify(0, 'aucun fichier livré n’a dérivé')).toBe('ok');
  });

  it('une dérive réelle est une dérive, dans les quatre formulations des générateurs', () => {
    for (const out of [
      REAL.gazetteerDrift,
      REAL.atmosphereDrift,
      REAL.contactsDrift,
      REAL.instrumentsDrift,
    ])
      expect(classify(1, out)).toBe('drift');
  });

  it("un plantage n'est JAMAIS pris pour une dérive, même si sa sortie parle de divergence", () => {
    expect(classify(1, REAL.horizonsCrash)).toBe('unmeasured');
    // « divergentes » ne contient pas « dériv » ; on garde en plus la trace comme critère.
    expect(classify(1, REAL.registryCrash)).toBe('unmeasured');
    // une trace qui contiendrait le mot ne doit pas basculer en dérive (falsifié)
    expect(classify(1, `${REAL.horizonsCrash}\nle fichier a dérivé`)).toBe(
      'unmeasured'
    );
  });

  it('un délai dépassé et une sortie muette sont non mesurés, pas à jour', () => {
    expect(classify(null, '')).toBe('unmeasured');
    expect(classify(1, '')).toBe('unmeasured');
    expect(classify(1, '[ELIFECYCLE] Command failed with exit code 1.')).toBe(
      'unmeasured'
    );
  });

  it("l'extrait garde les premières lignes utiles et écarte le bruit du gestionnaire", () => {
    const out = excerpt(REAL.contactsDrift);
    expect(out).toContain('a dérivé');
    expect(out).not.toContain('ELIFECYCLE');
    expect(out).not.toContain('$ node');
  });
});

describe('guetteur de dérive des données : sa liste', () => {
  it('chaque générateur sondé existe dans package.json et accepte --check', () => {
    for (const { id, script } of DRIFT_GENERATORS) {
      const command = pkg.scripts[script];
      expect(
        command,
        `${id} : « ${script} » absent de package.json`
      ).toBeTruthy();
      const file = /scripts\/[\w.-]+\.mjs/.exec(command!)?.[0];
      expect(file, `${id} : aucun fichier dans « ${command} »`).toBeTruthy();
      const source = readFileSync(resolve(ROOT, file!), 'utf8');
      expect(
        source.includes('--check'),
        `${id} : ${file} ne sait pas faire --check`
      ).toBe(true);
    }
  });

  it('les identifiants sont uniques', () => {
    const ids = DRIFT_GENERATORS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("le workflow planifié lance bien ce script et l'issue qui porte son étiquette", () => {
    const workflow = readFileSync(
      resolve(ROOT, '.github/workflows/data-drift.yml'),
      'utf8'
    );
    expect(workflow).toContain('scripts/check-data-drift.mjs');
    expect(workflow).toContain('data-drift');
    expect(workflow).toContain('schedule:');
  });
});
