const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'../..');let locale='fr';let mockedDraft;let mockedRpc;let mockedUser={id:'owner'};let mockedSearchParams=new URLSearchParams();const cache=new Map();
function load(relative){let file=path.join(root,relative);if(!path.extname(file))file+=fs.existsSync(file+'.tsx')?'.tsx':'.ts';if(cache.has(file))return cache.get(file);const m=new Module(file,module);m.paths=module.paths;m.require=name=>{
 if(name==='@/components/AuthProvider')return{useAuthContext:()=>({user:mockedUser,loading:false})};
 if(name==='next/navigation')return{useParams:()=>({code:'B583DG1HQP'}),useRouter:()=>({replace(){}}),useSearchParams:()=>mockedSearchParams,usePathname:()=>'/rounds'};
 if(name==='next/image')return({priority,...props})=>React.createElement('img',props);
 if(name==='@/lib/supabase')return{supabase:{rpc:(...args)=>mockedRpc?.(...args)}};
 if(name==='@/lib/useCardDraft')return{useCardDraft:()=>mockedDraft};
 if(name==='next/link')return({children,...p})=>React.createElement('a',p,children);
 if(name==='@/lib/i18n'){const t=(key,vars={})=>{const value=load('src/lib/i18n/dictionaries').dictionaries[locale][key];assert.ok(value,key);return value.replace(/\{(\w+)\}/g,(_,k)=>String(vars[k]??`{${k}}`))};return{useT:()=>t,useI18n:()=>({t,locale})};}
 if(name.startsWith('@/'))return load('src/'+name.slice(2));if(name.startsWith('./'))return load(path.relative(root,path.resolve(path.dirname(file),name)));return require(name);
 };m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);cache.set(file,m.exports);return m.exports;}
const {scoreChange,togglePickedUp,cardEntrySummary,invalidScore,groupCardLeagues,selectedCardLeagues}=load('src/lib/personalCardFlow');
const {QuickScoreEntry}=load('src/components/personal/QuickScoreEntry');const {PersonalLeagueSubmission}=load('src/components/personal/PersonalLeagueSubmission');
const {cardIsComplete}=load('src/lib/personalRounds');
for(const course of ['Rueil','Jardy'])for(const count of [9,18]){
 const holes=Array.from({length:count},(_,i)=>({hole_number:i+1,completion:'not_played',strokes:null}));
 test(`${course} ${count}: direct typing completes holes, clearing restores incomplete, picked-up never invents a gross score`,()=>{
  let entered=holes.map(h=>({...h,...scoreChange('5')}));assert.equal(cardIsComplete(entered,count),true);assert.equal(cardEntrySummary(entered).gross,count*5);
  entered[0]={...entered[0],...scoreChange('')};assert.equal(entered[0].completion,'not_played');assert.equal(cardIsComplete(entered,count),false);
  entered[0]={...entered[0],...togglePickedUp(entered[0])};assert.equal(cardIsComplete(entered,count),true);assert.equal(cardEntrySummary(entered).gross,null);assert.equal(cardEntrySummary(entered).pickedUp,1);assert.equal(entered[0].strokes,null);
  entered[0]={...entered[0],...togglePickedUp(entered[0])};assert.equal(cardIsComplete(entered,count),false);
 });
 test(`${course} ${count}: out-of-range and decimal scores remain invalid and cannot complete a card`,()=>{
  for(const value of ['0','31','-1','1.5']){const invalid=holes.map(h=>({...h,...scoreChange(value)}));assert.equal(invalidScore(invalid[0]),true);assert.equal(cardIsComplete(invalid,count),false);assert.equal(cardEntrySummary(invalid).entered,0);}
  for(const value of ['1','30'])assert.equal(invalidScore({...holes[0],...scoreChange(value)}),false);
 });
 for(const language of ['fr','en'])test(`${language} ${course} ${count}: every score field starts visible and blank, with keyboard hints and accessible pickup controls`,()=>{
  locale=language;const html=renderToStaticMarkup(React.createElement(QuickScoreEntry,{references:holes.map(h=>({...h,par:4,stroke_index:h.hole_number})),holes,disabled:false,onChange(){},onDone(){}}));
  assert.equal((html.match(/type="number"/g)||[]).length,count);assert.equal((html.match(/value=""/g)||[]).length,count);assert.equal((html.match(/aria-pressed="false"/g)||[]).length,count);assert.ok(!html.includes('<select'));assert.equal((html.match(/enterKeyHint="next"/g)||[]).length,count-1);assert.ok(html.includes('enterKeyHint="done"'));assert.ok(html.includes('Index'));assert.ok(!html.includes('>SI<'));
 });
}
test('compatible leagues come first, submitted cards are not selectable, and rejected targets keep their reasons',()=>{
 const leagues=[{id:'bad',reason:'wrong_layout_or_tee'},{id:'old',submission_status:'accepted',reason:'submission_deadline'},{id:'ok'},{id:'ok'}];const groups=groupCardLeagues(leagues);assert.deepEqual(groups.eligible.map(g=>g.id),['ok']);assert.deepEqual(groups.submitted.map(g=>g.id),['old']);assert.deepEqual(groups.incompatible.map(g=>g.id),['bad']);assert.deepEqual(selectedCardLeagues(leagues,['bad','old','ok','ok','missing']).map(g=>g.id),['ok']);
});
test('the batch selector exposes only compatible checkboxes and preserves existing submission states',()=>{
 locale='fr';const data={round:{id:'card',status:'validated',tee_id:'tee',played_on:'2026-10-15'},revision:{id:'rev'},tee:{course_name:'Rueil',hole_count:9},leagues:[{id:'a',name:'League A',format:'stroke_net',attestation:'self_declared'},{id:'b',name:'League B',format:'stableford_net',attestation:'peer_required'},{id:'bad',name:'Other tee',reason:'wrong_layout_or_tee'},{id:'old',name:'Old league',submission_status:'accepted'}]};
 const html=renderToStaticMarkup(React.createElement(PersonalLeagueSubmission,{data,online:true,busy:false,onBusyChange(){},onReload:async()=>{}}));assert.equal((html.match(/type="checkbox"/g)||[]).length,2);assert.ok(html.includes('Sélectionner League A'));assert.ok(html.includes('Sélectionner League B'));assert.ok(!html.includes('Sélectionner Other tee'));assert.ok(html.includes('Déjà soumise (1)'));assert.ok(html.includes('Autres ligues (1)'));assert.ok(html.includes('Tout sélectionner'));
});

test('keyboard review obeys the same rating, session, offline and conflict gates as the review button',()=>{
 locale='en';const {PersonalRoundEditor}=load('src/components/personal/PersonalRoundEditor');const {ConfirmModal}=load('src/components/ConfirmModal');
 const scores=Array.from({length:9},(_,i)=>({hole_number:i+1,completion:'completed',strokes:5}));
 const base={is_owner:true,round:{id:'gate-card',tee_id:'tee',status:'draft',played_on:'2026-10-15',entry_deadline_at:'2026-10-17T00:00:00Z',course_timezone:'Europe/Paris',handicap_index:18,handicap_source:'declared_official'},tee:{ready:true,hole_count:9,name:'Yellow',course_name:'Rueil'},reference_holes:scores.map(h=>({hole_number:h.hole_number,par:4,stroke_index:h.hole_number})),holes:scores,events:[],revisions:[],validators:[],leagues:[]};
 const originalState=React.useState,originalEffect=React.useEffect,originalRef=React.useRef;
 try {React.useEffect=()=>{};React.useRef=value=>({current:value});
  for(const scenario of [{status:'saved',online:true,ready:true,allowed:true},{status:'saved',online:true,ready:false},...['offline','conflict','blocked','session','invalid','storageError'].map(status=>({status,online:true,ready:true})),{status:'saved',online:false,ready:true}]){
   let opened=false,flushed=0,index=0;
   React.useState=initial=>{const current=index++;return[typeof initial==='function'?initial():initial,value=>{if(current===1&&value===true)opened=true}]};
   mockedDraft={ready:true,online:scenario.online,state:{status:scenario.status,holes:scores},flush:async()=>{flushed++;return 1}};
   const tree=PersonalRoundEditor({data:{...base,tee:{...base.tee,ready:scenario.ready}},onReload:async()=>{}});let entry,modal;
   function visit(node){if(!node||typeof node!=='object')return;if(node.type===QuickScoreEntry)entry=node;if(node.type===ConfirmModal)modal=node;React.Children.forEach(node.props?.children,visit)}visit(tree);
   assert.ok(entry&&modal);entry.props.onDone();assert.equal(opened,!!scenario.allowed,JSON.stringify(scenario));assert.equal(modal.props.confirmDisabled,!scenario.allowed);
   if(!scenario.allowed){modal.props.onConfirm();assert.equal(flushed,0,'blocked keyboard or modal must not save/confirm');}
  }
 }finally{React.useState=originalState;React.useEffect=originalEffect;React.useRef=originalRef;mockedDraft=undefined}
});

