const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, globals={}) {
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/lib',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const context={exports:{},URLSearchParams,...globals}; vm.runInNewContext(code,context); return context.exports;
}
const {leagueActivation}=load('leagueActivation.ts');
test('a new league has one completed step and does not imply a friend joined',()=>{
  const p=leagueActivation(1,0,false); assert.equal(p.completed,1); assert.equal(p.friendJoined,false); assert.equal(p.activeGroup,false);
});
test('preparing an invite advances the compact checklist without claiming a join or active group',()=>{
  const p=leagueActivation(1,0,true); assert.equal(p.completed,2); assert.equal(p.friendJoined,false); assert.equal(p.activeGroup,false);
});
test('a real member join restores invitation progress on another device, without counting a card',()=>{
  const p=leagueActivation(2,0,false); assert.equal(p.completed,2); assert.equal(p.friendJoined,true); assert.equal(p.firstCard,false); assert.equal(p.activeGroup,false);
});
test('a counted solo card does not mean an active group; a group with a counted card does',()=>{
  assert.equal(leagueActivation(1,1,true).activeGroup,false);
  const p=leagueActivation(2,1,false); assert.equal(p.completed,3); assert.equal(p.activeGroup,true);
});
function analytics() {
  let consent=null;const session=new Map(),events=[];
  const window={localStorage:{getItem:()=>consent},sessionStorage:{getItem:k=>session.get(k),setItem:(k,v)=>session.set(k,v)},location:{search:'?entry=course_jardy'}};
  const api=load('analytics.ts',{window});
  return {api,window,session,events,grant:v=>consent=v,ready:()=>window.gtag=(...args)=>events.push(args)};
}
test('no consent means no events, attribution storage, or replay queue',()=>{
  const a=analytics();a.api.trackOnce('signup_viewed','signup');a.api.track('game_created');
  assert.equal(a.session.size,0);a.grant('granted');a.ready();a.api.flushAnalytics();assert.equal(a.events.length,0);
  a.api.trackOnce('signup_viewed','signup');assert.equal(a.events.length,1);
});
test('consented events survive script loading and view remounts do not inflate the funnel',()=>{
  const a=analytics();a.grant('granted');a.api.trackOnce('league_create_viewed','creator');a.api.trackOnce('league_create_viewed','creator');
  a.api.track('game_created',{league_id:'league-1'});a.ready();a.api.flushAnalytics();a.api.flushAnalytics();
  assert.equal(a.events.length,2);assert.equal(a.events[0][2].entry_point,'course_jardy');assert.equal(a.events[1][2].league_id,'league-1');
});
test('revoking consent clears pending events and storage failures fail closed',()=>{
  const a=analytics();a.grant('granted');a.api.track('invite_shared');a.grant('denied');a.ready();a.api.flushAnalytics();assert.equal(a.events.length,0);
  a.window.localStorage.getItem=()=>{throw Error('disabled')};assert.equal(a.api.track('game_created'),false);
});
test('unrecognised query values never enter attribution',()=>{
  const a=analytics();a.grant('granted');a.ready();a.window.location.search='?entry=someone@example.com';a.api.track('signup_viewed');assert.equal(a.events[0][2].entry_point,'app');
});
const {courseLeagueContent,courseLeagueSignupHref}=load('courseLeagueContent.ts');
test('local search pages have correct nine-hole pars and keep the selected course through signup',()=>{
  for(const [slug,par] of [['golf-de-rueil-malmaison-rueil-malmaison',32],['golf-du-haras-de-jardy-vaucresson',30]]){
    const c=courseLeagueContent[slug];assert.equal(c.par,par);
    const url=new URL(courseLeagueSignupHref('course-id',c.entry),'https://app.mulliganclub.co');
    assert.equal(url.searchParams.get('redirect'),'/games/create?course=course-id');assert.equal(url.searchParams.get('entry'),c.entry);assert.equal(url.searchParams.get('tab'),'signup');
  }
});
