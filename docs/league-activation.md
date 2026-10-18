# League launch and activation reporting

Player checklist: league created → invitation prepared → first counted scorecard. A real friend join restores invitation progress on another device, but is not a fourth visible step. Copying an invitation code/link, completing native share, or opening WhatsApp advances local invitation progress; it does not prove delivery. The flag is stored per league in localStorage.

## Google Analytics

Property: MULLIGAN (529322951), web stream G-P4MKCBY52H. The existing stream URL now matches https://app.mulliganclub.co.

[Saved exploration: Mulligan — activation des ligues](https://analytics.google.com/analytics/web/?authuser=1#/analysis/a388358828p529322951/edit/fyLruQ-QRmu1TvXQ6BUtQA)

- **Création → invitation → carte**: open funnel, `league_create_viewed` → `game_created` → `invite_shared` → `league_card_submitted`. Visitors can enter at a later step. This is an ordered individual journey, not a count of distinct activated leagues; a card before an invitation will not complete that sequence.
- **Invitation → ami inscrit**: closed funnel, `invite_link_opened` → `invite_joined`. It measures the invited person's journey separately from the owner's. Manual-code joins are emitted too, but have no link-open step and therefore are outside this funnel.
- Both tabs use device category as the breakdown and a rolling last-28-days range. New event conditions are saved before data arrives; no data is expected retroactively. Allow normal GA processing time before interpreting the report.

Additional consented events: `course_league_viewed`, `league_cta_clicked`, `signup_viewed` and `league_progress_viewed`. The latter is a deduplicated per-tab state observation, not a globally unique first-time milestone. It carries member count, friend-joined flag, first-counted-card flag, active-group flag, and a league-stage label. `league_card_submitted` is emitted only for a newly successful submission (not an unchanged repeat); submission can still await validation.

All events respect existing analytics consent. Views re-evaluate when consent is granted, while actions taken before consent are not replayed. Pending consented events wait in memory for GA initialisation. Attribution retains only allowlisted entry labels (`course_rueil`, `course_jardy`, `league_guide`, `homepage`, or `app`). New events do not include names, email addresses, scores, or invitation codes. League UUIDs remain pseudonymous identifiers. Entry labels and stage parameters are available on events; they are not yet registered GA custom dimensions. Repeated sharing is an action count, not a unique invitation count.

## Actual groups

Run `scripts/league-activation-report.sql` read-only against the production database to count current states independently of cookie consent. **Active group** means at least two members and an accepted, validated scorecard at its current revision, submitted by a current member. Solo leagues with scorecards remain a separate category. The query excludes obvious QA names/accounts only; inspect the cohort before using it as a business KPI. It covers calendar leagues and is a current snapshot, not a historical funnel.

Initial snapshot on 2026-10-18: zero leagues after the query's QA exclusions. This is not evidence of a measured conversion rate. No database schema or production player data changes were required.

## Local search pages

Rueil and Jardy retain their public course URLs and score tables. Unique local league copy, metadata, breadcrumbs, guide links, and course-prefilled signup buttons connect discovery to league creation. Nine-hole pars are 32 and 30 respectively; displayed yellow distance is summed from the nine listed holes instead of the legacy 18-hole field. Official course information remains linked beside the local guide.
