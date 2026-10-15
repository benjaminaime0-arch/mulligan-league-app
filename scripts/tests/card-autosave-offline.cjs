const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const file = path.join(root, 'src/lib/cardDraft.ts');
const loaded = new Module(file, module);
loaded._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
const { CardDraft, draftKey, readDraft, sameHoles } = loaded.exports;
const clone = value => JSON.parse(JSON.stringify(value));
function storage() {
 const s={};
 Object.defineProperties(s,{getItem:{value:key=>s[key]??null},setItem:{value:(key,value)=>{s[key]=value}},removeItem:{value:key=>{delete s[key]}}});
 return s;
}
function fixture(course,count) {
 return {is_owner:true,server_now:'2026-10-14T09:00:00Z',round:{id:`${course}-${count}`,user_id:'owner',status:'draft',draft_version:0,entry_deadline_at:'2026-10-15T22:00:00Z'},tee:{course_name:course==='rueil'?'Golf de Rueil-Malmaison':'Golf du Haras de Jardy',hole_count:count,ready:true},
 reference_holes:Array.from({length:count},(_,i)=>({hole_number:i+1,par:4,stroke_index:i+1})),holes:Array.from({length:count},(_,i)=>({hole_number:i+1,completion:'not_played',strokes:null}))};
}
function setup(course,count) {
 const card=fixture(course,count), local=storage();
 let remote=clone(card), online=true, active=true, calls=0;
 const transport={online:()=>online,active:()=>active,load:async()=>clone(remote),save:async(holes,version)=>{assert.equal(version,remote.round.draft_version,'CAS version');calls++;remote.holes=clone(holes);remote.round.draft_version++;return remote.round.draft_version}};
 const engine=new CardDraft(card,local,transport);
 const edit=(eng=engine,n=1,strokes=5)=>eng.update(eng.snapshot().holes.map(h=>h.hole_number===n?{...h,completion:'completed',strokes}:h));
 return {card,local,transport,engine,edit,setOnline:value=>{online=value},setActive:value=>{active=value},get remote(){return remote},get calls(){return calls}};
}
for(const course of ['rueil','jardy']) for(const count of [9,18]) {
 const prefix=`${course} ${count}`;
 test(`${prefix}: immediate local persistence, picked-up hole, cold restart and reconnect`,async()=>{
  const x=setup(course,count); x.setOnline(false);x.edit();x.engine.update(x.engine.snapshot().holes.map(h=>h.hole_number===count?{...h,completion:'picked_up',strokes:null}:h));
  assert.equal(x.calls,0);assert.equal(readDraft(x.local,'owner',x.card.round.id,count).holes[0].strokes,5);
  const restarted=new CardDraft(x.card,x.local,x.transport);
  assert.equal(restarted.snapshot().status,'offline');assert.equal(restarted.snapshot().holes.at(-1).completion,'picked_up');
  await assert.rejects(restarted.flush(),/offline/);x.setOnline(true);await restarted.flush();
  assert.equal(x.calls,1);assert.equal(x.remote.holes[0].strokes,5);assert.equal(x.remote.holes.at(-1).completion,'picked_up');assert.equal(restarted.snapshot().status,'saved');
 });
 test(`${prefix}: rapid edits are coalesced, no-op and repeated save are idempotent`,async()=>{
  const x=setup(course,count);for(let n=1;n<=count;n++)x.edit(x.engine,n,4);await x.engine.flush();await x.engine.flush();
  assert.equal(x.calls,1);assert.ok(x.remote.holes.every(h=>h.strokes===4));x.edit(x.engine,1,4);assert.equal(x.engine.snapshot().status,'saved');assert.equal(x.engine.snapshot().dirty,false);
 });
 test(`${prefix}: edits made during an in-flight save survive the acknowledgement`,async()=>{
  const x=setup(course,count);let release;const gate=new Promise(resolve=>{release=resolve});const save=x.transport.save;
  x.transport.save=async(...args)=>{await gate;return save(...args)};x.edit();const flight=x.engine.flush();await new Promise(resolve=>setImmediate(resolve));
  x.edit(x.engine,count,7);release();await flight;assert.equal(x.calls,2);assert.equal(x.remote.holes[0].strokes,5);assert.equal(x.remote.holes.at(-1).strokes,7);assert.equal(x.engine.snapshot().dirty,false);
 });
 test(`${prefix}: lost response is acknowledged after restart without a duplicate write`,async()=>{
  const x=setup(course,count);const save=x.transport.save;x.transport.save=async(...args)=>{await save(...args);throw Error('Failed to fetch')};x.edit();await assert.rejects(x.engine.flush(),/fetch/);
  assert.equal(x.engine.snapshot().status,'offline');assert.ok(readDraft(x.local,'owner',x.card.round.id,count).sent);x.transport.save=save;
  const restarted=new CardDraft(x.card,x.local,x.transport);await restarted.flush();assert.equal(x.calls,1);assert.equal(restarted.snapshot().version,1);assert.equal(restarted.snapshot().dirty,false);
 });
 test(`${prefix}: lost response plus newer typing preserves both snapshots`,async()=>{
  const x=setup(course,count);const save=x.transport.save;x.transport.save=async(...args)=>{await save(...args);x.edit(x.engine,count,8);throw Error('Network error')};x.edit();await assert.rejects(x.engine.flush());x.transport.save=save;
  const restarted=new CardDraft(x.card,x.local,x.transport);await restarted.flush();assert.equal(x.calls,2);assert.equal(x.remote.holes[0].strokes,5);assert.equal(x.remote.holes.at(-1).strokes,8);
 });
 for(const keepMine of [true,false]) test(`${prefix}: conflict requires explicit ${keepMine?'local':'server'} choice`,async()=>{
  const x=setup(course,count);x.edit(x.engine,1,5);x.remote.holes[0]={hole_number:1,completion:'completed',strokes:7};x.remote.round.draft_version=1;
  await assert.rejects(x.engine.flush(),/conflict/);assert.equal(x.calls,0);assert.equal(x.engine.snapshot().holes[0].strokes,5);assert.equal(x.engine.snapshot().conflict[0].strokes,7);
  x.engine.choose(keepMine);await x.engine.flush();assert.equal(x.remote.holes[0].strokes,keepMine?5:7);assert.equal(x.calls,keepMine?1:0);
 });
 test(`${prefix}: another local tab cannot silently overwrite pending scores`,async()=>{
  const x=setup(course,count), other=new CardDraft(x.card,x.local,x.transport);x.edit(x.engine,1,5);x.edit(other,1,9);
  assert.equal(other.snapshot().status,'conflict');assert.equal(readDraft(x.local,'owner',x.card.round.id,count).holes[0].strokes,5);
  assert.equal(readDraft(x.local,'owner',x.card.round.id,count,true).holes[0].strokes,9);other.choose(true);await other.flush();assert.equal(x.remote.holes[0].strokes,9);
 });
 test(`${prefix}: clean cache adopts a newer server version without a false conflict`,async()=>{
  const x=setup(course,count);x.edit();await x.engine.flush();x.remote.holes[0].strokes=8;x.remote.round.draft_version++;
  const restarted=new CardDraft(x.remote,x.local,x.transport);assert.equal(restarted.snapshot().status,'saved');assert.equal(restarted.snapshot().holes[0].strokes,8);
 });
 test(`${prefix}: terminal card and expired deadline retain local data and refuse writes`,async()=>{
  const x=setup(course,count);x.edit();x.remote.round.status='validated';await assert.rejects(x.engine.flush(),/blocked/);assert.equal(x.calls,0);assert.equal(readDraft(x.local,'owner',x.card.round.id,count).holes[0].strokes,5);
  const y=setup(course,count);y.edit();y.transport.save=async()=>{throw Error('Entry deadline passed.')};await assert.rejects(y.engine.flush(),/deadline/);assert.equal(y.engine.snapshot().status,'blocked');assert.equal(y.remote.round.draft_version,0);assert.equal(y.engine.snapshot().holes[0].strokes,5);
 });
 test(`${prefix}: invalid scores stay local, then sync once corrected`,async()=>{
  const x=setup(course,count);for(const value of [null,0,1.5,31]){x.edit(x.engine,1,value);await assert.rejects(x.engine.flush(),/invalid/);assert.equal(x.calls,0)}
  x.edit(x.engine,1,6);await x.engine.flush();assert.equal(x.calls,1);assert.equal(x.remote.holes[0].strokes,6);
 });
 test(`${prefix}: storage failure is explicit and never claims offline persistence`,async()=>{
  const x=setup(course,count);
  const broken={...x.local,getItem:x.local.getItem,setItem:()=>{throw Error('QuotaExceededError')},removeItem:x.local.removeItem};
  const engine=new CardDraft(x.card,broken,x.transport);x.setOnline(false);x.edit(engine);assert.equal(engine.snapshot().status,'storageError');await assert.rejects(engine.flush(),/storageError/);assert.equal(engine.snapshot().status,'storageError');assert.equal(x.calls,0);
 });
 test(`${prefix}: sign-out during a save never resurrects the local draft`,async()=>{
  const x=setup(course,count);let release;const gate=new Promise(resolve=>{release=resolve});const save=x.transport.save;x.transport.save=async(...args)=>{await gate;return save(...args)};
  x.edit();const flight=x.engine.flush();await new Promise(resolve=>setImmediate(resolve));x.engine.stop();x.setActive(false);x.local.removeItem(draftKey('owner',x.card.round.id));release();await assert.rejects(flight,/session/);assert.equal(x.local.getItem(draftKey('owner',x.card.round.id)),null);
 });
 test(`${prefix}: unauthorized and corrupted caches are ignored`,()=>{
  const x=setup(course,count);x.local.setItem(draftKey('owner',x.card.round.id),JSON.stringify({schema:1,owner:'someone-else',round:x.card.round.id,version:0,base:x.card.holes,holes:x.card.holes,stamp:'bad'}));assert.equal(readDraft(x.local,'owner',x.card.round.id,count),null);
  x.local.setItem(draftKey('owner',x.card.round.id),'broken JSON');assert.equal(readDraft(x.local,'owner',x.card.round.id,count),null);
  const unauthorized=new CardDraft({...x.card,is_owner:false},storage(),x.transport);assert.equal(unauthorized.snapshot().status,'blocked');
 });
 test(`${prefix}: session expiry preserves the queue until a successful retry`,async()=>{
  const x=setup(course,count), load=x.transport.load;x.edit();x.transport.load=async()=>{throw Error('JWT expired')};await assert.rejects(x.engine.flush(),/JWT/);assert.equal(x.engine.snapshot().status,'session');assert.equal(readDraft(x.local,'owner',x.card.round.id,count).holes[0].strokes,5);x.transport.load=load;await x.engine.flush();assert.equal(x.engine.snapshot().status,'saved');
 });
}
test('score equality ignores JSON key order',()=>assert.ok(sameHoles([{hole_number:1,completion:'completed',strokes:5}],[{strokes:5,completion:'completed',hole_number:1}])));
function worker() {
 const handlers={},entries=new Map(),fetches=[];let unavailable=false,skips=0;
 const cache={addAll:async urls=>{for(const url of urls)entries.set(url,new Response('fallback',{headers:{'content-type':'text/html'}}))},put:async(key,response)=>entries.set(typeof key==='string'?key:key.url,response.clone()),match:async key=>entries.get(typeof key==='string'?key:key.url)?.clone()};
 const self={location:{origin:'https://app.mulliganclub.co'},registration:{active:{},showNotification:async()=>{}},clients:{claim:async()=>{}},skipWaiting:async()=>{skips++},addEventListener:(type,fn)=>{handlers[type]=fn}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'public/sw.js'),'utf8'),{self,caches:{open:async()=>cache},fetch:async request=>{const url=typeof request==='string'?request:request.url;fetches.push(url);if(unavailable)throw Error('offline');return new Response('<script src="/_next/static/chunks/card.js"></script><link href="/_next/static/css/app.css"><a href="/api/private">ignore</a>',{headers:{'content-type':'text/html'}})},URL,Response,Set});
 return {handlers,entries,fetches,get skips(){return skips},offline:()=>{unavailable=true}};
}
test('worker caches card shells and immutable assets, with a real offline navigation fallback',async()=>{
 const w=worker();let promise;w.handlers.install({waitUntil:p=>{promise=p}});await promise;assert.equal(w.skips,0,'existing clients never update without consent');
 const id='d657eb3f-02bd-4db2-aa0c-092194c26dcd';let ready;
 w.handlers.message({data:{type:'WARM_CARD_SHELL',path:`/rounds/${id}`},source:{postMessage:m=>{ready=m}},waitUntil:p=>{promise=p}});await promise;assert.equal(ready.type,'CARD_SHELL_READY');assert.ok(w.entries.has(`/rounds/${id}`));assert.ok(w.entries.has('https://app.mulliganclub.co/_next/static/chunks/card.js'));assert.ok(!w.fetches.includes('/api/private'));
 w.offline();w.handlers.fetch({request:{url:`https://app.mulliganclub.co/rounds/${id}`,method:'GET',mode:'navigate'},respondWith:p=>{promise=p}});assert.match(await (await promise).text(),/card.js/);
});
test('worker never intercepts Supabase, mutations, API data, leagues or RSC payloads',()=>{
 const w=worker();for(const request of [{url:'https://abizphozurvgdjljwvfx.supabase.co/rest/v1/rpc/save_personal_card',method:'POST'}, {url:'https://app.mulliganclub.co/api/private',method:'GET'}, {url:'https://app.mulliganclub.co/games',method:'GET',mode:'navigate'}, {url:'https://app.mulliganclub.co/rounds?_rsc=1',method:'GET',mode:'cors'}, {url:'https://app.mulliganclub.co/rounds',method:'POST'}])w.handlers.fetch({request,respondWith:()=>assert.fail('private request intercepted')});
 assert.ok(w.handlers.push&&w.handlers.notificationclick,'push behavior remains installed');
});

