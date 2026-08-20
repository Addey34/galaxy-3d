/* Bascule de langue de la page de confidentialité.
   Fichier externe (et non inline) : la CSP `script-src 'self'` bloque tout script
   inline. Affiche une seule langue à la fois et réutilise la préférence de l'app
   (localStorage 'ssv-locale'), pour un comportement cohérent avec le reste. */
(function () {
  var STORAGE_KEY = 'ssv-locale';

  function detectLocale() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'fr' || stored === 'en') return stored;
    } catch (e) {
      /* localStorage indisponible (mode privé strict) : on retombe sur le navigateur. */
    }
    var nav = (navigator.language || 'en').toLowerCase();
    return nav.indexOf('fr') === 0 ? 'fr' : 'en';
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
