const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
function load(relative) {
  let filename = path.join(root, relative);
  if (!path.extname(filename)) filename += fs.existsSync(filename + '.tsx') ? '.tsx' : '.ts';
  if (cache.has(filename)) return cache.get(filename);
  const m = new Module(filename, module); m.paths = module.paths;
  m.require = name => {
    if (name === '@/lib/supabase') return {supabase:{}};
    if (name === 'next/link') return ({children,...props}) => React.createElement('a',props,children);
    if (name === '@/components/Avatar') return {Avatar:({fallback}) => React.createElement('span',null,fallback)};
    if (name === '@/lib/i18n') return {useI18n:()=>({locale:'fr',t:(key,vars={})=>{
      const text=load('src/lib/i18n/dictionaries').fr[key]; assert.ok(text,key);
      return text.replace(/\{(\w+)\}/g,(_,k)=>String(vars[k]??`{${k}}`));
    }})};
    if (name.startsWith('@/')) return load('src/'+name.slice(2));
    if (name.startsWith('./')) return load(path.relative(root,path.resolve(path.dirname(filename),name)));
    return require(name);
  };
  m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
  cache.set(filename,m.exports); return m.exports;
}
const {leagueDays,leagueSection,featuredLeagues}=load('src/lib/leaguePresentation');
const {LeagueCard}=load('src/components/home/LeagueCard');
const {formatRelativeTime}=load('src/lib/notificationDisplay');
const {NotificationItem}=load('src/components/NotificationItem');
const {normalizeInviteCode,isInviteCode}=load('src/lib/inviteCodes');
test('notification times follow the selected language and tolerate future or invalid timestamps',()=>{
  const now=Date.parse('2026-10-15T12:00:00Z');
  assert.equal(formatRelativeTime('2026-10-15T11:55:00Z','fr',now).replace(/\s/g,' '),'il y a 5 min');
  assert.equal(formatRelativeTime('2026-10-14T12:00:00Z','fr',now),'hier');
  assert.equal(formatRelativeTime('2026-10-15T12:01:00Z','fr',now),'maintenant');
  assert.equal(formatRelativeTime('invalid','fr',now),'—');
  assert.equal(formatRelativeTime('2026-10-15T11:55:00Z','en',now),'5 min. ago');
});
test('joining accepts legacy and current codes without changing their normalized content',()=>{
  for(const code of [' ab12cd ',' abc1234567 ']) assert.ok(isInviteCode(normalizeInviteCode(code)));
  for(const code of ['ABC12','ABC1234','ABC123456!']) assert.equal(isInviteCode(code),false);
});
const notice={id:'n',type:'personal_card',title:'Card <one>',body:'Review & confirm',data:{round_id:'r'},read_at:null,created_at:'2026-10-15T12:00:00Z'};
function noticeHtml(n){return renderToStaticMarkup(React.createElement(NotificationItem,{notification:n,onTap:()=>{}}));}
test('the shared inbox item escapes content and exposes unread state and its real timestamp',()=>{
  const html=noticeHtml(notice);
  assert.ok(html.includes('Card &lt;one&gt;')&&html.includes('Review &amp; confirm'));
  assert.ok(html.includes('Non lues')&&html.includes('dateTime="2026-10-15T12:00:00Z"'));
  assert.ok(!html.includes('disabled=""'));
});
test('notification rows keep rejected destinations disabled while supporting player links and pending requests',()=>{
  assert.ok(noticeHtml({...notice,type:'join_rejected',data:{game_id:'private'}}).includes('disabled=""'));
  assert.ok(!noticeHtml({...notice,type:'member_joined',data:{new_member_id:'player'},read_at:'2026-10-15T12:01:00Z'}).includes('disabled=""'));
  assert.ok(noticeHtml({...notice,type:'join_request',data:{request_id:'request'}}).includes('Appuyez pour approuver ou refuser'));
});
test('league dates use the course calendar across midnight and DST, with no fractional-day drift',()=>{
  for(const [date,now,expected] of [
    ['2026-10-25','2026-10-24T22:30:00Z',0],['2026-10-26','2026-10-25T01:30:00Z',1],
    ['2026-03-30','2026-03-29T00:30:00Z',1],['2026-11-12','2026-11-12T22:59:00Z',0],
    ['2026-11-12','2026-11-12T23:00:00Z',-1]
  ]) assert.equal(leagueDays(date,'Europe/Paris',new Date(now)),expected);
  assert.equal(leagueDays('2026-10-15','America/Los_Angeles',new Date('2026-10-15T01:00:00Z')),1);
});
test('missing or invalid league dates and timezones do not invent a countdown',()=>{
  for(const date of [null,'','invalid','2026-02-30']) assert.equal(leagueDays(date),null);
  assert.equal(leagueDays('2026-10-15','not/a/timezone'),null);
});
test('authoritative personal closure wins over legacy game status',()=>{
  for(const [state,expected] of [['upcoming','upcoming'],['active','active'],['closed_provisional','completed'],['finalized','completed']]) assert.equal(leagueSection({status:'active'},{lifecycle_state:state}),expected);
  assert.equal(leagueSection({status:'completed'}),'completed');
});
test('home selects a live league before upcoming or completed and preserves the input',()=>{
  const games=[{name:'Closed',section:'completed'},{name:'Soon',section:'upcoming'},{name:'Later',section:'active',end_date:'2026-12-15'},{name:'First',section:'active',end_date:'2026-11-15'}];
  assert.deepEqual(featuredLeagues(games).map(g=>g.name),['First','Later','Soon','Closed']);
  assert.equal(games[0].name,'Closed');
});
const base={id:'league',name:'Friends',course_name:'Rueil',status:'active',section:'active',members:[{user_id:'real',profiles:{username:'Alice',avatar_url:null}}],memberCount:1,standing:{position:1,roundsCounted:1}};
function render(game){return renderToStaticMarkup(React.createElement(LeagueCard,{game,preview:true}));}
test('unranked and empty league standings never display an invented first place',()=>{
  for(const standing of [{position:1,roundsCounted:0},{position:null,roundsCounted:1},{position:null,roundsCounted:null}]) {
    const html=render({...base,standing}); assert.ok(html.includes('Non classé')); assert.ok(!html.includes('/ 1'));
  }
});
test('a populated league links to its real detail and uses only actual roster names',()=>{
  const html=render(base); assert.ok(html.includes('href="/games/league"')); assert.ok(html.includes('Alice')); assert.ok(html.includes('1 joueur')); assert.ok(!html.includes('Non classé'));
});
test('top-three preview preserves server rank and score rather than array positions',()=>{
  const html=render({...base,standing:{...base.standing,leaders:[{userId:'tied',name:'Tied player',position:2,total:144}]}});
  assert.ok(html.includes('Tied player')); assert.ok(/>2<\/span>/.test(html)); assert.ok(/>144<\/span>/.test(html));
});

test('known scorecard notifications use French copy while unknown messages retain their source text',()=>{
 const base={id:'qa',type:'personal_card',title:'Card awaiting your validation',body:'Review the card or propose a correction within 72 hours.',data:{round_id:'card'},read_at:null,created_at:'2026-10-18T10:00:00Z'};
 const html=renderToStaticMarkup(React.createElement(NotificationItem,{notification:base,onTap(){}}));
 assert.ok(html.includes('Une carte à valider'));assert.ok(html.includes('sous 72 heures'));assert.ok(!html.includes('Card awaiting your validation'));
 const fallback=renderToStaticMarkup(React.createElement(NotificationItem,{notification:{...base,title:'New future event',body:'Original message'},onTap(){}}));
 assert.ok(fallback.includes('New future event'));assert.ok(fallback.includes('Original message'));
});