test('league handoff survives new and existing card paths, rejecting malformed destinations',()=>{
 const {leagueContext,withLeagueContext}=load('src/lib/personalCardFlow');
 const id='e885da51-9aa9-4b7a-a421-28c2854ff5f8';
 assert.equal(leagueContext(id.toUpperCase()),id);
 for(const raw of ['https://example.com','../games','a&league=b','',null])assert.equal(leagueContext(raw),null);
 assert.equal(withLeagueContext('/rounds?tee=yellow',id),`/rounds?tee=yellow&league=${id}`);
 assert.equal(withLeagueContext('/rounds/card',id),`/rounds/card?league=${id}`);
 assert.equal(withLeagueContext('/rounds/card','//example.com'),'/rounds/card');
 const {RoundList}=load('src/components/personal/RoundList');
 const html=renderToStaticMarkup(React.createElement(RoundList,{leagueId:id,rounds:[{id:'card',status:'draft',course_name:'QA',played_on:'2026-10-18',hole_count:9,tee_name:'Yellow'}]}));
 assert.ok(html.includes(`/rounds/card?league=${id}`));
});
test('intended league selection respects server eligibility, membership and previous submissions',()=>{
 const {intendedCardLeague}=load('src/lib/personalCardFlow');
 const id='e885da51-9aa9-4b7a-a421-28c2854ff5f8';
 assert.equal(intendedCardLeague([{id}],id),id);
 for(const league of [{id,reason:'wrong_layout_or_tee'},{id,reason:'not_member'},{id,submission_status:'accepted'},{id,reason:'submission_deadline'}])assert.equal(intendedCardLeague([league],id),null);
 assert.equal(intendedCardLeague([],id),null);
});
test('an eligible invited league is preselected, while submission still requires explicit confirmation',()=>{
 locale='fr'; const id='e885da51-9aa9-4b7a-a421-28c2854ff5f8';
 const data={round:{id:'card',status:'validated',tee_id:'tee',played_on:'2026-10-18'},revision:{id:'rev'},tee:{course_name:'QA',hole_count:9},leagues:[{id,name:'Friends',format:'stroke_net',attestation:'self_declared'}]};
 const props={data,online:true,busy:false,onBusyChange(){},onReload:async()=>{}};
 const chosen=renderToStaticMarkup(React.createElement(PersonalLeagueSubmission,{...props,leagueId:id}));
 assert.ok(chosen.includes('checked=""'));assert.ok(chosen.includes('Soumettre à la ligue'));assert.ok(!chosen.includes('role="dialog"'));
 for(const league of [{...data.leagues[0],reason:'wrong_layout_or_tee'},{...data.leagues[0],submission_status:'accepted'}]){
  const html=renderToStaticMarkup(React.createElement(PersonalLeagueSubmission,{...props,leagueId:id,data:{...data,leagues:[league]}}));
  assert.ok(!html.includes('type="checkbox"'));assert.ok(!html.includes('checked=""'));
 }
});

function receivedCard(count=18){
 const scores=Array.from({length:count},(_,i)=>({hole_number:i+1,completion:'completed',strokes:5}));
 return {is_owner:false,server_now:'2026-10-18T10:00:00Z',round:{id:'qa-review',status:'pending_validation',played_on:'2026-10-18',course_timezone:'Europe/Paris',entry_deadline_at:'2026-10-20T00:00:00Z',auto_validation_at:'2026-10-21T10:00:00Z',handicap_index:18,handicap_source:'default_54'},tee:{ready:true,course_name:'QA',name:'Yellow',hole_count:count},revision:{id:'revision-1',revision_number:1,scores,gross_total:count*5},reference_holes:scores.map(h=>({hole_number:h.hole_number,par:4,stroke_index:h.hole_number})),holes:scores,events:[],revisions:[],validators:[],leagues:[]};
}
for(const language of ['fr','en'])for(const count of [9,18])test(`${language} ${count}: received cards start read-only with an action shortcut and explicit presence gate`,()=>{
 locale=language;const data=receivedCard(count);mockedDraft={online:true,ready:true,state:{status:'saved',holes:data.holes}};
 try {const {PersonalRoundEditor}=load('src/components/personal/PersonalRoundEditor');const html=renderToStaticMarkup(React.createElement(PersonalRoundEditor,{data,onReload:async()=>{}}));
  assert.ok(!html.includes('type="number"'));assert.ok(html.includes('href="#card-validation-actions"'));assert.ok(html.includes('type="checkbox"'));assert.ok(!html.includes('checked=""'));assert.ok(html.includes('disabled=""'));assert.ok(!html.includes('<textarea'));assert.equal((html.match(/<tr class="border-t/g)||[]).length,count);
 }finally{mockedDraft=undefined}
});
test('correction detection compares actual hole scores and pickup states, not array order',()=>{
 const {cardScoresChanged}=load('src/lib/personalCardFlow');const original=receivedCard(9).holes;
 assert.equal(cardScoresChanged([...original].reverse(),original),false);
 assert.equal(cardScoresChanged(original.map((h,i)=>i? h:{...h,strokes:6}),original),true);
 assert.equal(cardScoresChanged(original.map((h,i)=>i? h:{...h,completion:'picked_up',strokes:null}),original),true);
});
test('review and correction actions preserve attendance, offline and changed-score gates',async()=>{
 const {PersonalRoundEditor}=load('src/components/personal/PersonalRoundEditor');
 const originalState=React.useState,originalEffect=React.useEffect,originalRef=React.useRef;
 const calls=[];const data=receivedCard(9);let state=[],index=0,online=true;const flight={current:false};
 function visit(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props?.children)){const found=visit(child,predicate);if(found)return found}return null}
 const button=(tree,label)=>visit(tree,n=>n.type==='button'&&n.props.children===label);
 const render=()=>{index=0;mockedDraft={online,ready:true,state:{status:'saved',holes:data.holes}};return PersonalRoundEditor({data,onReload:async()=>{}})};
 try{
  locale='fr';React.useEffect=()=>{};React.useRef=()=>flight;React.useState=initial=>{const i=index++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value}]};mockedRpc=async(...args)=>{calls.push(args);return{data:{success:true},error:null}};
  let tree=render();let approve=button(tree,'Valider ces scores');assert.ok(approve.props.disabled);approve.props.onClick();await Promise.resolve();assert.equal(calls.length,0);
  state[3]=true;online=false;tree=render();assert.ok(button(tree,'Valider ces scores').props.disabled);button(tree,'Valider ces scores').props.onClick();await Promise.resolve();assert.equal(calls.length,0);
  online=true;state[5]=true;state[4]='QA correction';tree=render();assert.equal(button(tree,'Valider ces scores'),null);assert.ok(button(tree,'Proposer les scores corrigés').props.disabled,'unchanged scores cannot be proposed');
  state[0]=data.holes.map((h,i)=>i? h:{...h,strokes:6});tree=render();assert.equal(button(tree,'Proposer les scores corrigés').props.disabled,false);button(tree,'Proposer les scores corrigés').props.onClick();await Promise.resolve();assert.equal(calls.length,1);assert.equal(calls[0][0],'review_personal_card');assert.equal(calls[0][1].p_present,true);assert.equal(calls[0][1].p_scores[0].strokes,6);assert.equal(calls[0][1].p_reason,'QA correction');
  await Promise.resolve();await Promise.resolve();flight.current=false;state=[];tree=render();state[3]=true;tree=render();approve=button(tree,'Valider ces scores');approve.props.onClick();approve.props.onClick();await Promise.resolve();assert.equal(calls.length,2,'repeated tap cannot create duplicate reviews');assert.equal(calls[1][1].p_scores,null,'approval validates the unchanged revision');
 }finally{React.useState=originalState;React.useEffect=originalEffect;React.useRef=originalRef;mockedDraft=undefined;mockedRpc=undefined}
});

function correctedPlayerCard(count=9){
 const base=receivedCard(count),previous={...base.revision,id:'previous',revision_number:1},current={...previous,id:'corrected',revision_number:2,scores:previous.scores.map((h,i)=>i?h:{...h,strokes:6}),correction_reason:'QA: one missed stroke'};
 return {...base,is_owner:true,level:{value:18,status:'established'},round:{...base.round,status:'pending_player_confirmation'},revision:current,revisions:[current,previous]};
}
test('correction comparison finds the immediately preceding revision despite history order and shows only changed holes',()=>{
 const {correctionComparison}=load('src/lib/personalCardFlow');const data=correctedPlayerCard(18);
 const changes=correctionComparison(data.revision,data.revisions);assert.equal(changes.length,1);assert.equal(changes[0].before.strokes,5);assert.equal(changes[0].after.strokes,6);
 assert.equal(correctionComparison(data.revision,[data.revision]),null);
 assert.equal(correctionComparison({...data.revision,revision_number:3},[data.revisions[1]]),null,'missing intervening revision must not silently compare against an older version');
});
for(const language of ['fr','en'])for(const count of [9,18])test(`${language} ${count}: player sees changes and decisions before the full scorecard`,()=>{
 locale=language;const data=correctedPlayerCard(count);mockedDraft={online:true,ready:true,state:{status:'saved',holes:data.holes}};
 try{const {PersonalRoundEditor}=load('src/components/personal/PersonalRoundEditor');const html=renderToStaticMarkup(React.createElement(PersonalRoundEditor,{data,onReload:async()=>{}}));
  assert.ok(html.indexOf('id="player-correction"')<html.indexOf('aria-label="'+(language==='fr'?'Scores':'Scores')+'"'));
  assert.ok(html.includes('QA: one missed stroke'));assert.ok(!html.includes('role="dialog"'),'a choice requires a deliberate first tap');
  assert.ok(!html.includes(language==='fr'?'Soumettre avant :':'Submit by:'));
 }finally{mockedDraft=undefined}
});
function playerDecisionHarness({online=true,fail=false}={}){
 const {PersonalCorrectionDecision}=load('src/components/personal/PersonalCorrectionDecision');const {ConfirmModal}=load('src/components/ConfirmModal');
 const saved={state:React.useState,effect:React.useEffect,ref:React.useRef};let states=[],index=0,busy=false,data=correctedPlayerCard();const flight={current:false},calls=[],outcomes=[];let reloads=0;
 locale='fr';React.useEffect=()=>{};React.useRef=()=>flight;React.useState=initial=>{const i=index++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value}]};
 mockedRpc=async(...args)=>{calls.push(args);if(fail)throw Error('lost response');return{data:{success:true},error:null}};
 function find(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props?.children)){const found=find(child,predicate);if(found)return found}return null}
 const render=()=>{index=0;return PersonalCorrectionDecision({data,online,busy,onBusyChange:value=>{busy=value},onReload:async()=>{reloads++},onResolved:value=>outcomes.push(value)})};
 return {render,button:(tree,label)=>find(tree,n=>n.type==='button'&&n.props.children===label),modal:tree=>find(tree,n=>n.type===ConfirmModal),calls,outcomes,reloads:()=>reloads,setData:value=>{data=value},close(){React.useState=saved.state;React.useEffect=saved.effect;React.useRef=saved.ref;mockedRpc=undefined}};
}
for(const accept of [true,false])test(`${accept?'accept':'refuse'}: choice opens a consequence-specific confirmation, cancellation writes nothing, repeated confirmation settles once`,async()=>{
 const h=playerDecisionHarness();try{
  let tree=h.render();h.button(tree,accept?'Accepter et valider':'Refuser la correction').props.onClick();assert.equal(h.calls.length,0);
  tree=h.render();let modal=h.modal(tree);assert.equal(modal.props.open,true);assert.equal(modal.props.destructive,!accept);
  if(!accept){assert.ok(modal.props.message.includes('Toute la carte'));assert.ok(modal.props.message.includes('ne seront pas rétablis'));}
  modal.props.onCancel();assert.equal(h.modal(h.render()).props.open,false);assert.equal(h.calls.length,0);
  h.button(h.render(),accept?'Accepter et valider':'Refuser la correction').props.onClick();modal=h.modal(h.render());modal.props.onConfirm();modal.props.onConfirm();await new Promise(setImmediate);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'resolve_personal_correction');assert.deepEqual(h.calls[0][1],{p_round:'qa-review',p_revision:'corrected',p_accept:accept});assert.deepEqual(h.outcomes,[accept]);assert.equal(h.reloads(),1);
 }finally{h.close()}
});
test('offline or missing comparison cannot open a decision, and stale confirmations cannot write',()=>{
 const offline=playerDecisionHarness({online:false});try{const tree=offline.render();const button=offline.button(tree,'Accepter et valider');assert.equal(button.props.disabled,true);button.props.onClick();assert.equal(offline.modal(offline.render()).props.open,false);assert.equal(offline.calls.length,0)}finally{offline.close()}
 const h=playerDecisionHarness();try{h.button(h.render(),'Accepter et valider').props.onClick();let next=correctedPlayerCard();next={...next,revision:{...next.revision,id:'new-revision'}};h.setData(next);const modal=h.modal(h.render());assert.equal(modal.props.confirmDisabled,true);modal.props.onConfirm();assert.equal(h.calls.length,0);
  h.setData({...next,revisions:[next.revision]});assert.equal(h.button(h.render(),'Accepter et valider').props.disabled,true);
 }finally{h.close()}
});
test('a lost decision acknowledgement refreshes the card and never reports an unconfirmed success',async()=>{
 const h=playerDecisionHarness({fail:true});try{h.button(h.render(),'Accepter et valider').props.onClick();h.modal(h.render()).props.onConfirm();await new Promise(setImmediate);assert.equal(h.calls.length,1);assert.equal(h.reloads(),1);assert.equal(h.outcomes.length,0);assert.equal(h.modal(h.render()).props.open,false)}finally{h.close()}
});

