const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'../..');let locale='fr';let mockedDraft;const cache=new Map();
function load(relative){let file=path.join(root,relative);if(!path.extname(file))file+=fs.existsSync(file+'.tsx')?'.tsx':'.ts';if(cache.has(file))return cache.get(file);const m=new Module(file,module);m.paths=module.paths;m.require=name=>{
 if(name==='@/lib/supabase')return{supabase:{}};
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
 const originalState=React.useState,originalEffect=React.useEffect;
 try {React.useEffect=()=>{};
  for(const scenario of [{status:'saved',online:true,ready:true,allowed:true},{status:'saved',online:true,ready:false},...['offline','conflict','blocked','session','invalid','storageError'].map(status=>({status,online:true,ready:true})),{status:'saved',online:false,ready:true}]){
   let opened=false,flushed=0,index=0;
   React.useState=initial=>{const current=index++;return[typeof initial==='function'?initial():initial,value=>{if(current===1&&value===true)opened=true}]};
   mockedDraft={ready:true,online:scenario.online,state:{status:scenario.status,holes:scores},flush:async()=>{flushed++;return 1}};
   const tree=PersonalRoundEditor({data:{...base,tee:{...base.tee,ready:scenario.ready}},onReload:async()=>{}});let entry,modal;
   function visit(node){if(!node||typeof node!=='object')return;if(node.type===QuickScoreEntry)entry=node;if(node.type===ConfirmModal)modal=node;React.Children.forEach(node.props?.children,visit)}visit(tree);
   assert.ok(entry&&modal);entry.props.onDone();assert.equal(opened,!!scenario.allowed,JSON.stringify(scenario));assert.equal(modal.props.confirmDisabled,!scenario.allowed);
   if(!scenario.allowed){modal.props.onConfirm();assert.equal(flushed,0,'blocked keyboard or modal must not save/confirm');}
  }
 }finally{React.useState=originalState;React.useEffect=originalEffect;mockedDraft=undefined}
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
