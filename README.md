# 988 Training Insights

An interactive dashboard of 1,299 post-training surveys from EveryMind's Understanding 988 training, built for the BuildFest 2026 Nonprofit Data Challenge.

Independent analysis prepared for EveryMind. Not an official EveryMind publication.

## What's in it

Six tabs, all calculated live in the browser from the survey data:

- **Overview**: headline KPIs with 95% confidence intervals, program-wide findings, before/after knowledge, knowing vs. acting, and gain by starting level.
- **Action plan**: five prioritized actions with evidence, owners and measures; EveryMind's five questions on reaching priority communities; and an impact tracker.
- **Groups**: recommend score and intent to call by role and county, plus a students-only county comparison.
- **Sessions**: a review-zone scatter, gain by month, and a sortable session scorecard.
- **Comments**: keyword-coded themes and a searchable comment table.
- **Data quality & methods**: quality flags, robustness checks, 16 statistical tests, the cleaning log, and method notes.

An audience filter (Overview and Comments) switches between all participants, roles, counties and Spanish speakers.

## View it

Open `index.html` in any browser. It needs an internet connection the first time, to load the d3 charting library and the Poppins font.

To publish it with **GitHub Pages**, go to the repository's **Settings → Pages**, set **Source** to "Deploy from a branch", pick `main` and `/ (root)`, and save. The dashboard appears at `https://<your-username>.github.io/<repo-name>/`.

## Rebuild from data

`index.html` is generated, so edit the files in `src/` and `scripts/`, then rebuild:

```bash
pip install -r requirements.txt
python3 scripts/build.py                         # uses data/EveryMind988_Cleaned.xlsx
python3 scripts/build.py path/to/newer.xlsx      # or a newer cleaned workbook
```

## How it's organized

```
index.html               the built dashboard (generated; open or deploy this)
src/template.html        page layout, styles, the small runtime, and the Action plan / methods text
src/dashboard-page.js    the calculations (KPIs, tests, groups, sessions, themes) and chart drawing
scripts/convert.py       reads the workbook's Cleaned_Data and Cleaning_Log sheets
scripts/themes.py        recodes comment themes to the dashboard's categories
scripts/build.py         runs both scripts and packs the data into index.html
data/                    the cleaned survey workbook
```

## Notes on the data

`EveryMind988_Cleaned.xlsx` lacks four columns the dashboard uses, so `convert.py` derives them:

- **Spanish speakers**: people who took the Spanish form, plus people whose comments are written in Spanish.
- **Same answer on every rating**: all six knowledge ratings and any presenter ratings are the same number.
- **Needed a correction**: only rows whose missing training date was filled in. The workbook doesn't mark which rows had answer labels recoded, so this undercounts.
- **Comment ID**: the form's response number.

Counties with fewer than 10 responses are merged into "Other (under 10 responses each)". Comment themes come from keyword rules and are directional.

## Privacy

`index.html` and `data/` contain every survey response, including participants' written comments. Before making this repository public, check with EveryMind and the competition rules. If you're unsure, keep the repository private.

## Credits

Charts use [d3](https://d3js.org) 7.9.0 (ISC license), loaded from cdnjs. The typeface is [Poppins](https://fonts.google.com/specimen/Poppins) (Open Font License), loaded from Google Fonts.
