const DAY = 24 * 3600 * 1000;

/**
 * `--check` compare ce que la SOURCE dit aujourd'hui à ce qui est livré, pas le calendrier. La
 * fenêtre lue finit `PREDICT_DAYS` jours après la date de lecture et chaque ligne porte cette date :
 * un fichier livré hier diffère donc de celui d'aujourd'hui sans que Horizons ait changé (c'est ce
 * qui a ouvert l'issue #316 à tort, le 2026-10-23). On ignore les dates de lecture et la fin de
 * fenêtre, et on exige l'égalité de tout périhélie de la fenêtre LIVRÉE, une demi-fenêtre avant sa
 * fin (au bord, le minimum local n'est pas décidable).
 */
export function sameWithinShippedWindow(shippedText, freshText) {
  if (!shippedText) return false;
  let shipped;
  let fresh;
  try {
    shipped = JSON.parse(shippedText);
    fresh = JSON.parse(freshText);
  } catch {
    return false;
  }
  const strip = ({ retrieved: _retrieved, ...rest }) => rest;
  const limit = new Map(
    shipped.bounds.map((b) => [
      b.probe,
      Date.parse(b.to) - shipped.halfWindowDays * DAY,
    ])
  );
  const inside = (p) => Date.parse(p.at) <= (limit.get(p.probe) ?? -Infinity);
  const key = (p) => JSON.stringify(strip(p));
  const a = shipped.perihelia.filter(inside).map(key);
  const b = fresh.perihelia.filter(inside).map(key);
  const header = ({ bounds: _b, perihelia: _p, ...rest }) =>
    JSON.stringify(rest);
  return (
    a.length === b.length &&
    a.every((line, i) => line === b[i]) &&
    header(shipped) === header(fresh)
  );
}
