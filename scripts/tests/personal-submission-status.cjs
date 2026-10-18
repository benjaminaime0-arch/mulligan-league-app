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
    if (name.startsWith('./')) {
      const relative = path.relative(root, path.resolve(path.dirname(filename), name));
      return load(fs.existsSync(path.join(root, `${relative}.tsx`)) ? `${relative}.tsx` : `${relative}.ts`);
    }
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

const { ScoreSummary } = load('src/components/personal/ScoreSummary.tsx');
for (const language of ['fr','en']) {
  test(`${language}: detail score summary preserves missing totals, zero and negative differentials`, () => {
    locale = language;
    const html = renderToStaticMarkup(React.createElement(ScoreSummary, { gross:null, net:0, stableford:0, differential:-1.2 }));
    assert.deepEqual(metrics(html), ['personal.gross','personal.net','personal.stableford','personal.differential'].map((key,i)=>[dictionary[language][key],['—','0','0',new Intl.NumberFormat(language).format(-1.2)][i]]));
  });
  test(`${language}: league score summary does not invent a differential`, () => {
    locale = language;
    const html=renderToStaticMarkup(React.createElement(ScoreSummary, {gross:90,net:66,stableford:30}));
    assert.equal(metrics(html).length,3);
    assert.ok(!html.includes(dictionary[language]['personal.differential']));
  });
}

test('a new member still gets a personal first-card action when friends already have counted cards',()=>{
 locale='fr';const id='e885da51-9aa9-4b7a-a421-28c2854ff5f8';
 const initial={game:{id,name:'Friends',start_date:'2026-10-18',end_date:'2026-11-17',scoring_cards_count:1},tee:{course_name:'QA',hole_count:9,name:'Yellow'},rules:{tee_id:'tee',format:'stroke_gross'},closure_status:'open',board:[{user_id:'owner',rounds_counted:1,player_name:'Owner'},{user_id:'friend',rounds_counted:0,player_name:'Friend'}],submissions:[]};
 const html=renderToStaticMarkup(React.createElement(PersonalLeaguePanel,{initial,userId:'friend'}));
 assert.ok(html.includes('Ajouter ma première carte'));
 assert.ok(html.includes(`/rounds?tee=tee&amp;league=${id}`));
 assert.ok(!html.includes(dictionary.fr['activation.launched']));
 assert.ok(!html.includes('league-launch-title'));
});

