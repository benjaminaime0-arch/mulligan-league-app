# Personal rounds and internal golf level

The October 2026 milestone adds independent cards, a separate internal level,
and submissions of the same card revision to multiple private leagues.
Existing matches, practice containers and Elo data remain available.

## User flow

Open **My cards** from Home, Profile or the New menu. Select the exact layout
and tee, enter the play date and record the holes. Save a draft until the course-local entry deadline.
Confirmation requires all 9 or 18 holes completed or explicitly picked up and
verified course reference data. A picked-up hole scores zero Stableford points;
it does not produce a valid gross/net stroke total.

A confirmed card can be submitted to several compatible leagues without
copying its scores. Creating a compatible league from the card fixes the tee,
season dates, format, required best-card count and attestation mode. This
milestone uses one primary ranking and a sum of the best N cards. Players below
N have no rank. Other aggregation modes and secondary standings are subsequent
milestones.

Submitted revisions are visible to league members. Other personal cards and
draft edits remain private. Choose a designated playing partner from a shared
league before confirming, or confirm an independent personal card immediately.
The latter is permanently locked and cannot later enter a witness-required
league. The validator declares presence; this is not technical proof of presence.

The lifecycle is draft → pending_validation → validated, or
pending_validation → pending_player_confirmation → validated/disputed.
Submission freezes the scores. Only the designated validator may propose one
correction, with a reason and a new immutable revision recording its author.
The player explicitly accepts or refuses. Refusal permanently disputes the
entire card; it is excluded from every league and the internal level, cannot
be reopened and cannot be resubmitted. Validated cards are also permanently
locked. The level and standings count validated cards only.

A correction preserves every original timely league association and submission
timestamp. Previous pinned revisions stay in the history as superseded.
Acceptance updates all eligible leagues together; a newly picked-up hole excludes
a net/gross stroke submission while still allowing a Stableford submission.
The personal round contributes once to the internal level.

The initial validator request stores UTC validation_requested_at and
 auto_validation_at exactly 72 elapsed hours later. The server-only pg_cron
worker runs every minute; transactions and consistent user/card locks prevent
manual reviews and repeated workers from settling twice. A correction cancels
the timer, and player confirmation never times out. The UI timer is display-only
and derives elapsed time from the server response. UTC instants are displayed
in the card's frozen IANA course timezone.

My cards includes an action inbox. In-app notifications link to the same shared
card review. Card events and revision authors/reasons remain available in the
card's activity history. The legacy match-result approval timer is separate.

## Calculation conventions

The internal indicator is separate from the declared official index and Elo.
It is provisional after one/two cards and established after three. The smaller
sample schedule follows the supplied plan, then selects the best eight of the
last twenty by play date, creation time and round ID. Corrections replace a
round's active revision. It is an estimate and is not WHS certified.

A round's index is frozen at creation: established internal level from cards
played on/before its play date; otherwise the declared official index effective
on/before that date; otherwise 54. Later level changes do not rewrite that
snapshot. The round being recorded cannot affect its own allowance.

The nine-hole index is halved before applying the tee's slope/rating/par formula.
The nine-hole differential is doubled as the plan's internal 18-hole estimate.
Numeric rounding is deterministic. Negative handicaps give strokes back on the
highest stroke indexes. Official index declarations are manual.

Cards must be entered and initially submitted by the end of the calendar day
following play, in the course's IANA timezone. The stored deadline is exclusive
midnight at the start of the next day, so every instant of 23:59:59 is allowed.
Leagues additionally cap the deadline at midnight following their final day.
There is no seven-day grace period. Timely requests can finish validation after
season closure. Pending requests display closed_provisional standings until all
are validated or disputed; then the season displays finalized. Rules lock after
the first submission. Existing previously confirmed cards retain their results
as validated legacy cards, without retroactive deadline checks.

## Deploying reference data

