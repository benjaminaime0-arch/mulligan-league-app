const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const cache = new Map();
const root = path.resolve(__dirname, '../..');
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename);
  const m = new Module(filename, module);
  m.paths = module.paths;
  m.require = name => {
    if (name === '@/lib/i18n') return {useT: () => (key, vars = {}) => {
      const value = load('src/lib/i18n/dictionaries.ts').dictionaries.fr[key];
      assert.ok(value, `Undefined translation: ${key}`);
      return value.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
    }};
    if (name === '@/lib/supabase') return {supabase: {}};
    if (name === 'next/link') return ({children, ...props}) => React.createElement('a', props, children);
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
    return require(name);
  };
  m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
  cache.set(filename,m.exports);
  return m.exports;
}
const {calendarLeagueEnd} = load('src/lib/leagueCalendar.ts');
const {parseOfficialIndex} = load('src/lib/officialIndex.ts');
const {PersonalInbox} = load('src/components/personal/PersonalInbox.tsx');
const {OfficialIndexEditor} = load('src/components/personal/OfficialIndexEditor.tsx');
for (const [start, months, end] of [
  ['2026-10-14',1,'2026-11-13'],['2026-10-14',2,'2026-12-13'],['2026-10-14',3,'2027-01-13'],
  ['2024-01-31',1,'2024-02-28'],['2025-01-31',1,'2025-02-27'],['2024-01-31',2,'2024-03-30'],
  ['2024-02-29',1,'2024-03-28'],['2024-02-29',2,'2024-04-28'],['2024-02-29',3,'2024-05-28'],
  ['2026-11-30',3,'2027-02-27'],['2026-12-31',2,'2027-02-27'],['2026-08-31',1,'2026-09-29'],
  ['2026-03-29',1,'2026-04-28'],['2026-10-25',1,'2026-11-24'],['2026-01-01',3,'2026-03-31'],
]) test(`calendar: ${start}, ${months} month(s) ends ${end}`, () => {
  for (const tz of ['Europe/Paris','America/Los_Angeles','Pacific/Auckland']) {
    process.env.TZ=tz;
    assert.equal(calendarLeagueEnd(start,months),end);
  }
});
test('invalid dates and durations never produce a preview', () => {
  for (const start of ['', '2025-02-29','2026-02-30','2026-13-01','not-a-date']) assert.equal(calendarLeagueEnd(start,1),null);
  for (const duration of [0,4,-1,1.5,NaN]) assert.equal(calendarLeagueEnd('2026-10-14',duration),null);
});
test('official index preserves a decimal, French commas and withdrawal', () => {
  for (const [value, expected] of [['11,4',11.4],['11.4',11.4],['0',0],['54',54],['-10',-10],['-1.2',-1.2],[' 12.0 ',12],['',null],[' ',null]]) assert.equal(parseOfficialIndex(value),expected);
  for (const value of ['54.1','-10.1','11.45','1e1','NaN','Infinity','abc','.', '1,2,3']) assert.throws(()=>parseOfficialIndex(value));
});
test('the shared official-index form displays decimals rather than an integer-only field', () => {
  const html=renderToStaticMarkup(React.createElement(OfficialIndexEditor,{value:11.4,onSaved:async()=>{}}));
  assert.ok(html.includes('value="11.4"'));
  assert.ok(html.includes('inputMode="decimal"'));
  assert.ok(html.includes('Index officiel déclaré'));
  assert.ok(html.includes('Laisser vide pour retirer l’index'));
});
test('home inbox sends each actor to the card and never assigns a correction a new timer', () => {
  const items=['pending_validation','pending_player_confirmation'].map((status,i)=>({id:`card${i}`,course_name:'Rueil',hole_count:9,played_on:'2026-10-14',player_name:'Player',status,auto_validation_at:'2026-10-17T12:00:00Z'}));
  const html=renderToStaticMarkup(React.createElement(PersonalInbox,{items}));
  assert.ok(html.includes('/rounds/card0')&&html.includes('/rounds/card1'));
  assert.equal(html.split('Validation automatique prévue').length-1,1);
  assert.ok(html.includes('En attente de confirmation de la correction'));
});
