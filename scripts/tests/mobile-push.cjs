const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const read=p=>fs.readFileSync(p,'utf8');
function load(file,imports={},globals={}){
 const module={exports:{}};vm.runInNewContext(ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,{module,exports:module.exports,require:name=>imports[name]??require(name),console,Buffer,URL,URLSearchParams,Uint8Array,atob,setTimeout,clearTimeout,process:{env:{NEXT_PUBLIC_VAPID_PUBLIC_KEY:Buffer.from([4,...Array(64).fill(1)]).toString('base64url')}},...globals});return module.exports;
}
function pushClient(overrides={}){
 let unsub=0,subscribes=0,registers=0,permissionCalls=0;
 const db={data:{id:'row'},error:null},session={data:{session:{user:{id:'owner'}}}};
 const subscription={endpoint:'https://push.example/device',toJSON:()=>({endpoint:'https://push.example/device',keys:{p256dh:'key',auth:'auth'}}),unsubscribe:async()=>{unsub++;return true}};
 const registration={pushManager:{getSubscription:async()=>subscription,subscribe:async()=>{subscribes++;return subscription}}};
 const queries=[];const query={select:()=>query,delete:()=>query,eq:(k,v)=>{queries.push([k,v]);return query},maybeSingle:async()=>db,upsert:async()=>db,then:resolve=>Promise.resolve(db).then(resolve)};
 const worker={getRegistration:async()=>registration,register:async()=>{registers++;return registration},ready:Promise.resolve(registration)};
 const notification={permission:'granted',requestPermission:async()=>{permissionCalls++;return notification.permission}};
 const navigator={serviceWorker:worker,userAgent:'iPhone',platform:'iPhone',maxTouchPoints:5};
 const window={PushManager:{},Notification:notification,matchMedia:()=>({matches:false})};
 const api=load('src/lib/pushNotifications.ts',{'@/lib/supabase':{supabase:{auth:{getSession:async()=>session},from:()=>query}}},{navigator,window,Notification:notification,...overrides});
 return {api,db,session,registration,subscription,worker,notification,navigator,window,queries,get unsub(){return unsub},get subscribes(){return subscribes},get registers(){return registers},get permissionCalls(){return permissionCalls}};
}
test('iPhone installation guidance distinguishes Safari, standalone and iPad desktop mode',()=>{
 const x=pushClient();assert.equal(x.api.needsPushInstallation(),true);x.window.matchMedia=()=>({matches:true});assert.equal(x.api.needsPushInstallation(),false);
 x.window.matchMedia=()=>({matches:false});x.navigator.userAgent='Macintosh';x.navigator.platform='MacIntel';assert.equal(x.api.needsPushInstallation(),true);x.navigator.maxTouchPoints=0;assert.equal(x.api.needsPushInstallation(),false);
});
test('no worker registration returns off without waiting on the never-resolving ready promise',async()=>{
 const x=pushClient();x.worker.ready=new Promise(()=>{});x.worker.getRegistration=async()=>undefined;assert.equal(await x.api.isSubscribedToPush(),false);assert.equal(await x.api.unsubscribeFromPush(),true);
});
test('browser subscription alone never claims server delivery or ownership',async()=>{
 const x=pushClient();assert.equal(await x.api.isSubscribedToPush(),true);assert.ok(x.queries.some(([k,v])=>k==='user_id'&&v==='owner'));
 x.db.data=null;assert.equal(await x.api.isSubscribedToPush(),false);x.db.error={message:'offline'};assert.equal(await x.api.isSubscribedToPush(),false);x.session.data.session=null;assert.equal(await x.api.isSubscribedToPush(),false);
});
test('permission is requested synchronously from the tap and denied permission makes no worker changes',async()=>{
 const x=pushClient();x.notification.permission='denied';const promise=x.api.subscribeToPush();assert.equal(x.permissionCalls,1);assert.equal(await promise,false);assert.equal(x.registers,0);
});
test('activation persists an existing subscription without creating a second one',async()=>{
 const x=pushClient();assert.equal(await x.api.subscribeToPush(),true);assert.equal(x.subscribes,0);assert.equal(x.unsub,0);
});
test('failed save rolls back only a newly-created subscription',async()=>{
 const x=pushClient();x.db.error={message:'offline'};assert.equal(await x.api.subscribeToPush(),false);assert.equal(x.unsub,0);
 x.registration.pushManager.getSubscription=async()=>null;assert.equal(await x.api.subscribeToPush(),false);assert.equal(x.subscribes,1);assert.equal(x.unsub,1);
});
test('failed removal keeps a deliverable subscription and reports failure for retry',async()=>{
 const x=pushClient();x.db.error={message:'offline'};assert.equal(await x.api.unsubscribeFromPush(),false);assert.equal(x.unsub,0);x.db.error=null;assert.equal(await x.api.unsubscribeFromPush(),true);assert.equal(x.unsub,1);
});
test('switching accounts detaches browser delivery without waiting for an auth request',async()=>{
 const x=pushClient();x.session.data.session=null;await x.api.detachBrowserPush();assert.equal(x.unsub,1);
});
function sw(clients=[]){
 const handlers={},notices=[],opened=[],origin='https://app.mulliganclub.co';
 const clientAPI={matchAll:async()=>clients,openWindow:async url=>opened.push(url)};
 const self={location:{origin},registration:{showNotification:async(title,options)=>notices.push({title,...options})},addEventListener:(type,fn)=>handlers[type]=fn};
 vm.runInNewContext(read('public/sw.js'),{self,clients:clientAPI,URL,encodeURIComponent,console});
 return {notices,opened,async push(data){let work;handlers.push({data:{json:()=>data},waitUntil:p=>work=p});await work},async click(data){let work;handlers.notificationclick({notification:{data,close(){}},waitUntil:p=>work=p});await work}};
}
test('different cards remain separate OS alerts while retries of one event reuse its tag',async()=>{
 const x=sw();for(const id of ['first','second','first']) await x.push({tag:'personal_card',data:{notification_id:id}});
 assert.deepEqual(x.notices.map(n=>n.tag),['first','second','first']);
});
const invite=load('src/lib/inviteCodes.ts');const {notificationTarget}=load('src/lib/notificationTarget.ts',{'@/lib/inviteCodes':invite});
for(const course of ['rueil','jardy'])for(const holes of [9,18])for(const league of ['one','two'])test(`${course} ${holes}, league ${league}: validation deep link remains the same card`,async()=>{
 const round=`${course}-${holes}`,data={type:'personal_card',round_id:round,game_id:league,notification_id:`${round}-${league}`};const x=sw();await x.click(data);
 assert.equal(x.opened[0],`https://app.mulliganclub.co/rounds/${round}?n=${data.notification_id}`);assert.equal(notificationTarget(data.type,data),`/rounds/${round}`);
});
test('invitations open the join preview before the inaccessible private league',async()=>{
 for(const code of ['ABC123','ABC1234567']){const data={type:'league_invitation',invite_code:code,game_id:'private'};const x=sw();await x.click(data);assert.equal(x.opened[0],`https://app.mulliganclub.co/join/${code}`);assert.equal(notificationTarget(data.type,data),`/join/${code}`);}
 assert.equal(notificationTarget('join_rejected',{game_id:'private'}),null);
});
test('a fake app origin is never focused and untrusted paths cannot escape the app',async()=>{
 const x=sw([{url:'https://app.mulliganclub.co.evil.test',visibilityState:'visible',focus(){throw Error('must not focus')}}]);await x.click({round_id:'//evil.test/path',notification_id:'x&y'});assert.equal(new URL(x.opened[0]).origin,'https://app.mulliganclub.co');assert.ok(x.opened[0].includes('%2F%2Fevil.test%2Fpath'));
});
test('already open app navigates and focuses; null navigation opens a new app window',async()=>{
 let focused=0,navigated='';const client={url:'https://app.mulliganclub.co/home',visibilityState:'visible',navigate:async url=>{navigated=url;return client},focus:async()=>{focused++}};const x=sw([client]);await x.click({round_id:'card'});assert.equal(navigated,'https://app.mulliganclub.co/rounds/card');assert.equal(focused,1);assert.equal(x.opened.length,0);
 client.navigate=async()=>null;await x.click({round_id:'next'});assert.equal(x.opened[0],'https://app.mulliganclub.co/rounds/next');
});
test('standalone manifest keeps a stable identity and a real 512px brand icon',()=>{
 const manifest=load('src/app/manifest.ts').default();assert.equal(manifest.display,'standalone');assert.equal(manifest.id,'/');assert.equal(manifest.scope,'/');assert.ok(fs.existsSync('public'+manifest.icons[0].src));assert.equal(manifest.icons[0].sizes,'512x512');
});
function sender({muted=false,preferenceError=null,subError=null,statusCode=null,count=0,type="personal_card"}={}){
 const deleted=[],sent=[],record={id:'real',user_id:'recipient',title:'Database title',type,body:'Database body',data:type==='league_invitation'?{game_id:'private',invite_code:'ABC123'}:{round_id:'round'},created_at:new Date().toISOString()};
 const subscription={endpoint:'https://push.example/private',p256dh:'public',auth:'private'};
 const client={from(table){const q={select(){return q},eq(k,v){if(q.deleting)deleted.push([k,v]);return q},gte(){return q},lt(){return q},neq(){return q},delete(){q.deleting=true;return q},maybeSingle:async()=>({data:record,error:null}),then(resolve){return Promise.resolve(table==='notifications'?{count}:{data:[subscription],error:subError}).then(resolve)}};return q},rpc:async()=>({data:!muted,error:preferenceError})};
 const webpush={setVapidDetails(){},sendNotification:async(sub,payload)=>{if(statusCode)throw{statusCode};sent.push({sub,payload:JSON.parse(payload)})}};
 const {POST}=load('src/app/api/push/route.ts',{'@supabase/supabase-js':{createClient:()=>client},'web-push':webpush,'next/server':{NextResponse:{json:(body,init)=>({body,status:init?.status||200})}}},{process:{env:{PUSH_WEBHOOK_SECRET:'test-secret',NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-admin',NEXT_PUBLIC_VAPID_PUBLIC_KEY:'test-public',VAPID_PRIVATE_KEY:'test-private'}}});
 return {sent,deleted,call:()=>POST({headers:new Headers({authorization:'Bearer test-secret'}),json:async()=>({id:'real',title:'Forged title',user_id:'other'})})};
}
test('push sender uses persisted content and notification identity, never incoming title or recipient',async()=>{
 const x=sender(),result=await x.call();assert.equal(result.body.sent,1);assert.equal(x.sent[0].payload.title,'Database title');assert.equal(x.sent[0].payload.tag,'real');assert.equal(x.sent[0].payload.data.notification_id,'real');
});
test('muting card alerts suppresses delivery; preference and subscription lookup errors fail closed',async()=>{
 for(const options of [{muted:true},{preferenceError:{message:'offline'}},{subError:{message:'offline'}}]){const x=sender(options),result=await x.call();assert.equal(x.sent.length,0);assert.equal(result.status,options.muted?200:500);}
});
test('expired endpoints are removed only for the intended recipient; other errors preserve retry information',async()=>{
 for(const code of [404,410,503]){const x=sender({statusCode:code}),result=await x.call();assert.equal(result.body.failures,1);assert.equal(x.deleted.length,code===503?0:2);if(code!==503)assert.ok(x.deleted.some(([k,v])=>k==='user_id'&&v==='recipient'));}
});
test('burst throttling suppresses extra pushes while leaving the persisted inbox event intact',async()=>{
 const x=sender({count:3,type:'member_joined'});assert.equal((await x.call()).body.reason,'Throttled (rapid-fire)');assert.equal(x.sent.length,0);
});

test("card decisions and invitations remain deliverable during a burst",async()=>{for(const type of ["personal_card","league_invitation"]){const x=sender({count:8,type});assert.equal((await x.call()).body.sent,1);}});

test('incomplete invitations and rejected requests stay in the inbox',async()=>{
 for(const type of ['league_invitation','join_rejected']){const x=sw();await x.click({type,invite_code:'invalid',game_id:'private'});assert.equal(x.opened[0],'https://app.mulliganclub.co/notifications');assert.equal(notificationTarget(type,{invite_code:'invalid',game_id:'private'}),null);}
});
test('empty or malformed payloads still display a visible generic push',async()=>{for(const payload of [null,[],42]){const x=sw();await x.push(payload);assert.equal(x.notices[0].title,'Mulligan');}});
test('an inactive worker times out rather than hanging activation',async()=>{
 const x=pushClient({setTimeout:callback=>{queueMicrotask(callback);return 1},clearTimeout(){}});x.worker.ready=new Promise(()=>{});assert.equal(await x.api.subscribeToPush(),false);
});
function readSyncHarness(){
 let effect,state={user:{id:'recipient'},loading:true},failure=null,pending=null;const events=new Map(),replaced=[],dispatched=[],calls=[];
 const window={location:{pathname:'/join/ABC123',search:'?n=11111111-1111-1111-1111-111111111111'},addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k),dispatchEvent:e=>dispatched.push(e)};
 const router={replace:(...args)=>replaced.push(args)};
 const {NotificationReadSync}=load('src/components/NotificationReadSync.tsx',{
  react:{useEffect:fn=>{effect=fn}},'next/navigation':{useRouter:()=>router,usePathname:()=>window.location.pathname},
  '@/components/AuthProvider':{useAuthContext:()=>state},'@/lib/supabase':{supabase:{rpc:async(name,args)=>{calls.push({name,args});if(pending)await pending;return{error:failure}}}},
 },{window,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}}});
 return {window,events,replaced,dispatched,calls,setState:s=>{state=s},setFailure:f=>{failure=f},setPending:p=>{pending=p},render:()=>{NotificationReadSync();return effect()},settle:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('push read tracking waits for restored auth, runs on join pages, and refreshes the badge',async()=>{
 const x=readSyncHarness();x.render();await x.settle();assert.equal(x.calls.length,0);
 x.setState({user:{id:'recipient'},loading:false});x.render();await x.settle();assert.equal(x.calls.length,1);assert.equal(x.calls[0].args.p_notification_ids[0],'11111111-1111-1111-1111-111111111111');assert.equal(x.replaced[0][0],'/join/ABC123');assert.equal(x.dispatched[0].detail.userId,'recipient');
});
test('failed read tracking preserves the deep link and retries on reconnect; unmount removes listeners',async()=>{
 const x=readSyncHarness();x.setState({user:{id:'recipient'},loading:false});x.setFailure({message:'offline'});const cleanup=x.render();await x.settle();assert.equal(x.replaced.length,0);
 x.setFailure(null);await x.events.get('online')();assert.equal(x.replaced.length,1);cleanup();assert.equal(x.events.size,0);
});
test('a late read acknowledgement never navigates back to the previous page',async()=>{
 const x=readSyncHarness();x.setState({user:{id:'recipient'},loading:false});let release;x.setPending(new Promise(resolve=>{release=resolve}));x.render();x.window.location.pathname='/games/accepted';release();await x.settle();assert.equal(x.replaced.length,0);
});
test('signed-out push visitors keep their exact app-local destination through login',()=>{
 let effect;const replaced=[];const {useAuth}=load('src/hooks/useAuth.ts',{
  react:{useEffect:fn=>{effect=fn}},'next/navigation':{useRouter:()=>({replace:url=>replaced.push(url)}),usePathname:()=>'/rounds/card'},'@/components/AuthProvider':{useAuthContext:()=>({user:null,loading:false})}
 },{window:{location:{search:'?n=notice'}}});useAuth();effect();assert.equal(replaced[0],'/?redirect=%2Frounds%2Fcard%3Fn%3Dnotice');
});

test("the preview Home Screen icon is clearly distinct from the public app",()=>{const manifest=load("src/app/manifest.ts",{},{process:{env:{VERCEL_ENV:"preview"}}}).default();assert.equal(manifest.name,"Mulligan Test");assert.equal(manifest.short_name,"Mulligan Test");});

test('invitation pushes avoid private league links in older installed workers',async()=>{
 const x=sender({type:'league_invitation'});await x.call();const data=x.sent[0].payload.data;assert.equal(data.game_id,undefined);assert.equal(data.invite_code,'ABC123');assert.equal(data.type,'league_invitation');assert.equal(notificationTarget(data.type,data),'/join/ABC123');
});
