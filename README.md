# Jarvis Dashboard (public mirror)

Static hosting for the Jarvis PWA. **Generated — do not edit by hand.**

Everything here is published from the private `morning-scout` repo by its
`sync_dashboard.yml` workflow.

## What is published here

Only the trading scan output:

- `dashboard_data/scan.json` — nightly breakout / zone-reclaim scan
- `dashboard_data/cci_oversold.json` — CCI oversold watchlist

Publication is **deny-by-default**: `build_pwa.PUBLIC_DATA_ALLOWLIST` in the
private repo names the only files allowed to leave it, and a self-test
asserts the personal feeds (positions and exit theses, task titles, email
subjects, calendar entries) are withheld. A new feed added upstream is not
published unless it is added to that allowlist deliberately.

The app hides any zone whose data is absent, so this renders as a clean
trading dashboard rather than a broken version of the full one.

## Full version

The complete Jarvis view — tasks, email, calendar, exit theses — runs
locally from the private repo:

```bash
python build_pwa.py --serve
```
