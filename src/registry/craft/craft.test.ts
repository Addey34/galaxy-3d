import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCraftModels,
  CRAFT_MODELS,
  DRACO_DECODER_DIR,
} from '@/config/craftModels';
import { SPACECRAFT_ORDER } from '@/registry/spacecraft';
import filesFile from './files.json';
import modelsFile from './models.json';

/**
 * LES GARDES DU REGISTRE DES MODÈLES D'ENGINS (GAL-OBJECT-IMMERSION-001) : un modèle n'existe que s'il
 * a sa provenance entière, et le fichier servi est exactement celui que le registre décrit.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const LOCALES = ['en', 'fr', 'es', 'pt-BR'] as const;

const glbPath = (id: string): string =>
  resolve(ROOT, 'public/assets/models/craft', `${id}.glb`);

function nodeNames(bytes: Buffer): Set<string> {
  const json = JSON.parse(
    bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')
  ) as { nodes?: { name?: string }[] };
  return new Set((json.nodes ?? []).map((n) => n.name ?? ''));
}

describe('registre des modèles d’engins', () => {
  it('chaque fichier servi a l’empreinte, la taille et la source que le registre déclare', () => {
    expect(CRAFT_MODELS.length).toBeGreaterThanOrEqual(7);
    for (const model of CRAFT_MODELS) {
      const bytes = readFileSync(glbPath(model.id));
      expect(createHash('sha256').update(bytes).digest('hex'), model.id).toBe(
        model.sha256
      );
      expect(bytes.length, model.id).toBe(model.bytes);
      // Une source épinglée à un commit (40 hexadécimaux), jamais à une branche.
      expect(model.sourceUrl, model.id).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/nasa\/NASA-3D-Resources\/[0-9a-f]{40}\/3D%20Models\//
      );
      expect(model.sourceUrl, model.id).toContain(model.commit);
      expect(model.repository).toBe('nasa/NASA-3D-Resources');
    }
  });

  it('les noms et les libellés de pièces ont les quatre langues', () => {
    for (const model of modelsFile.models) {
      for (const l of LOCALES)
        expect(
          (model.name as Record<string, string>)[l],
          `${model.id} ${l}`
        ).toBeTruthy();
      for (const part of model.parts)
        for (const l of LOCALES)
          expect(
            (part.label as Record<string, string>)[l],
            `${model.id}/${part.nodes[0]} ${l}`
          ).toBeTruthy();
    }
  });

  it('une pièce déclarée existe dans le fichier (le nom du noeud est celui de la NASA)', () => {
    for (const model of modelsFile.models) {
      const names = nodeNames(readFileSync(glbPath(model.id)));
      for (const part of model.parts)
        for (const node of part.nodes)
          expect(names.has(node), `${model.id} : noeud « ${node} »`).toBe(true);
    }
  });

  it('chaque cible est une sonde du registre (ou l’ISS) et n’a qu’un modèle', () => {
    const seen = new Set<string>();
    for (const model of CRAFT_MODELS)
      for (const target of model.targets) {
        expect(
          target === 'iss' || SPACECRAFT_ORDER.includes(target),
          `cible inconnue : ${target}`
        ).toBe(true);
        expect(seen.has(target), `cible en double : ${target}`).toBe(false);
        seen.add(target);
      }
  });

  it('un modèle sans fichier, un fichier sans modèle ou un doublon sont refusés', () => {
    const files = filesFile as Parameters<typeof buildCraftModels>[1];
    expect(() =>
      buildCraftModels(
        [...modelsFile.models, { ...modelsFile.models[0]!, id: 'fantome' }],
        files
      )
    ).toThrow(/pas de fichier/);
    expect(() => buildCraftModels(modelsFile.models.slice(1), files)).toThrow(
      /fichier sans modèle/
    );
    expect(() =>
      buildCraftModels([...modelsFile.models, modelsFile.models[0]!], files)
    ).toThrow(/doublon/);
  });

  it('le décodeur Draco servi est celui de three, et son dossier porte l’empreinte de son contenu', () => {
    const served = readFileSync(
      resolve(ROOT, `public${DRACO_DECODER_DIR}draco_decoder.js`)
    );
    const origin = readFileSync(
      resolve(
        ROOT,
        'node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js'
      )
    );
    expect(served.equals(origin)).toBe(true);
    const hash = createHash('sha256').update(served).digest('hex').slice(0, 10);
    expect(DRACO_DECODER_DIR).toBe(`/assets/draco/${hash}/`);
  });
});