const { countedLeagueCards, leagueCardContribution } = load('src/lib/personalStandings.ts');
const { PersonalCardStandings } = load('src/components/personal/PersonalCardStandings.tsx');
const { PersonalStandings } = load('src/components/personal/PersonalStandings.tsx');
function standingsFixture(format = 'stroke_gross', n = 1) {
  const submission = (id, gross, net, points, extras = {}) => ({ id, round_id: id, user_id: 'owner', player_name: 'QA', played_on: '2026-10-18', status: 'accepted', card_status: 'validated', revision_number: 1, scores: [], gross_total: gross, net_total: net, stableford_points: points, ...extras });
  const submissions = [submission('b', 91, 65, 35), submission('a', 90, 66, 36), submission('old', 70, 40, 50, { round_id: 'b', status: 'superseded' }), submission('pending', 60, 30, 60, { status: 'pending', card_status: 'pending_validation' }), submission('refused', 60, 30, 60, { status: 'rejected', card_status: 'disputed' })];
  const values = format === 'stroke_gross' ? [90, 91] : format === 'stroke_net' ? [65, 66] : [36, 35];
  return { rules: { format }, game: { id: 'league', scoring_cards_count: n }, board: [{ user_id: 'owner', player_name: 'QA', rounds_played: 2, rounds_counted: Math.min(n, 2), total_score: values.slice(0,n).reduce((a,b)=>a+b,0), position: n > 2 ? null : 1 }], submissions };
}
for (const format of ['stroke_gross', 'stroke_net', 'stableford_net']) {
  test(`${format}: best-N contribution agrees with board; pending, refused and replaced excluded`, () => {
    const data = standingsFixture(format);
    const counted = countedLeagueCards(data);
    assert.deepEqual([...counted], [format === 'stroke_net' ? 'b' : 'a']);
    assert.equal(leagueCardContribution(data, data.submissions.find(s => s.id === (format === 'stroke_net' ? 'a' : 'b')), counted), 'reserve');
    assert.equal(leagueCardContribution(data, data.submissions[2], counted), 'excluded');
    assert.equal(leagueCardContribution(data, data.submissions[3], counted), 'pending');
    assert.equal(leagueCardContribution(data, data.submissions[4], counted), 'excluded');
    assert.equal(countedLeagueCards(standingsFixture(format, 2)).size, 2);
    assert.equal(countedLeagueCards(standingsFixture(format, 3)).size, 2);
  });
}
test('attribution fails closed when server board or eligible revisions disagree', () => {
  for (const change of [data => data.board[0].total_score++, data => data.board[0].rounds_played++, data => data.submissions[0].gross_total = null, data => data.submissions[0].round_id = 'a', data => data.rules.format = 'unknown']) {
    const data = standingsFixture(); change(data);
    const counted = countedLeagueCards(data);
    assert.equal(counted.size, 0);
    assert.equal(leagueCardContribution(data, data.submissions[1], counted), 'accepted');
  }
});
test('equal scores select oldest date, then submission UUID, regardless of response order', () => {
  const data = standingsFixture(); data.submissions[0].gross_total = 90; data.board[0].total_score = 90;
  assert.deepEqual([...countedLeagueCards(data)], ['a']);
  data.submissions[0].played_on = '2026-10-17';
  assert.deepEqual([...countedLeagueCards(data)], ['b']);
  assert.equal(data.submissions[0].id, 'b', 'original array order retained');
});
for (const language of ['fr','en']) {
  test(`${language}: validated owner has a direct top-of-card standings link; pending and validator views do not`, () => {
    locale = language;
    const data = { is_owner: true, round: { status: 'validated' }, leagues: [{ id: 'league', name: 'Friends', submission_status: 'accepted' }, { id: 'waiting', name: 'Pending', submission_status: 'pending' }] };
    const html = renderToStaticMarkup(React.createElement(PersonalCardStandings, { data }));
    assert.ok(html.includes('/games/league#league-standings'));
    assert.ok(!html.includes('/games/waiting'));
    assert.ok(html.includes(dictionary[language]['standings.cardHint']));
    assert.equal(renderToStaticMarkup(React.createElement(PersonalCardStandings, { data: { ...data, is_owner: false } })), '');
    assert.equal(renderToStaticMarkup(React.createElement(PersonalCardStandings, { data: { ...data, round: { status: 'pending_validation' } } })), '');
  });
  test(`${language}: mobile standings expose scoring direction, counted total, qualification and card links`, () => {
    locale = language;
    for (const format of ['stroke_gross','stroke_net','stableford_net']) {
      const data = standingsFixture(format, 3);
      const html = renderToStaticMarkup(React.createElement(PersonalStandings, { data, userId: 'owner' }));
      assert.ok(html.includes(dictionary[language][format === 'stableford_net' ? 'standings.higher' : 'standings.lower']));
      assert.ok(html.includes(dictionary[language]['standings.fraction']));
      assert.ok(html.includes('2/3'));
      assert.ok(html.includes('/rounds/a') && html.includes('/rounds/b'));
      assert.ok(!html.includes('/rounds/old'));
    }
  });
}

const { PersonalSeasonEnd } = load('src/components/personal/PersonalSeasonEnd.tsx');
for(const language of ['fr','en']){
  test(`${language}: ended league replaces add-card/invitation dead ends with next-league and final outcome`,()=>{
    locale=language;const data=standingsFixture();data.game.name='Friends';data.game.start_date='2026-09-18';data.game.end_date='2026-10-17';data.tee={course_name:'QA course',hole_count:9,name:'Yellow'};data.closure_status='finalized';
    let html=renderToStaticMarkup(React.createElement(PersonalLeaguePanel,{initial:data,userId:'owner'}));
    assert.ok(html.includes('/games/create?from=league'));assert.ok(html.includes(dictionary[language]['season.next']));
    assert.ok(html.includes(dictionary[language]['season.final']));assert.ok(!html.includes(dictionary[language]['personal.addOrSubmit']));
    assert.ok(!html.includes('id="league-invitation"'));assert.ok(!html.includes(dictionary[language]['standings.replacement']));
    assert.ok(html.includes(dictionary[language]['season.winner'].replace('{name}','QA')));
    data.closure_status='closed_provisional';html=renderToStaticMarkup(React.createElement(PersonalSeasonEnd,{data}));
    assert.ok(html.includes(dictionary[language]['season.provisional']));assert.ok(!html.includes(dictionary[language]['season.winner'].replace('{name}','QA')));assert.ok(html.includes('#league-cards'));
  });
}
