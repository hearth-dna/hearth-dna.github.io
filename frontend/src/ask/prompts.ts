/** Prompt library for copy-out context packs (docs/design.md §6.3). Editable in Settings later. */
export interface PromptTemplate {
  id: string
  title: string
  /** i18n key for `title`; the UI renders this, `title` stays as the English source. */
  titleKey: string
  needs: ('genotypes' | 'family' | 'notes' | 'health')[]
  text: string
}

export const PROMPTS: PromptTemplate[] = [
  {
    id: 'explain',
    title: 'Explain this finding',
    titleKey: 'prompt.explain.title',
    needs: ['genotypes'],
    text: 'Explain in plain language what the genotypes above mean for this person. Separate what is well established from what is preliminary. Give absolute risks where the literature has them, not just relative ones. End with three questions I could ask a clinician.',
  },
  {
    id: 'doctor',
    title: 'Prepare questions for my doctor',
    titleKey: 'prompt.doctor.title',
    needs: ['genotypes', 'notes'],
    text: 'I have an appointment soon. Based on the context above, write a short list of specific questions to ask, ordered by importance, and note which findings a clinician would most likely want to confirm with a proper test.',
  },
  {
    id: 'medication',
    title: 'Is this medication affected by my genetics?',
    titleKey: 'prompt.medication.title',
    needs: ['genotypes'],
    text: 'For the medication named in my question, use the pharmacogenomic genotypes above to describe what current guidelines (for example CPIC) say about dose or drug choice for this metaboliser status. State clearly when the guideline has no recommendation. Do not tell me to change anything myself.',
  },
  {
    id: 'compare',
    title: 'Compare two family members on this topic',
    titleKey: 'prompt.compare.title',
    needs: ['genotypes', 'family'],
    text: 'Compare the family members in the context above on the topic in my question. Where a child carries a variant, say which parent it most likely came from given the genotypes shown. Keep it factual.',
  },
  {
    id: 'labs',
    title: 'Interpret my lab results with my genetics',
    titleKey: 'prompt.labs.title',
    needs: ['genotypes', 'health'],
    text: 'Read the dated health-log entries above together with the genotypes. Point out values outside their reference ranges, any trend across dates, and where a genotype plausibly explains or modifies a value. Say plainly when there is no link. Do not diagnose.',
  },
  {
    id: 'symptoms',
    title: 'Make sense of my symptoms and measurements',
    titleKey: 'prompt.symptoms.title',
    needs: ['health', 'genotypes'],
    text: 'Read the dated symptoms and measurements above as a timeline. Describe the pattern (onset, frequency, what changed with medication), which measurements are outside usual ranges, and which common, non-alarming explanations and which warning signs are worth checking with a clinician, and how urgently. Mention a genotype only where it is plausibly relevant. Do not diagnose.',
  },
  {
    id: 'second-opinion',
    title: 'Second opinion on a report',
    titleKey: 'prompt.second-opinion.title',
    needs: ['genotypes', 'notes'],
    text: 'I am pasting a report or a set of findings. Point out anything overstated, anything missing, and any claims that conflict with current guidelines. Be blunt about evidence quality.',
  },
]

export const ASSISTANT_INSTRUCTIONS =
  'Answer plainly. Say what is uncertain. This is not a request for diagnosis or treatment; end with what to ask a qualified clinician. The context was assembled locally by me from consumer genotyping data and may contain errors.'
