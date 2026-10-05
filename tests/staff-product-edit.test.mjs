import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {test} from 'node:test';

function fixture({owner='staff',published=false,stockFailure=false}={}) {
 const writes=[];
 const product={id:'product',name:'Anterior',category_id:null,created_by_admin_id:owner,is_public:published,catalog_type:'IMMEDIATE',is_active:true};
 const variant={id:'variant',is_active:true,products:{...product,product_kind:'SIMPLE'}};
 const db={from(table){let change;const query={select(){return query},eq(){return query},update(value){change=value;return query},async maybeSingle(){if(change)writes.push({table,...change});return {data:product,error:null}},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve)}};return query}};
 const mocks={
  '../actions':{describeError:e=>e.message},'../format':{slugify:s=>s},
  './admin-catalog':{updateVariantQuick:async input=>{writes.push(input);return input.field==='stock'&&stockFailure?{ok:false,error:'Stock bloqueado'}:{ok:true}},getStockFor:async()=>new Map()},
  './business':{adminDb:()=>db,logActivity:async input=>writes.push({log:input}),MAX_PRODUCT_IMAGES:3},
  './in-transit':{},'./staff-schema':{STAFF_SELECTS:{categories:'id,name'}}
 };
 // Run the real backend module with an in-memory PostgREST adapter.
 const source=fs.readFileSync('lib/supabase/staff-inventory.ts','utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const testModule={exports:{}};
 vm.runInNewContext(code,{module:testModule,exports:testModule.exports,require:path=>mocks[path]??{},console,Date,Number,Map,Set,crypto});
 // Supply the reduced relation and category queries used by the functions.
 db.from=table=>{let change;const query={select(){return query},eq(){return query},in(){return query},order(){return query},update(value){change=value;return query},async maybeSingle(){if(change)writes.push({table,...change});return {data:table==='product_variants'?variant:product,error:null}},then(resolve){if(change)writes.push({table,...change});return Promise.resolve({data:table==='categories'?[{id:'category',name:'Perfumes'}]:table==='products'?[product]:[],error:null}).then(resolve)}};return query};
 return {api:testModule.exports,writes};
}
const metadata={adminId:'staff',productId:'product',name:'Nuevo nombre',categoryId:'category'};
const variant={adminId:'staff',variantId:'variant',name:'Único',priceCents:25000,quantity:3};

test('refuses editing another employee or published product without writes',async()=>{
 for(const options of [{owner:'other'},{published:true}]){const f=fixture(options);assert.equal((await f.api.editStaffProduct(metadata)).ok,false);assert.equal((await f.api.editStaffVariant(variant)).ok,false);assert.equal(f.writes.length,0);}
});
test('validates fields before writing inventory',async()=>{
 const f=fixture();assert.equal((await f.api.editStaffProduct({...metadata,name:' '})).ok,false);
 for(const input of [{...variant,priceCents:0},{...variant,quantity:-1},{...variant,quantity:1.5}])assert.equal((await f.api.editStaffVariant(input)).ok,false);
 assert.equal(f.writes.length,0);
});
test('edits names and category and uses the existing stock ledger writer',async()=>{
 const f=fixture();assert.equal((await f.api.editStaffProduct(metadata)).ok,true);assert.equal((await f.api.editStaffVariant(variant)).ok,true);
 assert.ok(f.writes.some(row=>row.table==='products'&&row.name==='Nuevo nombre'&&row.category_id==='category'));
 assert.ok(f.writes.some(row=>row.field==='price'&&row.value===25000));assert.ok(f.writes.some(row=>row.field==='stock'&&row.value===3));
});
test('reports a partial stock failure explicitly',async()=>{const f=fixture({stockFailure:true});const result=await f.api.editStaffVariant(variant);assert.equal(result.ok,false);assert.match(result.error,/Nombre y precio guardados/);});



test('quick stock and price edit only their own field',async()=>{
 for(const field of ['price','stock']){const f=fixture();const result=await f.api.updateStaffInventoryField({adminId:'staff',variantId:'variant',field,value:field==='price'?35000:5});assert.equal(result.ok,true);assert.equal(f.writes.filter(row=>row.field).length,1);assert.equal(f.writes.find(row=>row.field).field,field);}
});
test('quick editing, duplicate and archive reject products outside employee scope',async()=>{
 for(const options of [{owner:'other'},{published:true}]){const f=fixture(options);assert.equal((await f.api.updateStaffInventoryField({adminId:'staff',variantId:'variant',field:'stock',value:5})).ok,false);assert.equal((await f.api.duplicateStaffProduct('staff','product')).ok,false);assert.equal((await f.api.archiveStaffProducts('staff',['product'])).ok,false);assert.equal(f.writes.length,0);}
});
test('archiving preserves data and only deactivates owned hidden products',async()=>{
 const f=fixture();assert.equal((await f.api.archiveStaffProducts('staff',['product'])).ok,true);assert.ok(f.writes.some(row=>row.table==='products'&&row.is_active===false));assert.equal(f.writes.some(row=>row.field),false);
});
