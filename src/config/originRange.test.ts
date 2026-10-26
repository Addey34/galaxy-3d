import { describe, expect, it } from 'vitest';
// @ts-expect-error : script .mjs sans déclaration de types
import { judgeRange } from '../../scripts/check-origin-range.mjs';

const ok = () => ({
  status: 206,
  headers: new Headers({
    'content-range': 'bytes 0-1023/2000000',
    'access-control-allow-origin': 'https://galaxy.adrianguichard.dev',
    'access-control-expose-headers': 'Content-Range, Content-Length',
  }),
});

describe('sonde de plage de la VM des éphémérides', () => {
  it('ne dit rien quand la plage est servie et exposée', () => {
    expect(judgeRange(ok())).toEqual([]);
  });

  it('refuse un 200 avec le fichier entier, comme les ressources statiques de Cloudflare', () => {
    const response = ok();
    response.status = 200;
    response.headers.delete('content-range');
    expect(judgeRange(response)).toHaveLength(2);
  });

  it("refuse un Content-Range que le navigateur ne peut pas lire d'une autre origine", () => {
    const response = ok();
    response.headers.delete('access-control-expose-headers');
    expect(judgeRange(response)).toEqual([
      "Content-Range n'est pas exposé au navigateur : ",
    ]);
  });

  it('refuse une origine de page que le CORS ne laisse pas passer', () => {
    const response = ok();
    response.headers.set(
      'access-control-allow-origin',
      'https://autre.example'
    );
    expect(judgeRange(response)[0]).toContain('CORS refuse');
  });
});
