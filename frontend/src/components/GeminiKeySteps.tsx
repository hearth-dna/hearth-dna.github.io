/**
 * Plain-language walkthrough for getting a Google Gemini API key. Shown wherever the app asks for
 * one so a first-time user never has to guess what "API key" means or where it comes from.
 */
export function GeminiKeySteps({ open }: { open?: boolean }) {
  return (
    <details className="steps" open={open}>
      <summary>How do I get a Gemini API key? (free, about two minutes)</summary>
      <ol>
        <li>
          Open{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            aistudio.google.com/apikey
          </a>{' '}
          in a new tab and sign in with any Google account (the one you use for Gmail works).
        </li>
        <li>
          Click <strong>Create API key</strong>. If it asks you to pick or create a "project", accept the
          default and continue.
        </li>
        <li>
          A long code starting with <code>AIza</code> appears. Click <strong>Copy</strong> next to it.
        </li>
        <li>
          Come back here, paste the code into the <strong>API key</strong> field and click{' '}
          <strong>Save</strong>. Leave <strong>Model</strong> as it is.
        </li>
      </ol>
      <p className="muted">
        Treat the key like a password: anyone who has it can use Google's service on your account. It is
        stored only in this browser and never included in exports. You can delete it at any time from the same
        Google page.
      </p>
    </details>
  )
}
