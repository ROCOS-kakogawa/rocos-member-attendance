const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function harness(initial = {}) {
  const storage = new Map(Object.entries(initial));
  const element = { value: '', textContent: '' };
  const context = vm.createContext({ console: {error(){}}, Intl, URL, AbortController,
    localStorage: {getItem:k=>storage.get(k) || null,setItem:(k,v)=>storage.set(k,v)},
    document: {querySelector:()=>element,hidden:false},
    window: {ROCO_CLOUD_CONFIG:{supabaseUrl:'https://example.test',supabaseAnonKey:'test'},
      ROCO_MEMBER_SEED: {users:[{id:'one',name:'Member'}]},setTimeout,clearTimeout},
    fetch: async()=>({ok:false,status:504}) });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'app.js'),'utf8').replace('init();',''),context);
  vm.runInContext('render = () => {}; setupCloud();',context);
  return {context,storage,run:code=>vm.runInContext(code,context)};
}
(async()=>{
  const h=harness();
  await h.run('loadState().then(value => {state=value})');
  assert.equal(h.run('state.users.length'),1,'file startup falls back without fetching JSON');
  await h.run('patchState(next => {next.attendance["day_one"]={status:"出勤",start:"09:00"}})');
  assert.equal(JSON.parse(h.storage.get('rocos-member-attendance-cache')).attendance.day_one.start,'09:00');
  assert.ok(JSON.parse(h.storage.get('rocos-member-attendance-pending-v1')).length,'failed cloud retains journal');
  const reopened=harness(Object.fromEntries(h.storage));
  await reopened.run('loadState().then(value=>{state=value})');
  assert.equal(reopened.run('state.attendance.day_one.start'),'09:00','restart retains edit');
  let remote={taskCounts:{keep:7},users:[{id:'one',name:'Member'},{id:'two',name:'Other'}],attendance:{day_two:{start:'10:00'}}};
  reopened.context.fetch=async(url,options)=>{
    if(options.method==='PATCH') {remote=JSON.parse(options.body).data;return {ok:true,json:async()=>[{updated_at:'new'}]};}
    return {ok:true,json:async()=>[{data:remote,updated_at:'old'}]};
  };
  await reopened.run('flushPendingChanges()');
  assert.equal(remote.attendance.day_one.start,'09:00');
  assert.equal(remote.attendance.day_two.start,'10:00','other device records retained');
  assert.equal(remote.users.length,2,'current cloud members retained');
  assert.equal(remote.taskCounts.keep,7,'other admin data retained');
  assert.equal(reopened.run('pendingChanges.length'),0,'successful save clears journal');
  await reopened.run('patchState(next=>{delete next.attendance.day_one})');
  assert.equal(remote.attendance.day_one,undefined,'deletion syncs');
  assert.ok(remote.attendance.day_two);
  const timeout=harness();
  timeout.context.window.setTimeout=fn=>setTimeout(fn,1);
  timeout.context.fetch=(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('timeout'))));
  await assert.rejects(timeout.run('cloudRequest("data")'),/timeout/,'hung request terminates');
  const stale=harness({'rocos-member-attendance-cache':JSON.stringify({attendance:{}}),'rocos-member-attendance-pending-v1':JSON.stringify([{path:['attendance','saved'],value:{start:'08:00'}}])});
  await stale.run('loadState().then(value=>{state=value})');
  assert.equal(stale.run('state.attendance.saved.start'),'08:00','journal recovers stale cache');
  console.log('PASS: startup, 504 fallback, local save, restart, merge, deletion, timeout and journal recovery');
})().catch(error=>{console.error(error);process.exitCode=1});
