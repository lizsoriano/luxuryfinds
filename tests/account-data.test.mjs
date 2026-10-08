import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {test} from 'node:test';
function load(mocks){const code=ts.transpileModule(fs.readFileSync('lib/supabase/account.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;const exports={};vm.runInNewContext(code,{exports,require:name=>mocks[name],String});return exports;}
for(const ids of [['own-ticket'],[]])test('payment reads are confined to session-visible tickets '+JSON.stringify(ids),async()=>{
 const reads=[];
 const db={from(table){assert.notEqual(table,'payments');const query={select(){return query;},order(){return query;},then(resolve){return Promise.resolve({data:table==='tickets'?ids.map(id=>({id})):[],error:null}).then(resolve);}};return query;}};
 const api=load({'./auth':{getClientProfile:async()=>({user:{id:'verified-client'},profile:{id:'verified-client'},supabase:{schema:()=>db}})},'./incoming-reservations':{getClientReservations:async()=>[]},'./sales':{related:async(table,select,column,scope)=>{reads.push({table,column,scope});return [];},getSaleItemFulfillment:async()=>({rows:[]})}});
 const data=await api.getAccountData();const paymentRead=reads.find(row=>row.table==='payments');assert.equal(paymentRead.column,'ticket_id');assert.equal(JSON.stringify(paymentRead.scope),JSON.stringify(ids));assert.equal(data.payments.length,0);assert.equal(reads.find(row=>row.table==='sales').scope[0],'verified-client');
});
