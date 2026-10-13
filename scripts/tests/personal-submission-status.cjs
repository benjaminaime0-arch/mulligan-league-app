const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
let locale = 'fr';
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename);
  const loaded = new Module(filename, module);
  loaded.paths = module.paths;
  loaded.require = (name) => {
    if (name === '@/lib/i18n') return { useT: () => (key, vars = {}) => {
      const text = load('src/lib/i18n/dictionaries.ts').dictionaries[locale][key];
      assert.ok(text, `Missing ${locale} translation: ${key}`);
      return text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
    }};
    // These unrelated children/services do not participate in status rendering.
    if (name === '@/lib/supabase') return { supabase: {} };
    if (name === 'next/link') return ({ children, ...props }) => React.createElement('a', props, children);
    if (name.endsWith('/LeaderboardTable')) return { LeaderboardTable: () => null };
    if (name.endsWith('/GameInviteCode')) return { GameInviteCode: () => null };
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
    if (name === './ValidationTimer') return load('src/components/personal/ValidationTimer.tsx');
    return require(name);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  cache.set(filename, loaded.exports);
  return loaded.exports;
}
const { PersonalRoundEditor } = load('src/components/personal/PersonalRoundEditor.tsx');
const { PersonalLeaguePanel } = load('src/components/personal/PersonalLeaguePanel.tsx');
const dictionary = load('src/lib/i18n/dictionaries.ts').dictionaries;
const cases = [
  ['pending_validation', 'pending', 'pending'],
  ['pending_player_confirmation', 'pending', 'awaitingPlayer'],
  ['validated', 'accepted', 'accepted'],
  ['disputed', 'rejected', 'rejected'],
  ['pending_player_confirmation', 'superseded', 'superseded'],
];
for (const language of ['fr', 'en']) {
  for (const course of ['Golf de Rueil-Malmaison', 'Golf du Haras de Jardy']) {
    for (const holes of [9, 18]) {
      for (const [cardStatus, submissionStatus, expected] of cases) {
        test(`${language}: ${course} ${holes} holes, ${cardStatus}/${submissionStatus}, two leagues`, () => {
          locale = language;
          const scores = Array.from({ length: holes }, (_, i) => ({ hole_number: i + 1, strokes: 5, completion: 'completed' }));
          const revision = { id: 'rev2', revision_number: 2, scores, gross_total: holes * 5, net_total: 40, stableford_points: 36, differential: 30 };
          const card = {
            is_owner: true, server_now: '2026-10-13T10:00:00Z',
            round: { id: 'card', played_on: '2026-10-13', status: cardStatus, draft_version: 1, handicap_index: 54, handicap_source: 'default_54', course_timezone: 'Europe/Paris', entry_deadline_at: '2026-10-14T23:59:59Z' },
            tee: { course_name: course, name: 'Jaunes — Messieurs', hole_count: holes, ready: true },
            reference_holes: scores.map(s => ({ hole_number: s.hole_number, par: 4, stroke_index: s.hole_number })),
            holes: scores, revision, revisions: [revision], events: [], validators: [],
            level: { value: null, status: 'unavailable' },
            leagues: ['A', 'B'].map(id => ({ id, name: `League ${id}`, submission_status: submissionStatus })),
          };
          const editor = renderToStaticMarkup(React.createElement(PersonalRoundEditor, { data: card, onReload: async () => {} }));
          const label = dictionary[language][`personal.submission.${expected}`];
          // Disputed cards intentionally hide the submission controls.
          assert.equal(editor.split(`<p class="mt-1 text-sm">${label}</p>`).length - 1, cardStatus === 'disputed' ? 0 : 2);
          for (const league of ['A', 'B']) {
            const data = {
              game: { id: league, name: `League ${league}`, start_date: '2026-10-13', end_date: '2026-10-23', scoring_cards_count: 1 },
              tee: card.tee, rules: { format: 'stroke_gross', attestation: 'peer_required' }, closure_status: 'open', board: [],
              submissions: [{ id: league, round_id: 'card', user_id: 'owner', player_name: 'QA', played_on: '2026-10-13', status: submissionStatus, card_status: cardStatus, revision_number: 2, scores }],
            };
            const panel = renderToStaticMarkup(React.createElement(PersonalLeaguePanel, { initial: data, userId: 'owner' }));
            assert.ok(panel.includes(label));
            if (expected === 'awaitingPlayer') {
              assert.ok(!panel.includes(dictionary[language]['personal.submission.pending']));
              assert.ok(!editor.includes(dictionary[language]['personal.submission.pending']));
            }
          }
        });
      }
    }
  }
}
