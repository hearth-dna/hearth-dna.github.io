/**
 * The app's few icons, drawn here as 24×24 strokes in the current text colour: the phone tab bar
 * and the brand mark. No icon font or library (CLAUDE.md: minimal deps). Always paired with a
 * visible label, so they are hidden from assistive technology.
 */
const PATHS = {
  brand:
    'M3 11 12 4l9 7M5 10v10h14V10M12 20v-4.5c-1.8-1-2.2-2.7-1-4.5.4 1 1 1.4 1.6 1.4.4-1 .2-2-.3-3 2 1 3 3 2.4 5-.4 1-1.2 1-2.7 1.1',
  people:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.7.8 2.7 2.6 3 5.2',
  family:
    'M12 2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM12 7.5V10M6 13v-3h12v3M6 13a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM18 13a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  health:
    'M20.8 8.6c0 5.4-8.8 11-8.8 11s-8.8-5.6-8.8-11A4.6 4.6 0 0 1 12 6.2a4.6 4.6 0 0 1 8.8 2.4ZM3.5 12h4l1.5-3 3 6 1.5-3h7',
  import: 'M12 3v11M7.5 9.5 12 14l4.5-4.5M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14',
  charts: 'M4 4v16h16M7.5 15l3.5-4.5 3 2.5 5-6.5',
  ask: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5ZM8.5 9h7M8.5 12h4.5',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  light:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2.5V4.5M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  dark: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  system: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 3v18M12 7.5h4.5M12 12h6M12 16.5h4.5',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