test('cached cards are account-scoped, exclude other players and clear only on explicit logout',()=>{
 const source=path.join(root,'src/lib/cardOffline.ts'), cacheModule=new Module(source,module);
 cacheModule.require=name=>name==='@/lib/cardDraft'?loaded.exports:require(name);
 cacheModule._compile(ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,source);
 const local=storage(),win=new EventTarget();win.localStorage=local;const previous=global.window;global.window=win;
 try {
  const api=cacheModule.exports;api.setOfflineOwner('owner');const card={...fixture('rueil',9),validators:[{name:'Other player'}],events:[{actor_name:'Other player'}],leagues:[{name:'Private league'}],revisions:[],revision:null};
  assert.equal(api.cachePersonalCard(card),true);assert.equal(api.cachedPersonalCards('owner').length,1);
  const cached=api.cachedPersonalCard('owner',card.round.id);assert.deepEqual(cached.validators,[]);assert.deepEqual(cached.events,[]);assert.deepEqual(cached.leagues,[]);
  const newer={...card,round:{...card.round,draft_version:2},holes:card.holes.map((h,i)=>i===0?{...h,completion:'completed',strokes:8}:h)};
  api.cachePersonalCard(newer);api.cachePersonalCard(card);assert.equal(api.cachedPersonalCard('owner',card.round.id).round.draft_version,2,'late responses cannot roll back a saved snapshot');
  api.cachePersonalCard({...newer,round:{...newer.round,status:'validated'}});api.cachePersonalCard(newer);assert.equal(api.cachedPersonalCard('owner',card.round.id).round.status,'validated','a stale draft response cannot unlock a cached card');
  assert.equal(api.cachePersonalCard({...card,is_owner:false}),false);assert.equal(api.cachedPersonalCard('someone-else',card.round.id),null);
  api.setOfflineOwner('someone-else');assert.deepEqual(api.cachedPersonalCards('owner'),[]);assert.ok(Object.keys(local).some(key=>key.includes(':owner:')),'session/account change preserves the isolated draft');
  api.clearCardOfflineData('owner');assert.ok(!Object.keys(local).some(key=>key.includes(':owner:')));assert.equal(api.offlineOwner(),'someone-else');
  api.markCardShellReady('/rounds/example');assert.equal(api.isCardShellReady('/rounds/example'),true,'readiness survives a message arriving before the editor mounts');
 }finally{global.window=previous}
});
