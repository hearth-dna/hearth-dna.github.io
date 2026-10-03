// The landing page in the visitor's language. English is the page as written; the other 19 come
// from i18n/<code>.json. The choice is the app's own preference (`hearth.language`, same origin),
// so picking a language here or in the app sets both.

// An installed Hearth (it was installed when the app lived at /) opens straight into the app.
if (matchMedia('(display-mode: standalone)').matches) location.replace('/app/')

const KEY = 'hearth.language'
const select = document.getElementById('lang')
const shipped = [...select.options].map((o) => o.value)
const nodes = [
  ...[...document.querySelectorAll('[data-i18n]')].map((el) => ({ el, key: el.dataset.i18n, set: (v) => { el.textContent = v } })),
  ...[...document.querySelectorAll('[data-i18n-html]')].map((el) => ({ el, key: el.dataset.i18nHtml, set: (v) => { el.innerHTML = v } })),
  ...[...document.querySelectorAll('[data-i18n-aria]')].map((el) => ({ el, key: el.dataset.i18nAria, set: (v) => el.setAttribute('aria-label', v) })),
  ...[...document.querySelectorAll('[data-i18n-title]')].map((el) => ({ el, key: el.dataset.i18nTitle, set: (v) => el.setAttribute('title', v) })),
  ...[...document.querySelectorAll('[data-i18n-content]')].map((el) => ({ el, key: el.dataset.i18nContent, set: (v) => el.setAttribute('content', v) })),
]
// The English as the page carries it, to switch back without a reload.
const english = Object.fromEntries(
  nodes.map(({ el, key }) => [
    key,
    el.dataset.i18nHtml ? el.innerHTML : el.dataset.i18n ? el.textContent
      : el.getAttribute(el.dataset.i18nAria ? 'aria-label' : el.dataset.i18nTitle ? 'title' : 'content'),
  ]),
)

const stored = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
/** The stored choice, else the first browser language we ship (primary subtag), else English. */
function initial() {
  const s = stored()
  if (s && shipped.includes(s)) return s
  for (const tag of navigator.languages ?? [navigator.language]) {
    const primary = String(tag).toLowerCase().split('-')[0]
    if (shipped.includes(primary)) return primary
  }
  return 'en'
}

async function apply(code) {
  const strings = code === 'en' ? english : await fetch(`i18n/${code}.json`).then((r) => (r.ok ? r.json() : english))
  for (const { key, set } of nodes) set(strings[key] ?? english[key])
  document.documentElement.lang = code
  document.documentElement.dir = select.querySelector(`option[value="${code}"]`)?.dataset.dir ?? 'ltr'
  select.value = code
}

select.addEventListener('change', () => {
  try {
    localStorage.setItem(KEY, select.value)
  } catch {}
  apply(select.value)
})
apply(initial())
