# Lab report fixtures

Invented lab results for the reader tests. No real person's results belong here (CLAUDE.md).

| File | What it is |
| --- | --- |
| `gemini-cbc-ru.json` | A reply in the shape `labSchema` asks Gemini for, for a Russian complete blood count: decimal commas, superscript units, an arrow flag, one model mistake (absolute neutrophils given the `%` id) and one implausible platelet count (a thousands slip). |
| `glucose-slip.txt` | A one-line glucose result, single spaces, with a birth date the parser must not take for the sample date. |
| `cbc-en.txt` | An English complete blood count aligned with spaces, flags after the value, neutrophils and lymphocytes as % and absolute. |
| `ru-biochem.txt` | A Russian biochemistry and blood count: decimal commas, `↑`, `до 41`, `< 5,2`, `×10⁹/л`, section headings. |
| `lipid-us.csv` | A US lipid panel export in mg/dL with a header row. |
| `lis-export.tsv` | A tab-separated lab-system export with a Russian header row. |