const {cardLeagueReview,leagueCardError,leagueCardWindow}=load('src/lib/cardLeagueReview');
const targetId='074339b8-ee19-47f3-8c82-62c24aa47c6e';
function leagueDraft(){const holes=Array.from({length:9},(_,i)=>({hole_number:i+1,completion:'completed',strokes:5}));return {is_owner:true,server_now:'2026-10-18T12:00:00Z',round:{id:'qa-handoff',user_id:'owner',tee_id:'tee',status:'draft',played_on:'2026-10-18',entry_deadline_at:'2026-10-20T00:00:00Z',course_timezone:'Europe/Paris',handicap_index:18,handicap_source:'declared_official'},tee:{ready:true,hole_count:9,name:'Yellow',course_name:'QA'},reference_holes:holes.map(h=>({...h,par:4,stroke_index:h.hole_number})),holes,events:[],revisions:[],validators:[{id:'owner',name:'Me'},{id:'partner',name:'Partner'},{id:'other',name:'Other league friend'}],leagues:[{id:targetId,name:'New season',attestation:'peer_required',format:'stroke_net',reason:'unconfirmed_card'}]};}
function reviewLeague(){return {closure_status:'open',game:{id:targetId,name:'New season',start_date:'2026-10-18',end_date:'2026-11-17'},rules:{tee_id:'tee',attestation:'peer_required',format:'stroke_net'},board:[{user_id:'owner'},{user_id:'partner'}]};}
test('a peer league only offers its other members; solo and another league’s friend cannot confirm',()=>{
 const data=leagueDraft(),league=reviewLeague();let policy=cardLeagueReview(data,league,'');assert.equal(policy.witnessRequired,true);assert.deepEqual(policy.validators.map(v=>v.id),['partner']);assert.equal(policy.ready,false);
 assert.equal(cardLeagueReview(data,league,'other').ready,false);assert.equal(cardLeagueReview(data,league,'owner').ready,false);assert.equal(cardLeagueReview(data,league,'partner').ready,true);
 assert.equal(cardLeagueReview(data,null,'partner').ready,false);
 for(const changed of [{...league,rules:{...league.rules,tee_id:'wrong'}},{...league,closure_status:'finalized'},{...league,game:{...league.game,start_date:'2026-10-19'}}])assert.equal(cardLeagueReview(data,changed,'partner').ready,false);
 const solo={...league,rules:{...league.rules,attestation:'self_declared'}};assert.equal(cardLeagueReview(data,solo,'').ready,true);
});
test('new-league entry keeps course-local intake dates inside the season and blocks closed/future seasons',()=>{
 const league=reviewLeague();assert.deepEqual(leagueCardWindow(league,'2026-10-18'),{min:'2026-10-18',max:'2026-10-18',initial:'2026-10-18',open:true});
 assert.equal(leagueCardWindow(league,'2026-10-20').min,'2026-10-19');assert.equal(leagueCardWindow(league,'2026-10-17').open,false);
 assert.equal(leagueCardWindow({...league,closure_status:'finalized'},'2026-11-18').open,false);
 assert.equal(leagueCardError('league_card_rejected:validator_required'),'validator_required');assert.equal(leagueCardError('network'),null);
});
function handoffHarness({validator='partner',context=true,online=true,fail=false,standalone=false}={}){
 const {PersonalRoundEditor}=load('src/components/personal/PersonalRoundEditor'),{ConfirmModal}=load('src/components/ConfirmModal');
 const saved={state:React.useState,ref:React.useRef,effect:React.useEffect};let index=0,refIndex=0,reloads=0,flushes=0;const values=[],refs=[],calls=[];const data=leagueDraft(),league=reviewLeague();
 React.useEffect=()=>{};React.useRef=initial=>refs[refIndex++]??(refs[refIndex-1]={current:initial});
 React.useState=initial=>{const i=index++;if(!(i in values))values[i]=i===1?true:i===2?validator:i===10&&context?{key:`qa-handoff:${targetId}`,league,failed:false}:typeof initial==='function'?initial():initial;return[values[i],value=>{values[i]=typeof value==='function'?value(values[i]):value}]};
 mockedDraft={ready:true,online,state:{status:'saved',holes:data.holes},flush:async()=>{flushes++;return 17}};
 mockedRpc=async(name,args)=>{calls.push([name,args]);if(fail)throw new Error('network');return{data:{success:true},error:null}};
 const render=()=>{index=0;refIndex=0;return PersonalRoundEditor({data,leagueId:standalone?null:targetId,onReload:async()=>{reloads++}})};
 const modal=tree=>{let result;function visit(n){if(!n||typeof n!=='object')return;if(n.type===ConfirmModal)result=n;React.Children.forEach(n.props?.children,visit)}visit(tree);return result};
 return{render,modal,calls,values,flushes:()=>flushes,reloads:()=>reloads,close(){React.useState=saved.state;React.useRef=saved.ref;React.useEffect=saved.effect;mockedDraft=undefined;mockedRpc=undefined}};
}
test('confirming a league card uses one atomic request and repeated taps cannot double-submit',async()=>{
 locale='fr';const h=handoffHarness();try{const modal=h.modal(h.render());assert.equal(modal.props.confirmDisabled,false);modal.props.onConfirm();modal.props.onConfirm();await new Promise(setImmediate);assert.equal(h.flushes(),1);assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'confirm_card_into_league');assert.deepEqual(h.calls[0][1],{p_round:'qa-handoff',p_expected_version:17,p_validator:'partner',p_game:targetId});assert.equal(h.reloads(),1)}finally{h.close()}
});
test('missing witness, wrong member, missing rules and offline state prevent irreversible requests',()=>{
 for(const options of [{validator:''},{validator:'other'},{context:false},{online:false}]){const h=handoffHarness(options);try{const modal=h.modal(h.render());assert.equal(modal.props.confirmDisabled,true);modal.props.onConfirm();assert.equal(h.flushes(),0);assert.equal(h.calls.length,0)}finally{h.close()}}
});
test('a lost handoff acknowledgement reloads before retry; a personal card keeps its separate workflow',async()=>{
 const failed=handoffHarness({fail:true});try{failed.modal(failed.render()).props.onConfirm();await new Promise(setImmediate);assert.equal(failed.calls.length,1);assert.equal(failed.reloads(),1);assert.equal(failed.values[9],null)}finally{failed.close()}
 const personal=handoffHarness({standalone:true,validator:''});try{personal.modal(personal.render()).props.onConfirm();await new Promise(setImmediate);assert.equal(personal.calls[0][0],'request_personal_validation');assert.ok(!('p_game' in personal.calls[0][1]))}finally{personal.close()}
});

