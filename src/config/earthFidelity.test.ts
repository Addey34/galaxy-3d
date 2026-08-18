import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import sourceManifest from '../../scripts/texture-sources.json';
import { CELESTIAL_CONFIG } from './bodies';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EARTH_TEXTURE_ROOT = join(PROJECT_ROOT, 'public/assets/textures/earth');
const MAX_OCEAN_BLUE_MEAN = 130;
const MAX_OCEAN_BLUE_EXCESS = 75;
const MAX_SEAM_MEAN = 5;

function earthTexture(name: string): string {
  return join(EARTH_TEXTURE_ROOT, name);
}

function meanAndStd(values: readonly number[]): { mean: number; std: number } {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

describe('Earth scientific fidelity guardrails', () => {
  it('keeps physical catalogue values and visual capabilities', () => {
    const earth = CELESTIAL_CONFIG.bodies.earth;
    const data = earth.realData;

    expect(data?.radiusKm).toBeCloseTo(6371, 0);
    expect(data?.distanceAU).toBeCloseTo(1, 6);
    expect(data?.orbitPeriodDays).toBeCloseTo(365.25, 2);
    expect(data?.axialTilt).toBeCloseTo((23.44 * Math.PI) / 180, 5);
    expect(data?.massKg).toBeCloseTo(5.972e24, -20);
    expect(data?.gravity).toBeCloseTo(9.81, 2);

    const siderealRotationHours =
      (2 * Math.PI) / Math.abs(earth.rotationSpeed) / 3600;
    expect(siderealRotationHours).toBeCloseTo(23.9345, 4);
    expect(earth.atmosphereColor).toBeTypeOf('number');
    expect(earth.textureResolutions?.surface).toEqual(['8k', '4k', '2k', '1k']);
    expect(earth.textureResolutions?.normalMap).toEqual([
      '8k',
      '4k',
      '2k',
      '1k',
    ]);
    expect(earth.textureResolutions?.displacement).toEqual(['2k', '1k']);
  });

  it('keeps complete provenance for all configured Earth texture layers', () => {
    const earthReviews = sourceManifest.reviews.filter(
      (review) => review.body === 'earth'
    );
    const expectedLayers = [
      'surface',
      'clouds',
      'normalMap',
      'displacement',
      'spec',
      'lights',
    ];

    expect(earthReviews.map((review) => review.layer).sort()).toEqual(
      [...expectedLayers].sort()
    );

    for (const review of earthReviews) {
      expect(review.sourcePage, review.layer).toMatch(/^https:\/\//);
      expect(review.sourceResolution, review.layer).toBeTruthy();
      expect(review.projection, review.layer).toBeTruthy();
      expect(review.status, review.layer).toMatch(/^(reference|derived)$/);
    }

    const normalReview = earthReviews.find(
      (review) => review.layer === 'normalMap'
    );
    expect(normalReview?.status).toBe('derived');
    expect(normalReview?.sourcePage).toContain('etopo-global-relief-model');
    expect(normalReview?.processing).toContain('physical DEM');
    expect(normalReview?.processing).toContain('NORMAL_STRENGTH=24');
    expect(normalReview?.processing).toContain('generate-earth-normal.mjs');
    expect(normalReview?.note).toContain('not raw altitude');

    const displacementReview = earthReviews.find(
      (review) => review.layer === 'displacement'
    );
    expect(displacementReview?.status).toBe('derived');
    expect(displacementReview?.processing).toContain('clamp');
    expect(displacementReview?.note).toContain('bathymetry');
  });

  it('keeps the deployed normal map at 2:1 with measurable relief', async () => {
    const file = earthTexture('earth_normal_map_2k.jpg');
    expect(existsSync(file)).toBe(true);

    const { data, info } = await sharp(file).raw().toBuffer({
      resolveWithObject: true,
    });
    expect(info.width).toBe(2048);
    expect(info.height).toBe(1024);
    expect(info.channels).toBe(3);

    const red: number[] = [];
    const green: number[] = [];
    for (let index = 0; index < data.length; index += info.channels) {
      red.push(data[index]);
      green.push(data[index + 1]);
    }
    expect(meanAndStd(red).std).toBeGreaterThan(8);
    expect(meanAndStd(green).std).toBeGreaterThan(8);
  });

  it('keeps the deployed displacement map bounded and ocean-clamped', async () => {
    const heightFile = earthTexture('earth_displacement_2k.jpg');
    const specFile = earthTexture('earth_spec_2k.jpg');
    expect(existsSync(heightFile)).toBe(true);

    const height = await sharp(heightFile).raw().toBuffer({
      resolveWithObject: true,
    });
    const spec = await sharp(specFile).raw().toBuffer({
      resolveWithObject: true,
    });

    expect(height.info.width).toBe(2048);
    expect(height.info.height).toBe(1024);
    expect(height.info.channels).toBeGreaterThanOrEqual(1);
    expect(spec.info.width).toBe(height.info.width);
    expect(spec.info.height).toBe(height.info.height);

    let oceanPixels = 0;
    let oceanHeightSum = 0;
    let landPixels = 0;
    let maxByte = 0;
    for (let y = 0; y < height.info.height; y += 1) {
      for (let x = 0; x < height.info.width; x += 1) {
        const heightIndex = (y * height.info.width + x) * height.info.channels;
        const specIndex = (y * spec.info.width + x) * spec.info.channels;
        const byte = height.data[heightIndex];
        maxByte = Math.max(maxByte, byte);
        if (spec.data[specIndex + 1] > 220) {
          oceanPixels += 1;
          oceanHeightSum += byte;
        } else {
          landPixels += 1;
        }
      }
    }

    expect(oceanPixels).toBeGreaterThan(100_000);
    expect(landPixels).toBeGreaterThan(100_000);
    expect(oceanHeightSum / oceanPixels).toBeLessThan(2);
    expect((maxByte / 255) * 0.0014).toBeLessThanOrEqual(0.0014);
  });
  it('keeps visible northern polar ice in the deployed surface reference', async () => {
    const file = earthTexture('earth_surface_2k.jpg');
    expect(existsSync(file)).toBe(true);

    const { data, info } = await sharp(file)
      .extract({ left: 0, top: 0, width: 2048, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channelMeans = [0, 1, 2].map(
      (channel) =>
        Array.from(
          { length: info.width },
          (_, index) => data[index * 3 + channel]
        ).reduce((sum, value) => sum + value, 0) / info.width
    );

    expect(channelMeans[0]).toBeGreaterThan(150);
    expect(channelMeans[2] - channelMeans[0]).toBeLessThan(50);
  });

  it('keeps the surface seam and ocean color below the documented ceiling', async () => {
    const surfaceFile = earthTexture('earth_surface_2k.jpg');
    const specFile = earthTexture('earth_spec_2k.jpg');
    const surface = await sharp(surfaceFile).raw().toBuffer({
      resolveWithObject: true,
    });
    const spec = await sharp(specFile).raw().toBuffer({
      resolveWithObject: true,
    });

    expect(surface.info.width).toBe(2048);
    expect(surface.info.height).toBe(1024);
    expect(spec.info.width).toBe(surface.info.width);
    expect(spec.info.height).toBe(surface.info.height);

    let seamSum = 0;
    let seamSamples = 0;
    let oceanPixels = 0;
    let oceanBlueSum = 0;
    let oceanBlueExcessSum = 0;
    const yStart = Math.floor(surface.info.height * 0.16);
    const yEnd = Math.ceil(surface.info.height * 0.84);

    for (let y = 0; y < surface.info.height; y += 1) {
      const left = y * surface.info.width * surface.info.channels;
      const right =
        (y * surface.info.width + surface.info.width - 1) *
        surface.info.channels;
      for (let channel = 0; channel < 3; channel += 1) {
        seamSum += Math.abs(
          surface.data[left + channel] - surface.data[right + channel]
        );
        seamSamples += 1;
      }
      if (y < yStart || y >= yEnd) continue;

      for (let x = 0; x < surface.info.width; x += 1) {
        const index = (y * surface.info.width + x) * surface.info.channels;
        const specIndex = (y * spec.info.width + x) * spec.info.channels;
        if (spec.data[specIndex + 1] <= 220) continue;

        const red = surface.data[index];
        const green = surface.data[index + 1];
        const blue = surface.data[index + 2];
        oceanPixels += 1;
        oceanBlueSum += blue;
        oceanBlueExcessSum += blue - Math.max(red, green);
      }
    }

    expect(seamSum / seamSamples).toBeLessThan(MAX_SEAM_MEAN);
    expect(oceanPixels).toBeGreaterThan(100_000);
    expect(oceanBlueSum / oceanPixels).toBeLessThan(MAX_OCEAN_BLUE_MEAN);
    expect(oceanBlueExcessSum / oceanPixels).toBeLessThan(
      MAX_OCEAN_BLUE_EXCESS
    );
  });
});
