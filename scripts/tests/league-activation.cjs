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

function invitationControls({ clipboardFails = false, share } = {}) {
  const events = [], copied = [], feedback = [];
  let prepared = 0;
  const filename = path.join(__dirname, '../../src/app/games/[id]/components/GameInviteCode.tsx');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const context = {
    exports: {},
    window: { location: { origin: 'https://app.mulliganclub.co' } },
    navigator: { clipboard: { writeText: async text => {
      if (clipboardFails) throw new Error('Clipboard unavailable');
      copied.push(text);
    } }, ...(share ? { share } : {}) },
    require: name => {
      if (name === 'react') return { useEffect: () => {}, useState: value => [value, value => feedback.push(value)] };
      if (name === '@/lib/i18n') return { useT: () => key => key };
      if (name === '@/lib/analytics') return { track: (...event) => events.push(event) };
      if (name === '@/components/LeaguePlayerInvite') return { LeaguePlayerInvite: () => null };
      return require(name);
    },
  };
  vm.runInNewContext(source, context);
  const tree = context.exports.GameInviteCode({ gameId: 'league', gameName: 'Friends', inviteCode: 'ABC1234567', variant: 'bottom', onInvitePrepared: () => prepared++ });
  function find(node, label) {
    if (!node || typeof node !== 'object') return null;
    if (node.props?.['aria-label'] === label) return node;
    for (const child of [node.props?.children].flat()) { const found = find(child, label); if (found) return found; }
    return null;
  }
  return { copied, events, feedback, prepared: () => prepared, click: label => find(tree, label).props.onClick() };
}
test('copy invitation gives friends an actionable join URL and records preparation only after copying', async () => {
  const controls = invitationControls();
  await controls.click('invite.share.copyLink');
  assert.deepEqual(controls.copied, ['https://app.mulliganclub.co/join/ABC1234567']);
  assert.equal(controls.prepared(), 1);
  assert.equal(controls.events[0][0], 'invite_shared');
  assert.equal(controls.events[0][1].method, 'link');
  assert.equal(controls.events[0][1].league_id, 'league');
});
test('clipboard failure does not claim that an invitation was prepared', async () => {
  const controls = invitationControls({ clipboardFails: true });
  await controls.click('invite.share.copyLink');
  assert.equal(controls.prepared(), 0);
  assert.equal(controls.events.length, 0);
  assert.deepEqual(controls.feedback, ['invite.share.failed']);
});
test('cancelling native sharing does not claim that an invitation was prepared', async () => {
  const controls = invitationControls({ share: async () => { throw new Error('User cancelled'); } });
  await controls.click('invite.share.cta');
  assert.equal(controls.prepared(), 0);
  assert.equal(controls.events.length, 0);
});

const {leagueHasEnded,nextLeagueDefaults,leagueWinners,sourceLeagueId,todayInLeague,inviteReturningFriends}=load('nextLeague.ts');
function completedLeague(overrides={}) { return { closure_status:'finalized', game:{name:'Friends Cup',end_date:'2026-10-17',scoring_cards_count:3}, rules:{tee_id:'tee',duration_months:2,format:'stroke_net',attestation:'peer_required'}, board:[{user_id:'a',position:1,rounds_counted:3},{user_id:'b',position:2,rounds_counted:3}],...overrides }; }
test('ended seasons preserve editable course and rules, and reset to a current start date',()=>{
  const source=completedLeague();const d=nextLeagueDefaults(source,'2026-10-18');
  assert.equal(d.name,'Friends Cup');assert.equal(d.tee,'tee');assert.equal(d.start,'2026-10-18');assert.equal(d.months,2);assert.equal(d.format,'stroke_net');assert.equal(d.cards,3);assert.equal(d.witness,true);
  assert.equal(source.game.end_date,'2026-10-17');
  assert.equal(nextLeagueDefaults(source,'2026-11-02').start,'2026-11-02');
});
test('historical duration falls back to one month and live leagues cannot be reused',()=>{
  const source=completedLeague();source.rules.duration_months=null;source.rules.attestation='self_declared';
  assert.equal(nextLeagueDefaults(source,'2026-10-18').months,1);assert.equal(nextLeagueDefaults(source,'2026-10-18').witness,false);
  for(const closure_status of ['open','upcoming','unknown']){assert.equal(leagueHasEnded({...source,closure_status}),false);assert.equal(nextLeagueDefaults({...source,closure_status},'2026-10-18'),null);}
  assert.equal(leagueHasEnded({...source,closure_status:'closed_provisional'}),true);
});
test('final winners respect ties and qualification; provisional standings never crown anyone',()=>{
  const source=completedLeague();assert.equal(leagueWinners(source).length,1);
  source.board[1].position=1;assert.equal(leagueWinners(source).length,2);
  source.board[0].rounds_counted=2;assert.equal(leagueWinners(source).length,1);
  source.board[1].rounds_counted=0;assert.equal(leagueWinners(source).length,0);
  assert.equal(leagueWinners(completedLeague({closure_status:'closed_provisional'})).length,0);
});
test('repeat source accepts only UUIDs and course-local dates handle midnight boundaries',()=>{
  assert.equal(sourceLeagueId('10bfef1f-7ada-496c-95e9-efa579b063c9'),'10bfef1f-7ada-496c-95e9-efa579b063c9');
  for(const invalid of [null,undefined,'','https://evil.example','../game','<script>'])assert.equal(sourceLeagueId(invalid),null);
  assert.equal(todayInLeague('Europe/Paris',new Date('2026-10-17T22:30:00Z')),'2026-10-18');
});
test('invitations keep partial success, accept server duplicates and permit failed-only retries',async()=>{
  const calls=[];const friends=['a','b','c','d'].map(id=>({id,username:id}));
  const result=await inviteReturningFriends(friends,async username=>{calls.push(username);if(username==='b')throw new Error('network');return username==='c'?{duplicate:true}:username==='d'?{}:{sent:true};});
  assert.equal(Array.from(result.successes).join(','),'a,c');assert.equal(Array.from(result.failures).join(','),'b,d');assert.equal(calls.join(','),'a,b,c,d');
  const retry=await inviteReturningFriends(friends.filter(f=>result.failures.includes(f.id)),async()=>({duplicate:true}));
  assert.equal(retry.successes.length,2);assert.equal(retry.failures.length,0);
});