const InvitePage=load('src/app/join/[code]/page').default;
const {NotificationItem}=load('src/components/NotificationItem');
function invitationPreview(extra={}){return {found:true,name:'Friends Cup',course_name:'QA course',format:'stroke_net',member_count:2,max_players:10,start_date:'2026-10-18',end_date:'2026-11-17',hole_count:9,tee_name:'Yellow',attestation:'peer_required',...extra};}
function renderInvitation(preview,user={id:'owner'}){
 const original=React.useState;let index=0;mockedUser=user;
 React.useState=initial=>{const i=index++;return[i===0?preview:i===1?false:typeof initial==='function'?initial():initial,()=>{}]};
 try{return renderToStaticMarkup(React.createElement(InvitePage));}finally{React.useState=original;mockedUser={id:'owner'}}
}
for(const language of ['fr','en']){
 test(`${language}: a reopened invitation returns a current member to its exact league, even full or ended`,()=>{
  locale=language;const dict=load('src/lib/i18n/dictionaries').dictionaries[language];
  for(const flags of [{},{is_full:true},{is_completed:true}]){
   const html=renderInvitation(invitationPreview({...flags,member_game_id:targetId}));
   assert.ok(html.includes(`href="/games/${targetId}"`));assert.ok(html.includes(dict['invite.openLeague']));assert.ok(!html.includes(`>${dict['invite.join']}<`));
  }
 });
 test(`${language}: an invitation explains the season, repere and witness rule before joining`,()=>{
  locale=language;const dict=load('src/lib/i18n/dictionaries').dictionaries[language];const html=renderInvitation(invitationPreview());
  assert.ok(html.includes(dict['invite.season']));assert.ok(html.includes('Yellow'));assert.ok(html.includes(dict['invite.witnessRule']));assert.ok(html.includes(dict['invite.join']));
  const anonymous=renderInvitation(invitationPreview(),null);assert.ok(anonymous.includes(encodeURIComponent('/join/B583DG1HQP')));assert.ok(!anonymous.includes(dict['invite.openLeague']));
 });
 test(`${language}: the existing invitation notice is localized while preserving sender, league and destination`,()=>{
  locale=language;const html=renderToStaticMarkup(React.createElement(NotificationItem,{notification:{id:'invite',type:'league_invitation',title:'League invitation',body:'Partner invited you to Friends Cup',created_at:new Date().toISOString(),read_at:null,data:{invite_code:'B583DG1HQP'}},onTap(){}}));
  assert.ok(html.includes('Partner'));assert.ok(html.includes('Friends Cup'));assert.ok(html.includes(load('src/lib/i18n/dictionaries').dictionaries[language]['invite.notice.title']));
  if(language==='fr')assert.ok(!html.includes(' invited you to '));
 });
}
test('a complete card missing its witness offers a direct jump instead of a disabled review dead end',()=>{
 locale='fr';const h=handoffHarness({validator:''});const originalDocument=global.document;let focused=0;
 global.document={getElementById:id=>id==='card-witness'?{scrollIntoView(){},focus(){focused++}}:null};
 try{const tree=h.render();let action;function visit(n){if(!n||typeof n!=='object')return;if(n.type==='button'&&React.Children.toArray(n.props.children).includes('Choisir le témoin'))action=n;React.Children.forEach(n.props?.children,visit)}visit(tree);assert.ok(action);assert.equal(action.props.disabled,false);action.props.onClick();assert.equal(focused,1);assert.equal(h.calls.length,0);assert.equal(h.modal(tree).props.confirmDisabled,true)}finally{h.close();global.document=originalDocument}
});

