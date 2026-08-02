import { describe, expect, it } from 'vitest';
import { findLabelPlacement, type LabelRect } from './exploHud';

describe('projected label layout', () => {
  it('keeps the target on its projected body', () => {
    const placement = findLabelPlacement(
      { name: 'mars', x: 400, y: 300, target: true },
      [],
      800,
      600,
      'explo'
    );
    expect(placement).toMatchObject({
      x: 400,
      y: 300,
      textOffsetX: 0,
      textOffsetY: 0,
      offset: false,
    });
  });

  it('also keeps an educational target centered instead of applying the text offset', () => {
    const placement = findLabelPlacement(
      { name: 'mars', x: 400, y: 300, target: true },
      [],
      800,
      600,
      'educ'
    );
    expect(placement).toMatchObject({
      x: 400,
      y: 300,
      textOffsetX: 0,
      textOffsetY: 0,
      offset: false,
    });
  });

  it('moves a colliding secondary label to a free slot', () => {
    const occupied: LabelRect[] = [
      { left: 390, right: 470, top: 290, bottom: 325 },
    ];
    const placement = findLabelPlacement(
      { name: 'earth', x: 400, y: 300, target: false },
      occupied,
      800,
      600,
      'explo'
    );
    expect(placement).not.toBeNull();
    expect(placement?.offset).toBe(true);
    const rect = placement!.rect;
    const first = occupied[0];
    expect(
      rect.right <= first.left ||
        rect.left >= first.right ||
        rect.bottom <= first.top ||
        rect.top >= first.bottom
    ).toBe(true);
  });

  it('drops a label when every safe slot is occupied', () => {
    const occupied: LabelRect[] = [
      { left: 0, right: 800, top: 0, bottom: 600 },
    ];
    expect(
      findLabelPlacement(
        { name: 'mercury', x: 400, y: 300, target: false },
        occupied,
        800,
        600,
        'educ'
      )
    ).toBeNull();
  });
});
