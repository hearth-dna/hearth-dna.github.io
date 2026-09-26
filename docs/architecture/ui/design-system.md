# Design system

All of the web app's look lives in `frontend/src/styles.css`, and the Android and iOS apps use the
same stylesheet. It has no CSS framework and no icon library (CLAUDE.md: minimal deps). The file
has three layers: **tokens**, then **components**, then page-specific rules.

## Tokens

| Group | Tokens | Use |
| --- | --- | --- |
| Spacing | `--space-1…6` = 4, 8, 12, 16, 24, 32 px | every gap, padding and margin |
| Type | `--text-xs/sm/md/lg/xl` = 12, 14, 15, 18, 24 px | body is `md`; captions and labels `sm`; table headers `xs` |
| Radius | `--radius-sm` 6, `--radius-md` 10, `--radius-lg` 14, `--radius-pill` | controls `sm`, notices `md`, cards and dialogs `lg`, chips `pill` |
| Controls | `--control-h` 2.5rem, `--control-h-sm` 2rem | the height of every button, input and select |
| Surfaces | `--bg`, `--surface`, `--surface-2`, `--line`, `--line-strong`, `--shadow-1/2` | page, card, inset or hover, borders, elevation |
| Colour | `--fg`, `--muted`, `--accent`, `--accent-soft`, `--ok`, `--warn`, `--danger`, `--info` | text, the one brand colour, and states |
| Charts | `--series-1…8`, `--chart-band` | the dataviz palette, fixed order, checked in both modes |

Dark mode redefines the tokens under `prefers-color-scheme: dark`; components never branch on the
mode. `--card` and `--radius` are aliases kept for older page rules.

## Components

- **Buttons.** The default is the secondary style. `primary` is the page's main action, one per
  group. `ghost` is for low-emphasis actions in headers and lists. `danger` is an outline that
  fills on hover. `small` works in dense places: table rows, card headers, filters. `link` looks
  like a text link.
- **Fields.** `label.field` puts the label above its control; `.field.inline` puts it beside.
  **The row rule:** a `.row` holding a `.field` aligns its children on the bottom edge. A button
  next to an input then sits level with the input, not centred on label plus input. That is why
  "Add", "Export dump" and "Save" line up with their inputs.
- **Layout.**
  - `.row` wraps with a gap.
  - `.toolbar` (and `.row.filters`) holds a filter strip.
  - `.actions` holds a group of buttons.
  - `.grid` is responsive cards. A card's `.actions` sits at its bottom, so buttons line up
    across the cards in a row. `.actions.stacked` makes full-width buttons with the main one
    last.
- **Surfaces.** `.card` has its first child's top margin removed. `.card-head` puts a title and
  its actions on one line; the actions wrap below it on phones. `.card.inset` is a card nested in
  another. `.notice` has `ok`, `info` and `danger` variants (the default is a warning).
  `dialog.sheet` is a bottom sheet on phones.
- **Chips and badges.** `button.tag` is a filter or preset chip; `active` means selected;
  `condition` has a dashed outline until linked. `.badge` is a label (`A`/`B`/`C` for evidence).
  `.row.tabs` holds pill tabs, and `.segmented` is a view switch.
- **Tables.** Wrap them in `.tablewrap` for scrolling and a sticky header. Numbers use tabular
  figures.

## Spacing utilities

Add spacing between blocks with `.stack`, `.mt-0/2/3/4`, `.mb-3`, `.m-0`, `.grow`, `.ms-auto` and
`.me-auto`, never with inline `style={{ margin… }}`. Inline styles are for values that come from
data: a person's series colour, or a chart's measured size.

## Navigation

- **Desktop:** a single header line with the brand, the page tabs (the current page has an
  accent underline), then sync and Erase data. The status text is shown only above 1400px, and
  its full text is in `title`.
- **≤ 640px:** a fixed bottom tab bar with People, Health, Import, Charts, Ask and More. More
  opens a sheet with Family lookup, Settings & export, the status line and Erase data. `main` is
  padded by the bar height plus `env(safe-area-inset-bottom)`, and `index.html` sets
  `viewport-fit=cover`, so the Android and iOS apps fit the screen too. Icons come from
  `components/Icon.tsx` (24×24 strokes, always with a visible label).

## Right-to-left

New rules use logical properties (`margin-inline-*`, `padding-inline-*`, `text-align: start`),
so Arabic and Urdu mirror without per-rule `[dir=rtl]` overrides.

## Theme

There are three modes: **System** (the default, following the device), **Light** and **Dark**.
You can switch them with the header button, which cycles System → Light → Dark, or with the
Appearance card in Settings. `app/theme.ts` stores the choice under `hearth.theme` in
`localStorage`. It's a per-device preference like the language, and it isn't part of a dump.
`main.tsx` applies the stored theme before the first render.

Forcing a mode sets `<html data-theme="light|dark">`. The dark tokens are declared twice: under
`@media (prefers-color-scheme: dark) :root:not([data-theme='light'])` and under
`:root[data-theme='dark']`. The CSS function `light-dark()` would avoid this, but it's newer than
the engine floors (Android WebView 108, iOS 17.0). `styles.test.ts` fails if the two blocks
drift apart. `color-scheme` follows the choice, so date pickers, scrollbars and select popups
match the theme.
