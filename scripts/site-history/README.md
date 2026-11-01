# Site history snapshots

Assets for `/site-history`: the homepage at each production deploy since January 2024, rebuilt from git
and captured at 1440×900. Vercel no longer keeps the old deployments, so each version is rebuilt from
its commit.

## Inputs

`commits.txt` lists the production deploys to capture (`<sha> <date>`, one per month with activity).

`capture.cjs` answers the old pages' network requests locally, from a data folder
(`$SITE_HISTORY_DATA`, default `./data`, not committed):

- `tables.json`: the public rows of `Projects`, `Blogs`, `experience` and `life_blogs`, read with the
  site's public key. Only published rows are kept, and each capture shows only rows published by that
  commit's date.
- `storage/index.json` + files: images from Supabase Storage, keyed by URL path.
- `extra/index.json` + files: other images the old pages hard-coded (logo, avatar, skill icons).
- `fonts.css` and `node_modules/@fontsource/{rubik,roboto,roboto-slab,sorts-mill-goudy}`: the Google
  Fonts the site uses, served locally.

Contact details (phone numbers, emails) on old pages are blurred before each capture. Widgets that need
private keys (weather, markets, GitHub) render empty.

## Run

```bash
export HISTORY_REPO=/path/to/full/clone WORK=/tmp/site-history
export NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=…   # the public values
while read sha date; do ./run-one.sh "$sha" "$date"; done < commits.txt
python3 build_assets.py ../.. "$HISTORY_REPO" "$WORK/shots"
```

`build_assets.py` writes `public/site-history/*.webp` (first screen, thumbnail, whole page) and
`src/data/siteHistory.json`, drops versions that look the same as the previous one, and adds the
homepage-related commit subjects since the previous version. `tests/site-history.test.mjs` checks the
result.