function groupLeague() {
 return {closure_status:'open',game:{id:'bc1d81e4-ff1e-4ea8-b91f-95e198fe8d9a',start_date:'2020-01-01',end_date:'2099-01-01',invite_code:'ABC123'},rules:{tee_id:'281b6df9-2dd6-41dc-b937-ad49a35538f7',timezone:'Europe/Paris'},board:[
  {user_id:'owner',player_name:'Organizer',rounds_counted:0},
  {user_id:'waiting',player_name:'Waiting witness',rounds_counted:0},
  {user_id:'correcting',player_name:'Correction',rounds_counted:0},
  {user_id:'ranked',player_name:'Already counted',rounds_counted:1},
  {user_id:'rejected',player_name:'Replacement',rounds_counted:0}],
  submissions:[{user_id:'waiting',round_id:'pending-card',status:'pending',card_status:'pending_validation',validator_id:'owner'},
   {user_id:'correcting',round_id:'correction-card',status:'pending',card_status:'pending_player_confirmation',validator_id:'owner'},
   {user_id:'ranked',status:'accepted',card_status:'validated'},
   {user_id:'rejected',status:'rejected',card_status:'disputed'}],
  organizer_progress:{awaiting_join:[{user_id:'invited',player_name:'Invited friend'},{user_id:'invited',player_name:'Invited friend'},{user_id:'waiting',player_name:'Already joined'}]}};
}
test('organizer progress separates first submission from rank, validation, correction and rejection',()=>{
 const {leagueGroupProgress}=load('src/lib/leagueGroupProgress');const p=leagueGroupProgress(groupLeague(),'owner');
 assert.equal(p.missing,1);assert.equal(p.submitted,4);assert.deepEqual(p.members.map(m=>m.status),['missing','pending','correction','counted','replace']);
 assert.equal(p.members[1].reviewRound,'pending-card');assert.equal(p.members[2].reviewRound,undefined);
 assert.deepEqual(p.awaiting.map(m=>m.user_id),['invited']);
 const revised=groupLeague();revised.submissions=[{user_id:'owner',status:'superseded',card_status:'validated'}];assert.equal(leagueGroupProgress(revised,'owner').members[0].status,'missing');
});
test('fresh membership replaces a pending invitation without relying on session state',()=>{
 const {leagueGroupProgress}=load('src/lib/leagueGroupProgress');const d=groupLeague();d.board.push({user_id:'invited',player_name:'Invited friend',rounds_counted:0});
 const p=leagueGroupProgress(d,'owner');assert.equal(p.awaiting.length,0);assert.equal(p.missing,2);assert.equal(p.members.at(-1).status,'missing');
});
for(const language of ['fr','en'])test(`${language}: compact organizer roster names the next action and never gives the wrong witness a validation link`,()=>{
 locale=language;const {PersonalLeagueProgress}=load('src/components/personal/PersonalLeagueProgress');const d=groupLeague(),dict=load('src/lib/i18n/dictionaries').dictionaries[language];
 const html=renderToStaticMarkup(React.createElement(PersonalLeagueProgress,{data:d,userId:'owner',onInvite(){}}));
 for(const state of ['missing','review','correction','counted','replace'])assert.ok(html.includes(dict[`group.status.${state}`]),state);
 assert.ok(html.includes('href="/rounds/pending-card"'));assert.ok(!html.includes('href="/rounds/correction-card"'));assert.equal((html.replace(/aria-label="[^"]*"/g,'').match(/Invited friend/g)||[]).length,1);
 assert.ok(html.includes(dict['group.linkHint']));assert.ok(html.includes(dict['group.you']));
 const other=renderToStaticMarkup(React.createElement(PersonalLeagueProgress,{data:d,userId:'other',onInvite(){}}));assert.ok(!other.includes('href="/rounds/pending-card"'));
 const hidden=renderToStaticMarkup(React.createElement(PersonalLeagueProgress,{data:{...d,organizer_progress:null},userId:'owner',onInvite(){}}));assert.equal(hidden,'');
});
test('one received card is enough for activation even when ranking needs several cards',()=>{
 const {leagueGroupProgress}=load('src/lib/leagueGroupProgress');const d=groupLeague();d.board=[{user_id:'owner',player_name:'Me',rounds_counted:1,position:null}];d.submissions=[{user_id:'owner',status:'accepted',card_status:'validated'}];
 const p=leagueGroupProgress(d,'owner');assert.equal(p.missing,0);assert.equal(p.submitted,1);assert.equal(p.members[0].status,'counted');
});
for(const language of ['fr','en'])test(`${language}: retained invitations are not offered again when returning to the old-group selector`,()=>{
 locale=language;const {PersonalLeagueFriends}=load('src/components/personal/PersonalLeagueFriends');
 const state=React.useState,effect=React.useEffect,ref=React.useRef;let index=0;
 try{
  React.useEffect=()=>{};React.useRef=v=>({current:v});React.useState=v=>{const i=index++;return [i===0?[{id:'invited',name:'Still invited',username:'invited'},{id:'joined',name:'Already joined',username:'joined'},{id:'new',name:'Not invited yet',username:'new'}]:i===1?['invited','joined','new']:i===5?false:typeof v==='function'?v():v,()=>{}]};
  const html=renderToStaticMarkup(PersonalLeagueFriends({sourceId:'old',gameId:'next',userId:'owner',memberIds:['joined'],invitedIds:['invited'],onPrepared(){}}));
  assert.equal((html.match(/type="checkbox"/g)||[]).length,1);assert.ok(html.includes('Not invited yet'));assert.ok(!html.includes('Still invited'));assert.ok(!html.includes('Already joined'));
 }finally{React.useState=state;React.useEffect=effect;React.useRef=ref}
});

test('reminders target only invited non-members and friends with no first submission',()=>{
 const {leagueReminders}=load('src/lib/leagueReminders');const d=groupLeague();d.board.push({user_id:'first',player_name:'First card friend',rounds_counted:0});
 const reminders=leagueReminders(d,'owner','2026-10-18');assert.deepEqual(reminders.map(r=>[r.id,r.kind]),[['invited','join'],['first','card']]);
 assert.equal(reminders[0].path,'/join/ABC123?reminder=join');const entry=new URL(reminders[1].path,'https://app.mulliganclub.co');assert.equal(entry.pathname,'/join/ABC123');assert.equal(entry.searchParams.get('reminder'),'card');
 const {signupRedirectPath}=load('src/lib/signupFlow');assert.equal(signupRedirectPath(entry.pathname+entry.search),'/join/ABC123?reminder=card');
 for(const state of ['finalized','closed_provisional'])assert.deepEqual(leagueReminders({...d,closure_status:state},'owner','2026-10-18'),[]);
 assert.deepEqual(leagueReminders({...d,organizer_progress:null},'owner','2026-10-18'),[]);assert.deepEqual(leagueReminders(d,'owner','2100-01-01'),[]);
 const future={...d,game:{...d.game,start_date:'2026-11-01'}};assert.deepEqual(leagueReminders(future,'owner','2026-10-18').map(r=>r.kind),['join']);
 const changed={...d,submissions:[...d.submissions,{user_id:'first',status:'pending',card_status:'pending_validation'}],board:[...d.board,{user_id:'invited',player_name:'Just joined',rounds_counted:0}]};
 const updated=leagueReminders(changed,'owner','2026-10-18');assert.ok(!updated.some(r=>r.id==='first'));assert.equal(updated.find(r=>r.id==='invited').kind,'card');
});
test('malformed invitation or tee destinations never create reminder links',()=>{
 const {leagueReminders}=load('src/lib/leagueReminders');const d=groupLeague();d.board.push({user_id:'first',player_name:'First',rounds_counted:0});
 assert.deepEqual(leagueReminders({...d,game:{...d.game,id:'//evil.example',invite_code:'../../evil'}},'owner','2026-10-18'),[]);
 assert.ok(!leagueReminders({...d,rules:{...d.rules,tee_id:'../other'}},'owner','2026-10-18').some(r=>r.kind==='card'));
});
for(const language of ['fr','en'])test(`${language}: reminder copy is personal, stage-specific and safely encoded for WhatsApp`,()=>{
 locale=language;const {leagueReminders,reminderMessage,reminderWhatsAppUrl}=load('src/lib/leagueReminders');const d=groupLeague();d.board.push({user_id:'first',player_name:'Émile & friends',rounds_counted:0});const dict=load('src/lib/i18n/dictionaries').dictionaries[language];
 const t=(key,vars)=>dict[key].replace(/\{(\w+)\}/g,(_,k)=>vars[k]);
 for(const reminder of leagueReminders(d,'owner','2026-10-18')){
  const message=reminderMessage(reminder,'Coupe A&B #1','https://app.mulliganclub.co',t);assert.ok(message.includes(reminder.name));assert.ok(message.includes('Coupe A&B #1'));assert.ok(message.endsWith(new URL(reminder.path,'https://app.mulliganclub.co').href));
  const whatsApp=new URL(reminderWhatsAppUrl(message));assert.equal(whatsApp.origin,'https://wa.me');assert.equal(whatsApp.searchParams.get('text'),message);assert.equal([...whatsApp.searchParams.keys()].length,1);
 }
});
test('copy feedback waits for success and a denied or unavailable clipboard never reports sending',async()=>{
 const {copyLeagueReminder}=load('src/lib/leagueReminders');let copied;assert.equal(await copyLeagueReminder('Hi friend',{writeText:async text=>{copied=text}}),'copied');assert.equal(copied,'Hi friend');
 assert.equal(await copyLeagueReminder('Hi friend'),'failed');assert.equal(await copyLeagueReminder('Hi friend',{writeText:async()=>{throw Error('Denied')}}),'failed');
});
for(const language of ['fr','en'])test(`${language}: organizer reminders exclude self and pending/counting cards, and show a reviewable message`,()=>{
 locale=language;const {PersonalLeagueProgress}=load('src/components/personal/PersonalLeagueProgress');const {LeagueReminderDialog}=load('src/components/personal/LeagueReminderDialog');const d=groupLeague();d.board.push({user_id:'first',player_name:'First card friend',rounds_counted:0});
 const html=renderToStaticMarkup(React.createElement(PersonalLeagueProgress,{data:d,userId:'owner',onInvite(){}}));const dict=load('src/lib/i18n/dictionaries').dictionaries[language];
 const title=name=>dict['reminder.title'].replace('{name}',name);assert.ok(html.includes(title('First card friend')));assert.ok(html.includes(title('Invited friend')));
 for(const name of ['Organizer','Waiting witness','Correction','Already counted','Replacement'])assert.ok(!html.includes(title(name)),name);
 const dialog=renderToStaticMarkup(React.createElement(LeagueReminderDialog,{name:'First card friend',message:'Preview & link',onClose(){}}));assert.ok(dialog.includes('role="dialog"'));assert.ok(dialog.includes(dict['reminder.hint']));assert.ok(dialog.includes(dict['reminder.copy']));assert.ok(dialog.includes('Preview &amp; link'));assert.ok(!dialog.includes(dict['reminder.copied']));
});
test('an open reminder disappears when refresh shows the friend joined or submitted',()=>{
 locale='fr';const {PersonalLeagueProgress}=load('src/components/personal/PersonalLeagueProgress');const {LeagueReminderDialog}=load('src/components/personal/LeagueReminderDialog');const state=React.useState;
 function hasDialog(data,selected){let index=0;try{React.useState=initial=>[index++===0?selected:'https://app.mulliganclub.co',()=>{}];const tree=PersonalLeagueProgress({data,userId:'owner',onInvite(){}});let found=false;function visit(n){if(!n||typeof n!=='object')return;if(n.type===LeagueReminderDialog)found=true;React.Children.forEach(n.props?.children,visit)}visit(tree);return found;}finally{React.useState=state}}
 const d=groupLeague();assert.equal(hasDialog(d,'invited:join'),true);
 const joined={...d,board:[...d.board,{user_id:'invited',player_name:'Invited friend',rounds_counted:0}]};assert.equal(hasDialog(joined,'invited:join'),false);assert.equal(hasDialog(joined,'invited:card'),true);
 const submitted={...joined,submissions:[...joined.submissions,{user_id:'invited',status:'pending',card_status:'pending_validation'}]};assert.equal(hasDialog(submitted,'invited:card'),false);
});

for(const language of ['fr','en'])test(`${language}: reminder preview stays compact while copy retains the full authentication link`,()=>{
 locale=language;const {LeagueReminderDialog}=load('src/components/personal/LeagueReminderDialog');const dict=load('src/lib/i18n/dictionaries').dictionaries[language];
 const text='Hi friend\nhttps://app.mulliganclub.co/?tab=login&redirect=%2Frounds%3Fleague%3Dgroup';
 const html=renderToStaticMarkup(React.createElement(LeagueReminderDialog,{name:'Friend',kind:'card',message:text,onClose(){}}));
 assert.ok(html.includes('Hi friend'));assert.ok(html.includes(dict['reminder.link.card']));assert.ok(!html.includes('%2Frounds'));
 const state=React.useState,ref=React.useRef;const priorNavigator=global.navigator;let copied;
 try{React.useState=v=>[v,()=>{}];React.useRef=v=>({current:v});Object.defineProperty(global,'navigator',{value:{clipboard:{writeText:async value=>{copied=value}}},configurable:true});
  const tree=LeagueReminderDialog({name:'Friend',kind:'card',message:text,onClose(){}});tree.props.onConfirm();assert.equal(copied,text);
 }finally{React.useState=state;React.useRef=ref;Object.defineProperty(global,'navigator',{value:priorNavigator,configurable:true})}
});

test('a reminder resumes only exact-tee drafts inside the live course-local entry window',()=>{
 const {leagueCardReturn}=load('src/lib/leagueCardReturn');const league={...groupLeague(),game:{...groupLeague().game,start_date:'2026-10-18',end_date:'2026-11-17'},submissions:[]};
 const round={id:'saved',tee_id:league.rules.tee_id,status:'draft',played_on:'2026-10-18'};
 assert.equal(leagueCardReturn([round],league,'owner','2026-10-18').draft.id,'saved');
 for(const change of [{tee_id:'other-tee'},{tee_id:undefined},{status:'validated'},{played_on:'2026-10-17'},{played_on:'2026-10-19'}])assert.equal(leagueCardReturn([{...round,...change}],league,'owner','2026-10-18').draft,null,JSON.stringify(change));
 for(const state of ['finalized','closed_provisional'])assert.equal(leagueCardReturn([round],{...league,closure_status:state},'owner','2026-10-18').draft,null);
 const priorDay={...league,game:{...league.game,start_date:'2026-10-17'}};assert.equal(leagueCardReturn([{...round,played_on:'2026-10-17'}],priorDay,'owner','2026-10-18').draft.id,'saved');
});
test('a stale reminder shows the current submission instead of starting a duplicate first card',()=>{
 const {leagueCardReturn}=load('src/lib/leagueCardReturn');const league=groupLeague(),round={id:'draft',tee_id:league.rules.tee_id,status:'draft',played_on:'2026-10-18'};
 for(const status of ['accepted','pending']){const sent={user_id:'owner',round_id:'already-sent',status,card_status:'pending_validation'};const result=leagueCardReturn([round],{...league,submissions:[sent]},'owner','2026-10-18');assert.equal(result.draft,null);assert.equal(result.submission.round_id,'already-sent');}
 for(const status of ['superseded','rejected'])assert.equal(leagueCardReturn([round],{...league,submissions:[{user_id:'owner',status}]},'owner','2026-10-18').draft.id,'draft');
 assert.equal(leagueCardReturn([round],{...league,submissions:[{user_id:'other',status:'pending'}]},'owner','2026-10-18').draft.id,'draft');
});
for(const language of ['fr','en'])test(`${language}: existing draft and submitted-card panels preserve the league with explicit new-card choice`,()=>{
 locale=language;const {LeagueCardReturnPanel}=load('src/components/personal/LeagueCardReturnPanel');const league={...groupLeague(),tee:{name:'Yellow'}};const draft={id:'saved',played_on:'2026-10-18'};const dict=load('src/lib/i18n/dictionaries').dictionaries[language];
 const html=renderToStaticMarkup(React.createElement(LeagueCardReturnPanel,{league,state:{draft,submission:null},onNew(){}}));assert.ok(html.includes(dict['cardReturn.resume']));assert.ok(html.includes(`/rounds/saved?league=${league.game.id}`));assert.ok(html.includes(dict['cardReturn.new']));
 const sent=renderToStaticMarkup(React.createElement(LeagueCardReturnPanel,{league,state:{draft:null,submission:{round_id:'sent',played_on:'2026-10-18',status:'pending',card_status:'pending_player_confirmation'}},onNew(){}}));assert.ok(sent.includes(dict['cardReturn.sentTitle']));assert.ok(sent.includes(dict['personal.submission.awaitingPlayer']));assert.ok(sent.includes(`/rounds/sent?league=${league.game.id}`));assert.ok(!sent.includes(dict['cardReturn.resume']));
});
test('card-intent destinations work for personal leagues, with completed and legacy leagues returning to standings',()=>{
 const {inviteMemberDestination}=load('src/lib/leagueCardReturn');assert.equal(inviteMemberDestination(targetId,true,true,false),`/rounds?new=1&league=${targetId}`);
 for(const args of [[false,true,false],[true,false,false],[true,true,true]])assert.equal(inviteMemberDestination(targetId,...args),`/games/${targetId}`);
 assert.equal(inviteMemberDestination('//evil.example',true,true,false),'/games');
});
for(const language of ['fr','en'])test(`${language}: reminder preview prioritizes returning-player sign-in and retains the intent`,()=>{
 locale=language;const dict=load('src/lib/i18n/dictionaries').dictionaries[language];
 try{for(const intent of ['join','card']){mockedSearchParams=new URLSearchParams({reminder:intent});const html=renderInvitation(invitationPreview(),null);assert.ok(html.includes(dict['cardReturn.login']));assert.ok(html.includes(encodeURIComponent(`/join/B583DG1HQP?reminder=${intent}`)));assert.ok(!html.includes(dict['invite.signup.named'].replace('{name}','Friends Cup')));}
 mockedSearchParams=new URLSearchParams({reminder:'card'});const member=renderInvitation(invitationPreview({member_game_id:targetId,is_full:true}));assert.ok(member.includes(`/rounds?new=1&amp;league=${targetId}`));
 const ended=renderInvitation(invitationPreview({member_game_id:targetId,is_completed:true}));assert.ok(ended.includes(`/games/${targetId}`));
 for(const flags of [{is_full:true},{is_completed:true}]){const anon=renderInvitation(invitationPreview(flags),null);assert.ok(anon.includes(dict['cardReturn.memberLogin']));assert.ok(anon.includes('tab=login'));}
 }finally{mockedSearchParams=new URLSearchParams()}
});
for(const language of ['fr','en'])test(`${language}: the actual reminder entry page offers an existing card before any new-card form`,()=>{
 locale=language;const Page=load('src/app/rounds/page').default;const state=React.useState;const originalRpc=mockedRpc;
 const league={...groupLeague(),tee:{name:'Yellow'},game:{...groupLeague().game,name:'Return Cup'}};
 const d={rounds:[{id:'saved',tee_id:league.rules.tee_id,status:'draft',played_on:new Date().toISOString().slice(0,10),course_name:'QA',tee_name:'Yellow',hole_count:9}],inbox:[],tees:[],official_index:null,history:[],level:{status:'unavailable',value:null,cards_count:0,cards_used:0,revision_ids:[]}};
 const dict=load('src/lib/i18n/dictionaries').dictionaries[language];
 try{mockedSearchParams=new URLSearchParams({new:'1',league:league.game.id});mockedRpc=()=>assert.fail('Rendering reminder must not write a new round');
  for(const submitted of [false,true]){let index=0;const context={...league,submissions:submitted?[{user_id:'owner',round_id:'sent',played_on:'2026-10-18',status:'pending',card_status:'pending_validation'}]:[]};
   React.useState=initial=>{const i=index++;return[i===0?d:i===3?false:i===5?context:i===7?`owner:${league.game.id}:::true`:typeof initial==='function'?initial():initial,()=>{}]};
   const html=renderToStaticMarkup(React.createElement(Page));assert.ok(html.includes(dict[submitted?'cardReturn.sentTitle':'cardReturn.resume']));assert.ok(!html.includes(dict['personal.start']));assert.ok(!html.includes('id="new-card"'));
  }
 }finally{React.useState=state;mockedRpc=originalRpc;mockedSearchParams=new URLSearchParams()}
});

test('counted cards never hide a newer validation or correction from the organizer',()=>{
 const {leagueGroupProgress}=load('src/lib/leagueGroupProgress');const d=groupLeague();
 d.submissions.push({user_id:'ranked',round_id:'new-card',status:'pending',card_status:'pending_validation',validator_id:'owner'});
 let p=leagueGroupProgress(d,'owner');assert.equal(p.members[3].status,'pending');assert.equal(p.members[3].reviewRound,'new-card');assert.equal(p.toReview,2);assert.equal(p.needsAction,6);assert.equal(p.submitted,4);
 d.submissions.at(-1).card_status='pending_player_confirmation';p=leagueGroupProgress(d,'owner');assert.equal(p.members[3].status,'correction');assert.equal(p.toReview,1);
 d.submissions.at(-1).status='superseded';p=leagueGroupProgress(d,'owner');assert.equal(p.members[3].status,'counted');assert.equal(p.needsAction,5);
});
test('friend responses move from invitation to first card to validation without false completion',()=>{
 const {leagueGroupProgress}=load('src/lib/leagueGroupProgress');const d=groupLeague();d.board=[];d.submissions=[];d.organizer_progress.awaiting_join=[{user_id:'friend',player_name:'Friend'}];
 let p=leagueGroupProgress(d,'owner');assert.equal(p.needsAction,1);assert.equal(p.awaiting.length,1);
 d.board.push({user_id:'friend',player_name:'Friend',rounds_counted:0});p=leagueGroupProgress(d,'owner');assert.equal(p.awaiting.length,0);assert.equal(p.missing,1);
 d.submissions.push({user_id:'friend',round_id:'first',status:'pending',card_status:'pending_validation',validator_id:'owner'});p=leagueGroupProgress(d,'owner');assert.equal(p.missing,0);assert.equal(p.submitted,1);assert.equal(p.needsAction,1);assert.equal(p.toReview,1);
 d.submissions[0].status='accepted';d.submissions[0].card_status='validated';p=leagueGroupProgress(d,'owner');assert.equal(p.needsAction,0);assert.equal(p.toReview,0);assert.equal(p.members[0].status,'received');
});
test('league refresh coalesces returning events, pauses when hidden and ignores results after leaving',async()=>{
 const {PersonalLeaguePanel}=load('src/components/personal/PersonalLeaguePanel');
 const originals={state:React.useState,effect:React.useEffect,ref:React.useRef,callback:React.useCallback,window:global.window,document:global.document,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
 const effects=[],updates=[],listeners={},timers=new Map();let tick,resolve,requests=0,timerId=0,stateIndex=0;
 try{
  React.useState=value=>{const i=stateIndex++;return [value,v=>{if(i===0)updates.push(v)}]};React.useRef=value=>({current:value});React.useCallback=fn=>fn;React.useEffect=fn=>effects.push(fn);
  global.setTimeout=fn=>{const id=++timerId;timers.set(id,fn);return id};global.clearTimeout=id=>timers.delete(id);
  const events={addEventListener:(key,fn)=>listeners[key]=fn,removeEventListener:key=>delete listeners[key]};
  global.window={...events,setInterval:fn=>{tick=fn;return 1},clearInterval:()=>{tick=null}};global.document={...events,visibilityState:'visible'};
  mockedRpc=()=>{requests++;return new Promise(r=>resolve=r)};
  const d={...groupLeague(),rules:{...groupLeague().rules,format:'stroke_net',attestation:'peer_required'},board:[],submissions:[],tee:{course_name:'QA',name:'Yellow',hole_count:9}};PersonalLeaguePanel({initial:d,userId:'owner'});
  const cleanup=effects.at(-1)();listeners.focus();listeners.visibilitychange();assert.equal(timers.size,1);[...timers.values()][0]();assert.equal(requests,1);
  tick();assert.equal(requests,1);resolve({data:{...d,board:[]},error:null});await new Promise(setImmediate);assert.equal(updates.length,1);
  document.visibilityState='hidden';tick();assert.equal(requests,1);document.visibilityState='visible';tick();assert.equal(requests,2);
  cleanup();resolve({data:d,error:null});await new Promise(setImmediate);assert.equal(updates.length,1);assert.equal(tick,null);assert.deepEqual(listeners,{});assert.equal(timers.size,0);
 }finally{React.useState=originals.state;React.useEffect=originals.effect;React.useRef=originals.ref;React.useCallback=originals.callback;global.window=originals.window;global.document=originals.document;global.setTimeout=originals.setTimeout;global.clearTimeout=originals.clearTimeout;mockedRpc=undefined}
});
function validationLeague(){
 const d=groupLeague();d.game.name='Friends Cup';
 d.submissions=d.submissions.map((card,i)=>({...card,player_name:d.board.find(m=>m.user_id===card.user_id).player_name,id:`submission-${i}`,round_id:`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,played_on:'2026-10-18',revision_number:1}));
 d.submissions[0].validator_id='ranked';return d;
}
test('pending cards name the witness; corrections switch responsibility to the player',()=>{
 const {leagueValidationQueue}=load('src/lib/leagueValidationQueue');const {leagueValidationReminders}=load('src/lib/leagueReminders');const d=validationLeague();
 let queue=leagueValidationQueue(d,'owner');assert.equal(queue.length,2);assert.equal(queue[0].actorId,'ranked');assert.equal(queue[0].actorName,'Already counted');assert.equal(queue[1].actorId,'correcting');assert.equal(queue[1].actorName,'Correction');
 let reminders=leagueValidationReminders(d,'owner');assert.deepEqual(reminders.map(r=>[r.id,r.kind]),[['ranked','validation'],['correcting','correction']]);
 const url=new URL(reminders[0].path,'https://app.mulliganclub.co');assert.equal(url.searchParams.get('tab'),'login');assert.equal(url.searchParams.get('redirect'),`/rounds/${d.submissions[0].round_id}`);
 const {signupRedirectPath}=load('src/lib/signupFlow');assert.equal(signupRedirectPath(url.searchParams.get('redirect')),`/rounds/${d.submissions[0].round_id}`);
 d.submissions[0].card_status='pending_player_confirmation';queue=leagueValidationQueue(d,'owner');assert.equal(queue[0].actorId,'waiting');assert.equal(queue[0].kind,'correction');assert.ok(!leagueValidationReminders(d,'owner').some(r=>r.id==='ranked'));
});
test('review reminders survive league closing but exclude self, unknown witnesses, terminal and superseded cards',()=>{
 const {leagueValidationReminders}=load('src/lib/leagueReminders');const {leagueValidationQueue}=load('src/lib/leagueValidationQueue');const d=validationLeague();
 d.closure_status='closed_provisional';d.game.end_date='2020-01-01';assert.equal(leagueValidationReminders(d,'owner').length,2);
 d.submissions[0].validator_id='owner';assert.equal(leagueValidationReminders(d,'owner').length,1);assert.equal(leagueValidationQueue(d,'owner')[0].mine,true);
 d.submissions[0].validator_id='outside';assert.equal(leagueValidationReminders(d,'owner').length,1);assert.equal(leagueValidationQueue(d,'owner')[0].actorName,undefined);
 d.submissions[0].round_id='//evil.example';assert.equal(leagueValidationQueue(d,'owner').length,1);
 d.submissions[1].status='superseded';assert.equal(leagueValidationQueue(d,'owner').length,0);
 assert.deepEqual(leagueValidationReminders({...validationLeague(),organizer_progress:null},'owner'),[]);
});
for(const language of ['fr','en'])test(`${language}: pending-card UI names the real actor, protects review access and prepares a card-specific message`,()=>{
 locale=language;const {PersonalLeagueValidation}=load('src/components/personal/PersonalLeagueValidation');const {leagueValidationReminders,reminderMessage}=load('src/lib/leagueReminders');const dict=load('src/lib/i18n/dictionaries').dictionaries[language];const d=validationLeague();
 const html=renderToStaticMarkup(React.createElement(PersonalLeagueValidation,{data:d,userId:'owner'}));
 assert.ok(html.includes(dict['validationQueue.title']));assert.ok(html.includes(dict['reminder.title'].replace('{name}','Already counted')));assert.ok(html.includes(dict['reminder.title'].replace('{name}','Correction')));assert.ok(!html.includes('href="/rounds/'));
 d.submissions[0].validator_id='owner';const own=renderToStaticMarkup(React.createElement(PersonalLeagueValidation,{data:d,userId:'owner'}));assert.ok(own.includes(`href="/rounds/${d.submissions[0].round_id}"`));assert.ok(own.includes(dict['validationQueue.action.validation']));
 const t=(key,vars)=>dict[key].replace(/\{(\w+)\}/g,(_,k)=>vars[k]);
 for(const reminder of leagueValidationReminders(validationLeague(),'owner')){const msg=reminderMessage(reminder,d.game.name,'https://app.mulliganclub.co',t);assert.ok(msg.includes(reminder.name));assert.ok(msg.includes('2026-10-18'));assert.ok(msg.includes(d.game.name));assert.ok(msg.endsWith(new URL(reminder.path,'https://app.mulliganclub.co').href));if(reminder.kind==='validation')assert.ok(msg.includes(reminder.player));}
});
test('an open validation reminder closes when responsibility, revision or card state changes',()=>{
 const {PersonalLeagueValidation}=load('src/components/personal/PersonalLeagueValidation');const {LeagueReminderDialog}=load('src/components/personal/LeagueReminderDialog');const {leagueValidationQueue}=load('src/lib/leagueValidationQueue');const state=React.useState;const d=validationLeague();const key=leagueValidationQueue(d,'owner')[0].key;
 function dialog(data){let index=0;try{React.useState=v=>[index++===0?key:'https://app.mulliganclub.co',()=>{}];const tree=PersonalLeagueValidation({data,userId:'owner'});let found=false;function visit(n){if(!n||typeof n!=='object')return;if(n.type===LeagueReminderDialog)found=true;React.Children.forEach(n.props?.children,visit)}visit(tree);return found}finally{React.useState=state}}
 assert.equal(dialog(d),true);d.submissions[0].card_status='pending_player_confirmation';assert.equal(dialog(d),false);d.submissions[0].card_status='pending_validation';d.submissions[0].revision_number=2;assert.equal(dialog(d),false);d.submissions[0].revision_number=1;d.submissions[0].status='accepted';assert.equal(dialog(d),false);
});
for(const count of [9,18])test(`${count}: correction keyboard returns to review after one changed hole; incomplete cards still focus the missing score`,()=>{
 const {QuickScoreEntry}=load('src/components/personal/QuickScoreEntry');const originalRef=React.useRef;const holes=receivedCard(count).holes.map((h,i)=>i?h:{...h,strokes:4});let done=0,focused=0;
 const inputs=new Map([[1,{blur(){}}],[2,{focus(){focused++},select(){},scrollIntoView(){}}],[count,{focus(){focused++},scrollIntoView(){}}]]);
 const find=(n,p)=>{if(!n||typeof n!=='object')return null;if(p(n))return n;for(const c of React.Children.toArray(n.props?.children)){const hit=find(c,p);if(hit)return hit}return null};
 try{React.useRef=()=>({current:inputs});const props={references:receivedCard(count).reference_holes,holes,original:receivedCard(count).holes,reviewing:true,disabled:false,onChange(){},onDone(){done++}};
 let tree=QuickScoreEntry(props);const input=find(tree,n=>n.type==='input');assert.equal(input.props.enterKeyHint,'done');input.props.onKeyDown({key:'Enter',preventDefault(){}});assert.equal(done,1);assert.equal(focused,0);
 const missing=holes.map((h,i)=>i===count-1?{...h,completion:'not_played',strokes:null}:h);tree=QuickScoreEntry({...props,holes:missing});find(tree,n=>n.type==='input').props.onKeyDown({key:'Enter',preventDefault(){}});assert.equal(done,1);assert.equal(focused,1);
 }finally{React.useRef=originalRef}
});
for(const language of ['fr','en'])for(const count of [9,18])test(`${language} ${count}: correction review shows exact changes and explains each blocked step`,()=>{
 locale=language;const {PersonalRoundEditor}=load('src/components/personal/PersonalRoundEditor');const dict=load('src/lib/i18n/dictionaries').dictionaries[language],data=receivedCard(count);const original={state:React.useState,effect:React.useEffect,ref:React.useRef};
 const changes=data.holes.map((h,i)=>i===count-1?{...h,strokes:4}:h);let index=0,values={5:true};mockedDraft={online:true,ready:true,state:{status:'saved',holes:data.holes}};
 const html=()=>{index=0;return renderToStaticMarkup(PersonalRoundEditor({data,onReload:async()=>{}}))};
 try{React.useEffect=()=>{};React.useRef=v=>({current:v});React.useState=v=>{const i=index++;return[i in values?values[i]:typeof v==='function'?v():v,()=>{}]};
 assert.ok(html().includes(dict['validation.needChange']));values[0]=changes;let rendered=html();assert.ok(rendered.includes(dict['validation.needReason']));assert.ok(rendered.includes(dict['validation.changes'].replace('{n}','1')));assert.ok(rendered.includes(`>${count}</span>`));assert.ok(rendered.includes('→'));assert.ok(rendered.includes('>4</strong>'));
 values[4]='One extra stroke';assert.ok(html().includes(dict['validation.needPresence']));values[3]=true;assert.ok(html().includes(dict['validation.correctionReady']));
 const invalid=changes.map((h,i)=>i? h:{...h,strokes:null,completion:'not_played'});values[0]=invalid;assert.ok(html().includes(dict['personal.incomplete']));
 }finally{React.useState=original.state;React.useEffect=original.effect;React.useRef=original.ref;mockedDraft=undefined}
});
for(const automatic of [false,true])test(automatic?'an elapsed timer reports automatic validation without claiming a correction was sent':'lost validation acknowledgement reloads current state and never claims approval',async()=>{
 locale='fr';const {PersonalRoundEditor}=load('src/components/personal/PersonalRoundEditor'),dict=load('src/lib/i18n/dictionaries').dictionaries.fr;const original={state:React.useState,effect:React.useEffect,ref:React.useRef};const data=receivedCard(9);let index=0,states=[],reloads=0,calls=0;
 const find=(n,p)=>{if(!n||typeof n!=='object')return null;if(p(n))return n;for(const c of React.Children.toArray(n.props?.children)){const hit=find(c,p);if(hit)return hit}return null};
 try{React.useEffect=()=>{};React.useRef=v=>({current:v});React.useState=v=>{const i=index++;if(!(i in states))states[i]=i===3?true:typeof v==='function'?v():v;return[states[i],value=>states[i]=value]};mockedDraft={online:true,ready:true,state:{status:'saved',holes:data.holes}};mockedRpc=async()=>{calls++;if(automatic)return {data:{success:true,automatic:true},error:null};throw Error('lost acknowledgement')};
 const tree=PersonalRoundEditor({data,onReload:async()=>{reloads++}});find(tree,n=>n.type==='button'&&n.props.children===dict['validation.approve']).props.onClick();await new Promise(setImmediate);assert.equal(calls,1);assert.equal(reloads,1);assert.equal(states[9],automatic?dict['validation.autoApproved']:null);assert.equal(states[8],automatic?null:dict['validation.retry']);
 }finally{React.useState=original.state;React.useEffect=original.effect;React.useRef=original.ref;mockedDraft=undefined;mockedRpc=undefined}
});
for(const language of ['fr','en'])for(const count of [9,18])test(`${language} ${count}: correction consequences precede both choices and only changed holes are shown`,()=>{
 locale=language;const {PersonalCorrectionDecision}=load('src/components/personal/PersonalCorrectionDecision');const dict=load('src/lib/i18n/dictionaries').dictionaries[language];const d=correctedPlayerCard(count);d.events=[{action:'correction_proposed',actor_name:'QA Witness'}];
 const html=renderToStaticMarkup(React.createElement(PersonalCorrectionDecision,{data:d,online:true,busy:false,onBusyChange(){},onReload:async()=>{},onResolved(){}}));
 assert.ok(html.includes(dict['correction.proposedBy'].replace('{name}','QA Witness')));assert.ok(html.includes(dict['validation.changes'].replace('{n}','1')));
 assert.ok(html.indexOf(dict['correction.acceptNotice'])<html.indexOf('>'+dict['correction.accept']+'</button>'));assert.ok(html.indexOf(dict['correction.refusalHint'])<html.indexOf('>'+dict['correction.refuse']+'</button>'));
 assert.ok(html.includes('>5</span><strong>6</strong>'));assert.ok(!html.includes('>2</span><span>5</span>'),'unchanged hole2 must stay out of the decision comparison');
});
for(const accept of [true,false])test(`${accept?'accept':'refuse'} confirmation retains exact changed scores and closes immediately for a newer revision`,()=>{
 const h=playerDecisionHarness();try{h.setData(correctedPlayerCard(18));h.button(h.render(),accept?'Accepter et valider':'Refuser la correction').props.onClick();let modal=h.modal(h.render());assert.equal(modal.props.open,true);assert.equal(modal.props.focusTitle,true);
 const html=renderToStaticMarkup(React.createElement('div',null,modal.props.children));assert.ok(html.includes('Trous modifiés · 1'));assert.ok(html.includes('>5</span><strong>6</strong>'));assert.ok(html.includes('Révision 2'));
 const newer=correctedPlayerCard(18);newer.revision={...newer.revision,id:'newer'};h.setData(newer);modal=h.modal(h.render());assert.equal(modal.props.open,false);modal.props.onConfirm();assert.equal(h.calls.length,0);
 }finally{h.close()}
});
test('pending correction focuses on the decision; league submission returns after validation',()=>{
 locale='fr';const {PersonalRoundEditor}=load('src/components/personal/PersonalRoundEditor');const d=correctedPlayerCard(9);mockedDraft={online:true,ready:true,state:{status:'saved',holes:d.holes}};
 try{let html=renderToStaticMarkup(React.createElement(PersonalRoundEditor,{data:d,onReload:async()=>{}}));assert.ok(!html.includes('id="card-league-submission"'));
 html=renderToStaticMarkup(React.createElement(PersonalRoundEditor,{data:{...d,round:{...d.round,status:'validated'}},onReload:async()=>{}}));assert.ok(html.includes('id="card-league-submission"'));
 }finally{mockedDraft=undefined}
});
test('long correction confirmation starts at its title, traps keyboard focus and restores the previous action',()=>{
 const {ConfirmModal}=load('src/components/ConfirmModal');const saved={effect:React.useEffect,ref:React.useRef,id:React.useId,document:global.document};const effects=[];let index=0,headingFocus=0,cancelFocus=0,confirmFocus=0,restored=0,cancelled=0,keyHandler;
 const heading={focus(){headingFocus++;document.activeElement=heading}},cancel={focus(){cancelFocus++;document.activeElement=cancel}},confirm={focus(){confirmFocus++;document.activeElement=confirm}},previous={focus(){restored++}};const refs=[{querySelectorAll:()=>[confirm,cancel]},heading,cancel];
 try{global.document={activeElement:previous,addEventListener:(name,fn)=>{keyHandler=fn},removeEventListener(){}};React.useEffect=fn=>effects.push(fn);React.useRef=()=>({current:refs[index++]});React.useId=()=> 'correction-dialog';
 ConfirmModal({open:true,title:'Correction',focusTitle:true,onCancel(){cancelled++},onConfirm(){}});const restore=effects[0]();effects[1]();assert.equal(headingFocus,1);assert.equal(cancelFocus,0);keyHandler({key:'Tab',shiftKey:true,preventDefault(){}});assert.equal(cancelFocus,1);keyHandler({key:'Tab',shiftKey:false,preventDefault(){}});assert.equal(confirmFocus,1);keyHandler({key:'Escape'});assert.equal(cancelled,1);restore();assert.equal(restored,1);
 }finally{React.useEffect=saved.effect;React.useRef=saved.ref;React.useId=saved.id;global.document=saved.document}
});
test('pending correction keeps affected-league status without offering new submissions',()=>{
 locale='fr';const {PersonalLeagueSubmission}=load('src/components/personal/PersonalLeagueSubmission');const d=correctedPlayerCard(9);d.leagues=[{id:'already',name:'Existing group',submission_status:'pending'},{id:'new',name:'Another group'}];
 const html=renderToStaticMarkup(React.createElement(PersonalLeagueSubmission,{data:d,online:true,busy:false,onBusyChange(){},onReload:async()=>{}}));assert.ok(html.includes('Ligues concernées'));assert.ok(html.includes('Existing group'));assert.ok(html.includes('href="/games/already"'));assert.ok(html.includes('En attente de confirmation du joueur'));assert.ok(!html.includes('type="checkbox"'));assert.ok(!html.includes('Another group'));assert.ok(!html.includes('role="dialog"'));
});
function correctionOutcomeLeague(required=1,format='stroke_net'){
 const d=groupLeague();d.game.scoring_cards_count=required;d.game.name='Correction Cup';d.rules.format=format;d.board=[{user_id:'owner',player_name:'Organizer',rounds_counted:0,rounds_played:0,total_score:0},{user_id:'friend',player_name:'Friend',rounds_counted:Math.min(required,2),rounds_played:2,total_score:format==='stableford_net'?(required===1?30:50):(required===1?10:30)}];
 const card=(id,score,status='accepted',card_status='validated',revision_number=2)=>({id,round_id:`10000000-0000-4000-8000-${String(id.charCodeAt(0)).padStart(12,'0')}`,user_id:'friend',player_name:'Friend',played_on:'2026-10-18',status,card_status,revision_number,gross_total:score,net_total:score,stableford_points:40-score});
 d.submissions=[card('a',10),card('b',20),card('c',5,'rejected','disputed'),card('old',1,'superseded','validated',1)];d.organizer_progress={awaiting_join:[]};return d;
}
for(const format of ['stroke_gross','stroke_net','stableford_net'])test(`${format}: correction acceptance distinguishes counted, reserve and excluded cards`,()=>{
 const {leagueCorrectionResults}=load('src/lib/leagueCorrectionResults');const d=correctionOutcomeLeague(1,format);let results=leagueCorrectionResults(d);assert.deepEqual(results.map(r=>[r.card.id,r.contribution]),[['a','counted'],['b','reserve'],['c','excluded']]);assert.equal(results[2].remaining,0);
 d.board[1].total_score++;results=leagueCorrectionResults(d);assert.equal(results[0].contribution,'accepted');assert.equal(results[1].contribution,'accepted','unreconciled totals must never invent best-card attribution');
});
test('refused corrections remain actionable when another card counts but the quota is incomplete',()=>{
 const {leagueGroupProgress}=load('src/lib/leagueGroupProgress'),{leagueReminders}=load('src/lib/leagueReminders'),{leagueCorrectionResults}=load('src/lib/leagueCorrectionResults');const d=correctionOutcomeLeague(3);
 assert.equal(leagueGroupProgress(d,'owner').members[1].status,'replace');assert.equal(leagueGroupProgress(d,'owner').members[1].remaining,1);let reminders=leagueReminders(d,'owner','2026-10-18');assert.equal(reminders.length,1);assert.equal(reminders[0].kind,'replace');assert.equal(reminders[0].id,'friend');assert.equal(reminders[0].path,'/join/ABC123?reminder=card');
 d.submissions.push({...d.submissions[0],id:'new',round_id:'10000000-0000-4000-8000-000000000111',revision_number:1,status:'pending',card_status:'pending_validation',validator_id:'owner'});assert.equal(leagueGroupProgress(d,'owner').members[1].status,'pending');assert.equal(leagueCorrectionResults(d).find(r=>r.refused).pending,true);assert.equal(leagueReminders(d,'owner','2026-10-18').length,0);
 d.submissions.at(-1).status='accepted';d.submissions.at(-1).card_status='validated';d.board[1].rounds_counted=3;assert.equal(leagueGroupProgress(d,'owner').members[1].status,'counted');assert.equal(leagueReminders(d,'owner','2026-10-18').length,0);
});
test('partial quota without refusal remains visible; closed entry and self never get replacement reminders',()=>{
 const {leagueGroupProgress}=load('src/lib/leagueGroupProgress'),{leagueReminders}=load('src/lib/leagueReminders');const d=correctionOutcomeLeague(3);d.submissions=d.submissions.filter(s=>s.id!=='c');assert.equal(leagueGroupProgress(d,'owner').members[1].status,'more');assert.equal(leagueReminders(d,'owner','2026-10-18').length,0);
 const refused=correctionOutcomeLeague(3);assert.equal(leagueReminders(refused,'friend','2026-10-18').length,1,'only the other missing player may be reminded');assert.ok(!leagueReminders(refused,'friend','2026-10-18').some(r=>r.kind==='replace'));
 for(const status of ['closed_provisional','finalized'])assert.deepEqual(leagueReminders({...refused,closure_status:status},'owner','2026-10-18'),[]);
});
for(const language of ['fr','en'])test(`${language}: organizer outcomes show decisions, actual contributions and authorized in-league card anchors`,()=>{
 locale=language;const {PersonalLeagueCorrectionResults}=load('src/components/personal/PersonalLeagueCorrectionResults');const dict=load('src/lib/i18n/dictionaries').dictionaries[language];const d=correctionOutcomeLeague(3);let html=renderToStaticMarkup(React.createElement(PersonalLeagueCorrectionResults,{data:d}));
 assert.ok(html.includes(dict['correctionResults.accepted']));assert.ok(html.includes(dict['correctionResults.refused']));assert.ok(html.includes(dict['standings.contribution.counted']));assert.ok(html.includes(dict['standings.contribution.excluded']));assert.ok(html.includes('href="#league-card-c"'));assert.ok(!html.includes('href="/rounds/'));assert.ok(!html.includes('league-card-old'));assert.ok(html.includes(dict['correctionResults.replace'].replace('{n}','1')));
 html=renderToStaticMarkup(React.createElement(PersonalLeagueCorrectionResults,{data:{...d,closure_status:'finalized'}}));assert.ok(html.includes(dict['correctionResults.closed']));assert.ok(!html.includes(dict['correctionResults.replace'].replace('{n}','1')));
 assert.equal(renderToStaticMarkup(React.createElement(PersonalLeagueCorrectionResults,{data:{...d,organizer_progress:null}})),'');
});
