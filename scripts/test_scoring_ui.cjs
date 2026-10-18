/* Render regression checks without a browser or network. Uses the existing
 * TypeScript compiler to load the two client components in Node. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(this, request.startsWith('@/')
    ? path.join(root, 'src', request.slice(2)) : request, ...args)
}
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(
    fs.readFileSync(filename, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true, target: ts.ScriptTarget.ES2020 } },
  ).outputText, filename)
}
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'ui-test-dummy'
const { LeaderboardTable } = require('../src/app/games/[id]/components/LeaderboardTable.tsx')
const { ScorecardEditor } = require('../src/components/match/ScorecardEditor.tsx')
const html = renderToStaticMarkup(React.createElement(LeaderboardTable, {
  scoringCardsCount: 2,
  leaderboard: [
    { user_id: 'partial', player_name: 'Partial', position: null, total_score: 90, rounds_counted: 1, rounds_played: 1 },
    { user_id: 'qualified', player_name: 'Qualified', position: 1, total_score: 150, rounds_counted: 2, rounds_played: 2 },
  ],
}))
assert.ok(html.indexOf('Qualified') < html.indexOf('Partial'), 'qualified row must appear first')
const partialRow = html.match(/<tr[^>]*>(?:(?!<\/tr>).)*Partial(?:(?!<\/tr>).)*<\/tr>/s)?.[0]
assert.ok(partialRow, 'provisional player must remain visible')
assert.ok(partialRow.includes('Provisional'), 'provisional position must be announced')
assert.ok(!partialRow.includes('aria-label="Position 2"'), 'never invent a rank from array order')
assert.ok(!partialRow.includes('ahead'), 'never compare partial and qualified totals')
console.log('PASS: provisional leaderboard rendering')

const originalState = React.useState
function renderCard(holes, entered) {
  let state = 0
  React.useState = (initial) => {
    const index = state++
    const card = { success: true, match_id: 'fixture', match_status: 'scheduled',
      course_name: 'Test', course: null, editable: true,
      players: [{ user_id: 'solo', display_name: 'Solo', avatar_url: null,
        score_status: 'pending', total: null, declared_holes: holes, thru: entered.length,
        holes: entered.map(n => ({ n, strokes: 4 })) }] }
    return [index === 0 ? card : index === 2 ? { solo: Object.fromEntries(entered.map(n => [n, 4])) }
      : typeof initial === 'function' ? initial() : initial, () => {}]
  }
  try {
    return renderToStaticMarkup(React.createElement(ScorecardEditor, {
      matchId: 'fixture', onClose: () => {}, finishable: true,
    }))
  } finally { React.useState = originalState }
}
function finishDisabled(html) {
  const button = html.match(/<button([^>]*)>(?:(?!<\/button>).)*?Finish round/s)
  assert.ok(button, 'finish control must exist')
  return /\sdisabled(?:=|\s|$)/.test(button[1])
}
assert.equal(finishDisabled(renderCard(9, [1])), true)
assert.equal(finishDisabled(renderCard(9, [1, 2, 3, 4, 5, 6, 7, 8])), true)
assert.equal(finishDisabled(renderCard(9, [1, 2, 3, 4, 5, 6, 7, 8, 9])), false)
assert.equal(finishDisabled(renderCard(18, Array.from({ length: 17 }, (_, i) => i + 1))), true)
assert.equal(finishDisabled(renderCard(18, Array.from({ length: 18 }, (_, i) => i + 1))), false)
console.log('PASS: finish controls require complete 9/18-hole cards')

const { PersonalRoundEditor } = require('../src/components/personal/PersonalRoundEditor.tsx')
const { PersonalLeaguePanel } = require('../src/components/personal/PersonalLeaguePanel.tsx')
const { cardIsComplete } = require('../src/lib/personalRounds.ts')
const holeSet = Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, completion: 'completed', strokes: 5 }))
assert.equal(cardIsComplete(holeSet, 9), true)
assert.equal(cardIsComplete(holeSet.slice(0, 8), 9), false)
assert.equal(cardIsComplete([...holeSet.slice(0, 8), holeSet[0]], 9), false)
assert.equal(cardIsComplete([{ ...holeSet[0], strokes: 1.5 }, ...holeSet.slice(1)], 9), false)
assert.equal(cardIsComplete([{ ...holeSet[0], completion: 'picked_up', strokes: null }, ...holeSet.slice(1)], 9), true)
const cardFixture = {
 server_now: '2026-10-13T10:00:00Z', is_owner: true, revisions: [], events: [], validators: [],
 round: { id: 'personal', tee_id: 'tee', played_on: '2026-10-13', status: 'validated', draft_version: 1, handicap_index: 18, handicap_source: 'declared_official', course_timezone: 'Europe/Paris', entry_deadline_at: '2026-10-14T22:00:00Z', validated_at: '2026-10-13T10:00:00Z', validation_method: 'self' },
 tee: { id: 'tee', name: 'Yellow', course_name: 'Fixture Nine', layout_name: 'Nine', hole_count: 9, ready: true, course_rating: 36, slope_rating: 113 },
 reference_holes: holeSet.map(h => ({ hole_number: h.hole_number, par: 4, stroke_index: h.hole_number })),
 holes: holeSet,
 revision: { id: 'revision', revision_number: 1, scores: holeSet, gross_total: 45, net_total: 36, stableford_points: 18, differential: 18, playing_handicap: 9 },
 level: { value: 18, status: 'provisional', cards_count: 1, cards_used: 1, revision_ids: ['revision'] },
 leagues: ['one', 'two'].map(id => ({ id, name: `League ${id}`, reason: null, attestation: 'self_declared', format: 'stroke_net', submission_status: null, submission_id: null })),
}
function renderPersonalCard(card) {
 return renderToStaticMarkup(React.createElement(PersonalRoundEditor, { data: card, onReload: async () => {} }))
}
const firstDraftHtml = renderPersonalCard({ ...cardFixture, revision: null, leagues: [], round: { ...cardFixture.round, status: 'draft', validator_id: null } })
assert.ok(firstDraftHtml.includes('/games/create?tee=tee') && firstDraftHtml.includes('Create a league'), 'first draft must reach the shared league creator before permanently locking scores')
const personalHtml = renderPersonalCard(cardFixture)
assert.equal((personalHtml.match(/type="checkbox"/g) || []).length, 2, 'one revision must be selectable for both leagues')
assert.ok(personalHtml.includes('Select all'), 'batch selection must be visible')
assert.ok(personalHtml.includes('Nine-hole differential doubled'), 'nine-hole estimate must be explained')
const unverifiedHtml = renderPersonalCard({ ...cardFixture, round: { ...cardFixture.round, status: 'draft' }, tee: { ...cardFixture.tee, ready: false } })
const confirmButton = unverifiedHtml.match(/<button([^>]*)>Review my card<\/button>/)
assert.ok(confirmButton && /\sdisabled(?:=|\s|$)/.test(confirmButton[1]), 'unverified ratings must prevent confirmation')
assert.ok(unverifiedHtml.includes('verified rating, slope'), 'missing reference data must be explained')
assert.ok(!personalHtml.includes('>Confirm card</button>'), 'validated card must have no confirm/edit workflow')
const reviewHtml = renderPersonalCard({ ...cardFixture, is_owner: false, round: { ...cardFixture.round, status: 'pending_validation', auto_validation_at: '2026-10-16T10:00:00Z' } })
assert.ok(reviewHtml.includes('>Index</th>') && !reviewHtml.includes('Par / SI') && !reviewHtml.includes('type="number"'), 'validator starts with a read-only score table using Index');
assert.ok(reviewHtml.includes('Correct a score') && reviewHtml.includes('Validate these scores') && !reviewHtml.includes('<textarea'), 'validator gets deliberate correction and approval actions')
assert.ok(!reviewHtml.includes('Submit this revision'), 'validator cannot submit owner card')
const disputeHtml = renderPersonalCard({ ...cardFixture, round: { ...cardFixture.round, status: 'disputed' } })
assert.ok(disputeHtml.toLowerCase().includes('permanently excluded') && !disputeHtml.includes('Submit this revision'), 'disputed cards cannot be reused')
const leagueFixture = {
 closure_status: 'closed_provisional',
 rules: { tee_id: 'tee', format: 'stroke_net', attestation: 'peer_required' },
 game: { id: 'one', name: 'League one', start_date: '2026-10-01', end_date: '2026-11-01', scoring_cards_count: 1, invite_code: 'TESTCODE', status: 'active' },
 tee: { name: 'Yellow', course_name: 'Fixture Nine', hole_count: 9 }, board: [],
 submissions: [{ id: 'submission', round_id: 'personal', user_id: 'owner', player_name: 'Owner', played_on: '2026-10-13', status: 'pending', card_status: 'pending_validation', validator_id: 'witness', reason: null, revision_number: 1, gross_total: 45, net_total: 36, stableford_points: 18, scores: holeSet }],
}
const ownLeague = renderToStaticMarkup(React.createElement(PersonalLeaguePanel, { initial: leagueFixture, userId: 'owner' }))
assert.ok(!ownLeague.includes('>Attest card</button>'), 'owner must never get a self-attestation control')
const witnessLeague = renderToStaticMarkup(React.createElement(PersonalLeaguePanel, { initial: leagueFixture, userId: 'witness' }))
assert.ok(witnessLeague.includes('Review card'), 'designated validator can review the shared revision')
const unrelatedMember = renderToStaticMarkup(React.createElement(PersonalLeaguePanel, { initial: leagueFixture, userId: 'another-member' }))
assert.ok(!unrelatedMember.includes('Review card'), 'other members cannot act as validator')
assert.ok(!witnessLeague.includes('Open my card'), 'witness must not link into the private round editor')
console.log('PASS: personal card, sharing, rating gate and witness UI')

const { normalizeInviteCode, isInviteCode } = require('../src/lib/inviteCodes.ts')
assert.equal(normalizeInviteCode(' abc123 '), 'ABC123')
assert.equal(normalizeInviteCode(' 8vpbv1437d '), '8VPBV1437D', 'current invite links must not truncate the code')
assert.equal(isInviteCode(normalizeInviteCode('abc123')), true)
assert.equal(isInviteCode(normalizeInviteCode('8vpbv1437d')), true)
assert.equal(isInviteCode('8VPBV143'), false)
assert.equal(isInviteCode('ABC12!'), false)
console.log('PASS: six-character and ten-character invitation codes')

// Compact score views still expose every hole and never unlock a submitted card.
for (const course_name of ['Golf de Rueil-Malmaison', 'Golf du Haras de Jardy']) {
 for (const count of [9,18]) {
  const scores = Array.from({length:count},(_,i)=>({hole_number:i+1,completion:i===count-1?'picked_up':'completed',strokes:i===count-1?null:5}));
  const fixture = {...cardFixture,tee:{...cardFixture.tee,course_name,hole_count:count},holes:scores,reference_holes:scores.map(h=>({hole_number:h.hole_number,par:4,stroke_index:h.hole_number})),revision:{...cardFixture.revision,scores}};
  const locked = renderPersonalCard(fixture);
  assert.ok(locked.includes('>Index</th>') && !locked.includes('>SI</th>'), 'locked score grid uses Index');
  assert.equal((locked.match(/scope="row"/g)||[]).length,count,`${course_name}: all ${count} scores visible`);
  assert.ok(locked.includes('Picked up'), 'picked-up score remains readable');
  assert.ok(!locked.includes('type="number"')&&!locked.includes('<select'), 'locked cards expose no score controls');
  const draft=renderPersonalCard({...fixture,revision:null,round:{...fixture.round,status:'draft'}});
  assert.ok(draft.includes('Par /<br/>Index') && !draft.includes('Par / SI'), 'draft score grid uses Index');
  assert.equal((draft.match(/type="number"/g)||[]).length,count,'draft exposes direct score input for each hole');
  assert.ok(cardIsComplete(scores,count),'picked-up holes count toward completeness');
  assert.equal(cardIsComplete([...scores.slice(0,-1),{...scores.at(-1),completion:'not_played'}],count),false,'unplayed final hole cannot be confirmed');
 }
}
console.log('PASS: Rueil / Jardy 9 / 18 score grids, read-only cards and completeness');
