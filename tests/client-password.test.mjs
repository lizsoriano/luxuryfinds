import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

function load(path, mocks) {
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exports = {};
  runInNewContext(code, {exports, require:(name) => {if (!(name in mocks)) throw Error('Unmocked import: '+name); return mocks[name];}, String, crypto});
  return exports;
}
const form = (values) => {const data = new FormData(); for(const [k,v] of Object.entries(values)) data.set(k,v); return data;};
function login(options={}) {
  const calls=[];
  const admin={schema:()=>({from:(table)=>({select:()=>({eq:(_key,value)=>({maybeSingle:async()=> {
    calls.push([table,value]);
    return table==='clients' ? {data:options.missing?null:{id:'client',status:options.status??'ACTIVE'},error:null} : {data:options.staff?{id:'client'}:null,error:options.staffError?{}:null};
  }})})})}),auth:{admin:{getUserById:async()=>({data:{user:{email:options.noEmail?null:'identity@example.com'}},error:null})}}};
  const server={auth:{signInWithPassword:async(credentials)=>{calls.push(['signIn',credentials]);return {error:options.wrong?{}:null};}}};
  return {calls,action:load('app/(public)/login/actions.ts', {
    'next/navigation':{redirect:(path)=>{throw Error('redirect:'+path);}},
    '../../../lib/supabase/admin':{createAdminSupabaseClient:()=>admin},
    '../../../lib/supabase/auth':{isActiveEmployeeAccount:async()=>false},
    '../../../lib/supabase/server':{createServerSupabaseClient:async()=>server},
    '../../../lib/supabase/staff-roles':{staffLandingPath:()=>'/empleado'},
  }).phoneLoginAction};
}
test('cellular alone never authenticates',async()=>{const h=login();assert.ok((await h.action({},form({phone:'123'}))).error);assert.equal(h.calls.length,0);});
test('correct password uses existing Auth email, preserves password and safe redirect',async()=>{const h=login();await assert.rejects(h.action({},form({phone:'612 147-8637',password:'chosen-password',next:'//evil.test'})),/redirect:\/cuenta/);assert.equal(h.calls[0][1],'6121478637');assert.equal(h.calls.at(-1)[1].email,'identity@example.com');assert.equal(h.calls.at(-1)[1].password,'chosen-password');});
for(const options of [{missing:true},{status:'INACTIVE'},{status:'BLOCKED'},{staff:true},{staffError:true},{noEmail:true}]) test('refuses '+JSON.stringify(options),async()=>{const h=login(options);assert.ok((await h.action({},form({phone:'123',password:'password'}))).error);assert.ok(!h.calls.some(c=>c[0]==='signIn'));});
test('wrong password is refused',async()=>{const h=login({wrong:true});assert.ok((await h.action({},form({phone:'123',password:'wrong'}))).error);});
function change(options={}) {
  let updates=0;
  const action=load('app/cuenta/password-actions.ts',{
    '../../lib/actions':{failure:(error)=>({error,success:null}),ok:(success)=>({error:null,success})},
    '../../lib/supabase/auth':{getClientProfile:async()=>({profile:{status:options.status??'ACTIVE'},user:{id:'client',email:'identity@example.com'},supabase:{auth:{signInWithPassword:async()=>({error:options.wrong?{}:null,data:{user:{id:'client'}}}),updateUser:async()=>{updates++;return {error:null};}}}})},
  }).changePasswordAction;
  return {action,updates:()=>updates};
}
test('change rejects mismatch, short password and wrong current password',async()=>{for(const [options,fields] of [[{}, {password:'short',confirmation:'short'}],[{}, {confirmation:'different'}],[{wrong:true},{}],[{status:'BLOCKED'},{}]]){const h=change(options);assert.ok((await h.action({},form({currentPassword:'old-password',password:'new-password',confirmation:'new-password',...fields}))).error);assert.equal(h.updates(),0);}});
test('authenticated client changes own password',async()=>{const h=change();assert.ok((await h.action({},form({currentPassword:'old-password',password:'new-password',confirmation:'new-password'}))).success);assert.equal(h.updates(),1);});
function reset(options={}) {
  const updates=[], logs=[];
  const db={from:(table)=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:table==='clients'?{id:'client'}:options.staff?{id:'client'}:null,error:null})})})})};
  const action=load('app/admin/clientes/actions.ts',{
    'next/cache':{revalidatePath:()=>{}},
    '../../../lib/actions':{failure:(error)=>({error,success:null}),ok:(success)=>({error:null,success}),describeError:()=>''},
    '../../../lib/supabase/client-access':{clientAccessEmail:(id)=>`client-${id}@access.luxuryfinds.invalid`},
    '../../../lib/supabase/admin':{createAdminSupabaseClient:()=>({auth:{admin:{getUserById:async()=>({data:{user:{email:options.email??null}},error:null}),updateUserById:async(id,data)=>{updates.push({id,...data});return {error:null};}}}})},
    '../../../lib/supabase/business':{requireAdminActor:async()=>{if(options.unauthorized)throw Error('unauthorized');return {id:'owner'};},adminDb:()=>db,logActivity:async(data)=>logs.push(data)},
  }).setClientPasswordAction;
  return {action,updates,logs};
}
test('password assignment requires owner and excludes staff accounts',async()=>{for(const options of [{unauthorized:true},{staff:true}]){const h=reset(options);assert.ok((await h.action({},form({id:'client',password:'initial-password'}))).error);assert.equal(h.updates.length,0);}});
test('existing phone-only client gets stable Auth identity; password is not logged',async()=>{const h=reset();assert.ok((await h.action({},form({id:'client',password:'initial-password'}))).success);assert.equal(h.updates[0].email,'client-client@access.luxuryfinds.invalid');assert.ok(!JSON.stringify(h.logs).includes('initial-password'));});
test('password reset preserves existing email identity',async()=>{const h=reset({email:'existing@example.com'});assert.ok((await h.action({},form({id:'client',password:'initial-password'}))).success);assert.ok(!('email' in h.updates[0]));});
