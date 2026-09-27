/**
 * L'ANNONCEUR : ce que l'application DIT à qui ne la voit pas (lot 19).
 *
 * La passe lecteur d'écran du lot 19 a mesuré trois silences, et les trois ont la même cause :
 * l'application change d'état sans qu'aucune région live ne le dise. Le chargement dure une
 * dizaine de secondes sans un mot ; choisir un corps ouvre sa fiche sans un mot ; activer une
 * ligne d'événement déplace la date sans un mot. Relevé dans
 * `docs/private/LECTEUR_ECRAN_LOT19.md`, défauts D4, D6 et D11.
 *
 * POURQUOI UNE RÉGION UNIQUE, ATTACHÉE AU DOCUMENT. Chaque module aurait pu poser la sienne, et
 * c'est ce que faisait déjà `ui/offlineData`. Mais sa région vit DANS le panneau des réglages,
 * qui porte `hidden` dès qu'on le referme : une région live masquée n'annonce rien, donc la fin
 * d'un téléchargement lancé puis laissé de côté ne se disait pas. Une région attachée au
 * `<body>` n'a pas ce défaut, et il n'y a qu'un endroit où vérifier la politesse du ton.
 *
 * `polite` et jamais `assertive` : rien ici n'est assez urgent pour couper la parole à
 * quelqu'un. Un `assertive` interromprait la lecture d'une fiche au milieu d'une phrase.
 */

export interface Announcer {
  /**
   * Met un message dans la file.
   *
   * Deux messages IDENTIQUES à la suite sont bien annoncés deux fois : réécrire le même texte
   * dans un nœud ne déclenche aucune mutation, donc rien ne serait dit la seconde fois, et
   * « la date n'a pas changé » se confondrait avec « je n'ai rien entendu ».
   *
   * `channel` sert aux messages qui se CORRIGENT plutôt que de s'ajouter : le compte de
   * résultats d'une recherche change à chaque lettre tapée, et seul le dernier a un sens. Deux
   * messages du même canal encore en attente n'en font qu'un, le plus récent. Sans canal, les
   * messages s'ajoutent.
   */
  announce(message: string, channel?: string): void;
  dispose(): void;
}

function createRegion(): HTMLElement {
  const region = document.createElement('p');
  region.className = 'sr-only';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  document.body.append(region);
  return region;
}

/**
 * Écart minimal entre deux annonces.
 *
 * Ce délai n'est pas un confort, c'est la correction d'un défaut MESURÉ. Activer une ligne
 * d'événement annonçait la nouvelle date puis, aussitôt, le corps sélectionné : la seconde
 * écrasait la première dans la région, et le lecteur d'écran n'énonçait que « Moon selected ».
 * La garde `e2e/a11y-screenreader.spec.ts` est tombée dessus, et c'est ce qui a transformé la
 * région en FILE. Une région live ne garde que son dernier état ; il faut donc laisser à
 * chaque message le temps d'être lu avant de le remplacer.
 */
const GAP_MS = 1200;

interface Pending {
  text: string;
  channel?: string;
}

function createAnnouncer(): Announcer {
  const region = createRegion();
  // DEUX nœuds, et on alterne celui qui porte le texte.
  //
  // Réécrire le même texte dans le MÊME nœud ne produit aucune mutation, donc rien n'est
  // annoncé la seconde fois. Alterner entre deux nœuds garantit une mutation à chaque fois,
  // et, avec `aria-atomic`, la région est relue en entier. L'autre tour de passe-passe
  // répandu, ajouter une espace invisible en fin de texte, introduirait un caractère
  // d'espacement irrégulier dans le code pour le même résultat.
  const first = document.createElement('span');
  const second = document.createElement('span');
  region.append(first, second);

  const queue: Pending[] = [];
  let alternate = false;
  let timer = 0;

  const write = (text: string): void => {
    alternate = !alternate;
    first.textContent = alternate ? text : '';
    second.textContent = alternate ? '' : text;
  };

  const drain = (): void => {
    const next = queue.shift();
    if (!next) {
      timer = 0;
      return;
    }
    write(next.text);
    timer = window.setTimeout(drain, GAP_MS);
  };

  return {
    announce(message, channel) {
      const text = message.trim();
      if (!text) return;
      if (channel) {
        const waiting = queue.find((item) => item.channel === channel);
        if (waiting) {
          waiting.text = text;
          return;
        }
      }
      queue.push({ text, channel });
      if (!timer) drain();
    },
    dispose() {
      window.clearTimeout(timer);
      timer = 0;
      queue.length = 0;
      region.remove();
    },
  };
}

let shared: Announcer | null = null;

/**
 * L'annonceur de l'application. Un singleton paresseux, comme `TextureSystem` : les modules qui
 * en ont besoin sont trop dispersés (chargeur, sélection, voyage dans le temps, hors ligne) pour
 * qu'on le fasse circuler de main en main, et il ne doit exister qu'UNE région live.
 */
export function getAnnouncer(): Announcer {
  shared ??= createAnnouncer();
  return shared;
}
