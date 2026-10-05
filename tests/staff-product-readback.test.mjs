import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {test} from 'node:test';
import {STAFF_SELECTS, mentionsForbiddenField} from '../lib/supabase/staff-schema.ts';
function load(path,mocks){const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const sandboxModule={exports:{}};vm.runInNewContext(code,{module:sandboxModule,exports:sandboxModule.exports,require:p=>mocks[p]??{},console,Date,Number,Map,Set,File,crypto});return sandboxModule.exports;}
test('creation read-back returns actual stock and staff-safe fields only for its creator',async()=>{
 const row={id:'product',name:'Guardado',category_id:null,is_public:false,is_active:true,catalog_type:'IMMEDIATE',product_kind:'SIMPLE',created_by_admin_id:'staff',in_transit:false,product_variants:[{id:'variant',name:'Único',price_cents:110000,is_active:true,unit_label:null}],product_images:[{storage_key:'photo.jpg',sort_order:0}]};
 const reads=[];
 const db={from(table){const filters=[];const q={select(columns){reads.push({table,columns});return q},eq(key,value){filters.push([key,value]);return q},async maybeSingle(){return {data:filters.every(([key,value])=>row[key]===value)?row:null,error:null}}};return q;}};
 const api=load('lib/supabase/staff-inventory.ts',{'./business':{adminDb:()=>db},'./staff-schema':{STAFF_SELECTS},'./admin-catalog':{getStockFor:async()=>new Map([['variant',3]]),productImageUrl:key=>key}});
 const product=await api.readCreatedStaffProduct('product','staff');assert.equal(product.stock,3);assert.equal(product.imageUrl,'photo.jpg');assert.equal(product.variants[0].priceCents,110000);assert.deepEqual(mentionsForbiddenField(JSON.stringify(product)),[]);assert.equal(reads[0].columns,STAFF_SELECTS.products);
 assert.equal(await api.readCreatedStaffProduct('product','other'),undefined);
});
test('a failed read-back still confirms the committed product instead of inviting duplicate creation',async()=>{
 let creations=0;
 const api=load('app/empleado/actions.ts',{'next/cache':{revalidatePath(){}},'../../lib/actions':{failure:error=>({error,success:null}),describeError:e=>e.message},'../../lib/format':{parseMoneyToCents:s=>Number(s)*100},'../../lib/supabase/business':{requireStaffActor:async()=>({id:'staff'})},'../../lib/supabase/staff-inventory':{createStaffProduct:async()=>{creations++;return {ok:true,productId:'committed',message:'Guardado'}},readCreatedStaffProduct:async()=>{throw Error('Read unavailable')}}});
 const data=new FormData();data.set('name','Guardado');data.set('variantName','Único');data.set('variantPrice','100');data.set('variantQuantity','1');
 const result=await api.createStaffProductAction({error:null,success:null},data);assert.equal(creations,1);assert.equal(result.productId,'committed');assert.equal(result.error,null);assert.match(result.success,/Actualiza el inventario/);
});

