# Timeline import fixtures

Invented readings for the CSV timeline import tests. No real person's data belongs here (CLAUDE.md).

| File | What it is |
| --- | --- |
| `growth.csv` | A wide Russian growth table for a baby: `;` delimiter, decimal commas, `dd.mm.yyyy`, units in brackets, a note column. |
| `vitals.csv` | A wide US table: `mm/dd/yyyy`, weight in lb, blood pressure as two columns (one row missing diastolic), glucose in mg/dL, a quoted note with a comma. |
| `device-export.csv` | A long export in the shape of a phone health app: one reading per row with type, unit, value and a date-time; temperature in °F and a metric the app has no preset for. |
