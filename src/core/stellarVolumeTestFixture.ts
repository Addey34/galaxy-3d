/**
 * Pour les tests seulement : le volume stellaire tel que le client l'assemble, à partir des fichiers
 * livrés de CHAQUE fournisseur (`public/assets/sky/volume/`, un dossier par licence) et des tables de
 * correspondance de Galaxy. Aucun fichier fusionné n'est livré ni conservé (GAL-UNIVERSE-008).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decodeDetail,
  decodeShell,
  type VolumeDetail,
  type VolumeNameEntry,
  type VolumeShell,
} from './stellarVolume';
import {
  assembleVolume,
  type VolumeAssembly,
  type VolumeIndex,
  type VolumeSources,
} from './stellarVolumeAssembly';

export const VOLUME_DIR = resolve(process.cwd(), 'public/assets/sky/volume');
export const rawVolumeFile = (file: string): Buffer =>
  readFileSync(resolve(VOLUME_DIR, file));
export const volumeJson = <T>(file: string): T =>
  JSON.parse(rawVolumeFile(file).toString('utf8')) as T;
export const toArrayBuffer = (b: Buffer): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

export const readVolumeIndex = (): VolumeIndex =>
  volumeJson<VolumeIndex>('index.json');

/** Les sources de l'assemblage, lues sur le disque ; `override` retire ou remplace un fournisseur. */
export function shippedVolumeSources(
  override: Partial<VolumeSources> = {}
): VolumeSources {
  const index = readVolumeIndex();
  const P = index.providers;
  return {
    index,
    gcns: true,
    missing: volumeJson(P.gcnsMissing.file),
    hygComplement: volumeJson(P.hyg.complement.file),
    nasa: volumeJson(P.nasa.file),
    crossmatch: volumeJson(index.crossmatch.structure.file),
    ...override,
  };
}

export interface AssembledVolume {
  index: VolumeIndex;
  assembly: VolumeAssembly;
  shells: VolumeShell[];
  names: Record<string, VolumeNameEntry>;
  fromHyg: ReadonlySet<number>;
  detailOf(index: number): VolumeDetail | null;
}

/** Le volume complet, tel que la vue le montre une fois tout chargé. */
export function assembleShippedVolume(
  override: Partial<VolumeSources> = {}
): AssembledVolume {
  const sources = shippedVolumeSources(override);
  const { index } = sources;
  const assembly = assembleVolume(sources);
  const m = assembly.manifest;
  const shells = m.shells.map((s, k) => {
    const file = assembly.gcnsShellFile(k);
    const gcns = file ? toArrayBuffer(rawVolumeFile(file)) : null;
    return decodeShell(assembly.shellBuffer(k, gcns), m, s);
  });
  const { names, fromHyg } = assembly.withHygNames(
    volumeJson(index.providers.hyg.names.file),
    volumeJson(index.crossmatch.names.file)
  );
  return {
    index,
    assembly,
    shells,
    names,
    fromHyg,
    detailOf(i) {
      const source = assembly.detailSource(i);
      if (!source) return null;
      if (source.kind === 'known') return source.detail;
      return decodeDetail(
        toArrayBuffer(rawVolumeFile(source.file)),
        source.local,
        m.detailBytes
      );
    },
  };
}
