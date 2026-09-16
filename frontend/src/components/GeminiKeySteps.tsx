import { rich, useT } from '../i18n/context'

/**
 * Plain-language walkthrough for getting a Google Gemini API key. Shown wherever the app asks for
 * one so a first-time user never has to guess what "API key" means or where it comes from.
 */
export function GeminiKeySteps({ open }: { open?: boolean }) {
  const t = useT()
  return (
    <details className="steps" open={open}>
      <summary>{t('geminiKeySteps.summary')}</summary>
      <ol>
        <li>
          {rich(t('geminiKeySteps.step1'), {
            a: (c) => (
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                {c}
              </a>
            ),
          })}
        </li>
        <li>{rich(t('geminiKeySteps.step2'))}</li>
        <li>{rich(t('geminiKeySteps.step3'))}</li>
        <li>{rich(t('geminiKeySteps.step4'))}</li>
      </ol>
      <p className="muted">{t('geminiKeySteps.warning')}</p>
    </details>
  )
}
