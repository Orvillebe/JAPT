/**
 * JAPT i18n - interface text by key.
 *
 * Responsibilities:
 *   - t(key, vars): the text for a key in the active language, with {name} placeholders filled in
 *   - applyTranslations(): fill elements that carry data-i18n (text), data-i18n-placeholder,
 *     data-i18n-title or data-i18n-aria
 *
 * The dictionaries live next to this file (nl.js). Another language is another file that
 * defines the same keys; the code never contains interface text.
 */

const I18N = (() => {
  const dictionaries = { nl: typeof NL !== 'undefined' ? NL : {} };
  const language = 'nl';

  function t(key, vars = {}) {
    let text = dictionaries[language][key];
    if (text === undefined) { console.warn('Missing translation:', key); return key; }
    for (const [k, v] of Object.entries(vars)) text = text.split('{' + k + '}').join(v);
    return text;
  }

  function applyTranslations(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
    root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  }

  return { t, applyTranslations, language };
})();

const t = I18N.t;
