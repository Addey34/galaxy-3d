/* Bascule de langue de la page de confidentialité.
   Fichier externe (et non inline) : la CSP `script-src 'self'` bloque tout script
   inline. Affiche une seule langue à la fois et réutilise la préférence de l'app
   (localStorage 'ssv-locale'), pour un comportement cohérent avec le reste. */
(function () {
  // Doit rester synchronisé avec STORAGE_KEYS.locale (src/config/storageKeys.ts) :
  // cette page statique est hors bundle et ne peut pas l'importer.
  var STORAGE_KEY = 'ssv-locale';

  /* Les QUATRE langues de l'application depuis le lot 20. Cette page n'en connaissait que
     deux jusqu'au lot 35 : un visiteur hispanophone, dont l'application avait pourtant
     enregistré 'es', lisait cette page en ANGLAIS — la préférence était lue, puis jetée
     parce qu'elle ne valait ni 'fr' ni 'en'. */
  var LOCALES = ['en', 'fr', 'es', 'pt-BR'];

  function known(locale) {
    for (var i = 0; i < LOCALES.length; i++)
      if (LOCALES[i] === locale) return true;
    return false;
  }

  function detectLocale() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (known(stored)) return stored;
    } catch (e) {
      /* localStorage indisponible (mode privé strict) : on retombe sur le navigateur. */
    }
    /* `navigator.language` donne 'pt-br', 'pt-pt' ou 'pt' : le portugais du Brésil est la
       seule variante traduite, et servir de l'anglais à un lusophone serait pire. */
    var nav = (navigator.language || 'en').toLowerCase();
    if (nav.indexOf('pt') === 0) return 'pt-BR';
    if (nav.indexOf('fr') === 0) return 'fr';
    if (nav.indexOf('es') === 0) return 'es';
    return 'en';
  }

  function apply(locale) {
    document.documentElement.lang = locale;
    var blocks = document.querySelectorAll('[data-lang]');
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].hidden = blocks[i].getAttribute('data-lang') !== locale;
    }
    var buttons = document.querySelectorAll('.lang-btn');
    for (var j = 0; j < buttons.length; j++) {
      var active = buttons[j].getAttribute('data-locale') === locale;
      buttons[j].classList.toggle('is-active', active);
      buttons[j].setAttribute('aria-pressed', String(active));
    }
  }

  function setLocale(locale) {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch (e) {
      /* Persistance impossible : on applique quand même pour la session courante. */
    }
    apply(locale);
  }

  document.addEventListener('DOMContentLoaded', function () {
    apply(detectLocale());
    var buttons = document.querySelectorAll('.lang-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        setLocale(this.getAttribute('data-locale'));
      });
    }
  });
})();