Apply the scoring-fairness migration before the personal-round migration, then
deploy the frontend. The existing catalogue is imported as **unverified**:
its current data does not establish course rating/slope for an exact tee.
Do not mark invented or estimated ratings as verified. A draft can be saved,
but it cannot be confirmed or enter the level without verified reference data.

A catalogue administrator can call the service-only RPC
`publish_personal_tee(p_course, p_layout, p_name, p_rating, p_slope, p_source, p_holes)`.
Supply a sourced rating/slope and a complete ordered hole array. Each hole has
`hole_number`, `par` and `stroke_index`; use 1..9 or 1..18 uniquely. Distinguish
rating categories in the tee name (for example, yellow men's rating versus
yellow women's rating). For nine-hole segments, supply their exact segment
ratings, not an 18-hole rating divided by two.

Publishing creates a new immutable version. It does not modify reference data
used by historical cards. Never put a service-role key in the browser. Select
published, verified tees for the first pilot; the local fixtures are synthetic
and must not be used as real course data.

### Rueil and Vaucresson pilot

The follow-up migration `20261013075533_seed_rueil_vaucresson_personal_tees.sql`
adds 44 sourced references for Rueil-Malmaison, Haras de Jardy and Stade Français
Haras Lupin. Vaucresson identifies two clubs, so both remain separately named.
Each available conventional colour has distinct Messieurs/Dames ratings and
separate **9 trous — aller** and **18 trous — deux tours** layouts. Two tours
means playing the physical nine holes twice. Orange training references are
excluded. Choose the category that matches the rating used for your card.

The source snapshot is `supabase/reference-data/rueil-vaucresson-20261013.json`,
checked on 13 October 2026 against the federation's public course calculator:

- [Rueil-Malmaison](https://pages.ffgolf.org/tools/calculette?glfcod=0979&tercod=01&k=c8887f89754eee59348bf991e682fbe3)
- [Haras de Jardy](https://pages.ffgolf.org/tools/calculette?glfcod=0904&tercod=01&k=f80f7f2104235506c078dbcaad74eb5d)
- [Haras Lupin](https://pages.ffgolf.org/tools/calculette?glfcod=0902&tercod=01&k=fc5bbf4b67f61781b3d9d60ef5736c66)

FFG's nine-hole fields use a half-slope: its handicap formula applies the full
index to that half-slope. Our engine instead halves the index, so the import
multiplies the published segment slope by two. This preserves the allowance,
including segment rounding. The nine-hole SSS is copied directly from the
`TOUT` field; it is never calculated by halving the 18-hole SSS. For two tours,
the full rating/slope and unique 1..18 stroke indexes are copied directly.
See [FFG vademecum, sections 6.1 and 9-hole handicap](https://www.ffgolf.org/content/download/54677/file/Vademecum%202024.pdf).

For example, yellow Messieurs at Rueil has nine-hole SSS 30.4 and FFG half-slope
52, stored as slope 104. An index of 18 receives 7 strokes on that nine-hole
card. The two-tour reference has SSS 60.7 and slope 104, giving 13 strokes.
The internal differential remains the estimate described above.

These pilot references were deployed and tested in production on 13 October 2026.

## Validation

- `node scripts/test_scoring_ui.cjs`
- `npx tsc --noEmit --incremental false`
- `npx next lint`
- `python3 scripts/check_i18n.py --check`
- `npm run build`
- Full Supabase migration replay plus `supabase/tests/*.sql` in the existing
  db-replay CI workflow. SQL fixtures roll back and target a disposable DB.
- `PGURL=<disposable local database> bash scripts/test_card_validation_races.sh`
  races a designated reviewer with two real PostgreSQL worker connections in CI.

The new SQL suites cover personal scoring, level selection/chronology, stable
handicap snapshots, multi-league reuse, version conflicts, corrections,
attestations, immutable reference data and access control. Production migration
application and real Supabase integration are separate from local validation.
