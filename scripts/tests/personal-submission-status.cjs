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
    if (name === '@/lib/i18n') {
      const t = (key, vars = {}) => {
        const text = load('src/lib/i18n/dictionaries.ts').dictionaries[locale][key];
        assert.ok(text, `Missing ${locale} translation: ${key}`);
        return text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
      };
      return { useT: () => t, useI18n: () => ({ t, locale }) };
    }
    // These unrelated children/services do not participate in status rendering.
    if (name === '@/lib/supabase') return { supabase: {} };
    if (name === 'next/link') return ({ children, ...props }) => React.createElement('a', props, children);
    if (name.endsWith('/LeaderboardTable')) return { LeaderboardTable: () => null };
    if (name.endsWith('/GameInviteCode')) return { GameInviteCode: () => null };
    if (name.startsWith('@/')) {
      const relative = `src/${name.slice(2)}`;
      return load(fs.existsSync(path.join(root, `${relative}.tsx`)) ? `${relative}.tsx` : `${relative}.ts`);
    }
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
const { RoundList } = load('src/components/personal/RoundList.tsx');
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
          assert.ok(editor.includes('>Index</th>'), 'locked/review card uses the hole Index label');
          assert.ok(!/>SI<|Par \/ SI/.test(editor), 'SI is never a visible hole label');
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

// Authoritative pilot results: list values must remain identical to card details.
const pilotResults = [
  ['Golf de Rueil-Malmaison', 9, 45, 22, 28, 31.7],
  ['Golf de Rueil-Malmaison', 18, 90, 44, 56, 31.8],
  ['Golf du Haras de Jardy', 9, 45, 23, 25, 36.9],
  ['Golf du Haras de Jardy', 18, 90, 66, 30, 36.9],
];
function summary([course_name, hole_count, gross_total, net_total, stableford_points, differential]) {
  return { id: 'pilot-card', played_on: '2026-10-13', status: 'validated', course_name, hole_count,
    tee_name: 'Jaunes — Messieurs', gross_total, net_total, stableford_points, differential };
}
function renderList(round) {
  return renderToStaticMarkup(React.createElement(RoundList, { rounds: [round] }));
}
function metrics(html) {
  return [...html.matchAll(/<dt[^>]*>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map(([, label, value]) => [label, value]);
}
for (const language of ['fr', 'en']) {
  for (const result of pilotResults) {
    test(`${language}: ${result[0]} ${result[1]} holes, card list scores and differential`, () => {
      locale = language;
      const html = renderList(summary(result));
      assert.deepEqual(metrics(html), ['personal.gross', 'personal.net', 'personal.stableford', 'personal.differential']
        .map((key, i) => [dictionary[language][key], new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(result[i + 2])]));
      assert.ok(html.includes('href="/rounds/pilot-card"'), 'summary still opens its card');
      assert.ok(html.includes(dictionary[language]['personal.status.validated']));
    });
  }
  test(`${language}: zero scores and negative differential remain visible`, () => {
    locale = language;
    assert.deepEqual(metrics(renderList(summary(['Zero', 9, 0, 0, 0, -1.2]))).map(([, value]) => value),
      ['0', '0', '0', new Intl.NumberFormat(language).format(-1.2)]);
  });
  test(`${language}: a picked-up hole has no invented gross/net totals`, () => {
    locale = language;
    assert.deepEqual(metrics(renderList(summary(['Picked up', 18, null, null, 0, 36.9]))).map(([, value]) => value),
      ['—', '—', '0', new Intl.NumberFormat(language).format(36.9)]);
  });
  test(`${language}: an uncalculated draft shows status without fabricated results`, () => {
    locale = language;
    const html = renderList({ ...summary(['Draft', 9, null, null, null, null]), status: 'draft' });
    assert.deepEqual(metrics(html), []);
    assert.ok(html.includes(dictionary[language]['personal.status.draft']));
  });
  test(`${language}: a disputed result retains its exclusion status`, () => {
    locale = language;
    const html = renderList({ ...summary(pilotResults[0]), status: 'disputed' });
    assert.equal(metrics(html).length, 4);
    assert.ok(html.includes(dictionary[language]['personal.status.disputed']));
  });
}
