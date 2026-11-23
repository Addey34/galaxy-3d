import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LE JOB `Verify and build` EST LA PORTE DU DÉPLOIEMENT (GAL-CI-ROBUST-001, 2026-11-23).
 *
 * Son enveloppe est passée de 15 à 25 min, sur mesure (voir le commentaire de `ci.yml`) : cinq runs
 * sur soixante avaient été COUPÉS pendant les pages générées, sans un seul test rouge, dont un run
 * de `main`, donc un déploiement perdu. Élargir une enveloppe ne doit jamais élargir ce qui peut être
 * publié. Ce fichier garde donc ce qui fait la sûreté de la porte, lu dans le workflow :
 * l'ordre des étapes, leur nature bloquante, et le fait que seul un `push` sur `main` déploie.
 */
const CI_YML = readFileSync(
  resolve(import.meta.dirname, '../../.github/workflows/ci.yml'),
  'utf-8'
);

const start = CI_YML.indexOf('\n  verify:');
const end = CI_YML.indexOf('\n  secret-scan:');
const VERIFY = CI_YML.slice(start, end);

/** Position d'une étape (par son nom ou sa commande) dans le job, ou -1. */
const at = (needle: string): number => VERIFY.indexOf(needle);

/** Le bloc d'une étape : de son marqueur jusqu'au marqueur d'étape suivant. */
function stepBlock(needle: string): string {
  const from = at(needle);
  expect(from, `étape introuvable : ${needle}`).toBeGreaterThan(0);
  const rest = VERIFY.slice(from + needle.length);
  const next = rest.search(/\n {6}- (name|run|uses):/);
  return next < 0 ? rest : rest.slice(0, next);
}

const PUSH_MAIN =
  "github.event_name == 'push' && github.ref == 'refs/heads/main'";
const DEPLOY_STEPS = [
  '- name: Check heavy files are on their origin',
  '- name: Prepare the Cloudflare Pages output',
  '- name: Deploy to Cloudflare Pages',
  '- name: Verify production serves this build',
];

describe('le job Verify and build, porte du déploiement', () => {
  it('le job est bien repéré dans le workflow', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(VERIFY).toContain('name: Verify and build');
  });

  it('son enveloppe tient le pire runner lent mesuré, et l’étape des pages a la sienne, plus courte', () => {
    const job = Number(/\n {4}timeout-minutes:\s*(\d+)/.exec(VERIFY)![1]);
    const pages = Number(
      /timeout-minutes:\s*(\d+)/.exec(
        stepBlock('- name: Check the generated pages in a browser')
      )![1]
    );
    // Pire total extrapolé sur un runner lent : 16 à 17 min (pages 10,6 min mesurées, coupées à 15,3).
    expect(job).toBeGreaterThanOrEqual(22);
    // Une coupure ne doit pas pouvoir immobiliser la porte pendant des heures.
    expect(job).toBeLessThanOrEqual(30);
    // L'étape garde son propre garde-fou, au-dessus du pire mesuré (10,6 min) et sous l'enveloppe du job.
    expect(pages).toBeGreaterThanOrEqual(12);
    expect(pages).toBeLessThan(job);
  });

  it('les pages générées, le budget et l’empreinte sont joués AVANT toute étape de déploiement', () => {
    const deploy = at('- name: Deploy to Cloudflare Pages');
    const order = [
      '- run: pnpm verify',
      '- run: pnpm build',
      '- name: Verify generated documents are unchanged',
      '- name: Verify the startup budget per family',
      '- name: Check the generated pages in a browser',
    ].map(at);
    for (const position of order) expect(position).toBeGreaterThan(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(deploy).toBeGreaterThan(Math.max(...order));
    // Le déploiement est dans CE job : aucun `needs` ne peut le séparer de ces contrôles.
    expect(VERIFY).not.toMatch(/\n {4}needs:/);
  });

  it('aucune de ces étapes ne peut échouer sans arrêter le job', () => {
    expect(VERIFY).not.toContain('continue-on-error');
    expect(
      stepBlock('- name: Check the generated pages in a browser')
    ).toContain('run: pnpm test:pages');
  });

  it('seul un push sur main déploie : jamais un workflow_dispatch ni une pull request', () => {
    for (const step of DEPLOY_STEPS) {
      const block = stepBlock(step);
      expect(block, step).toContain(`if: ${PUSH_MAIN}`);
      expect(block, step).not.toContain('workflow_dispatch');
    }
    // Aucune autre étape du job ne touche à Cloudflare ni au jeton.
    const code = VERIFY.replace(/^\s*#.*$/gm, '');
    const others = code
      .split(/\n {6}- (?=name|run|uses)/)
      .filter(
        (block) =>
          /wrangler|CLOUDFLARE_API_TOKEN/.test(block) &&
          !DEPLOY_STEPS.some((s) => block.startsWith(s.replace('- ', '')))
      );
    expect(others).toEqual([]);
    // Le jeton n'existe qu'à l'étape de déploiement.
    expect(stepBlock('- name: Deploy to Cloudflare Pages')).toContain(
      'secrets.CLOUDFLARE_API_TOKEN'
    );
    expect(CI_YML).toMatch(/\npermissions:\n {2}contents: read\n/);
  });
});
