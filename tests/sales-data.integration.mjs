// Exercises real loaders/actions with an in-memory PostgREST adapter; never contacts Supabase.
import assert from "node:assert/strict";
import { build } from "rolldown";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const root = process.cwd();
await mkdir(".tmp", { recursive: true });
const adapter = `
export const ID='10000000-0000-4000-8000-000000000001';
export const ORDER='20000000-0000-4000-8000-000000000001';
export const CLIENT='30000000-0000-4000-8000-000000000001';
export const ITEM='40000000-0000-4000-8000-000000000001';
export const TICKET='50000000-0000-4000-8000-000000000001';
export const state={requests:[],logs:[],authorized:true,missing:false,missingFulfillment:false,revokeAtEnd:false,linkReads:0};
export const tables={
sales:[{id:ID,sale_number:'TEMP-VD',sold_at:'2026-10-07T18:00:00Z',client_id:null,status:'COMPLETED',concept:'TEMP',sale_type:'PRODUCT',payment_method:'CASH',subtotal_cents:1000,discount_cents:0,total_cents:1000,notes:'private-note',cancelled_at:null}],
sale_items:[{id:ID,sale_id:ID,product_id:null,quantity:1,unit_price_cents:1000,total_cents:1000,product_name_snapshot:'Labial',variant_name_snapshot:null,sku_snapshot:null}],
orders:[{id:ORDER,client_id:CLIENT,status:'CONFIRMED',created_at:'2026-10-06T18:00:00Z',origin:'ADMIN_MANUAL',internal_notes:'private-note',confirmed_at:'2026-10-06T18:00:00Z',cancelled_at:null,requested_number_of_weeks:4}],
order_items:[{id:ITEM,order_id:ORDER,product_id:null,variant_id:null,quantity:1,unit_price_cents:10000,products:null,product_variants:null}],
clients:[{id:CLIENT,first_name:'María Elena',last_name:'PRIVATE-LAST',phone:'PRIVATE-PHONE',email:'PRIVATE-EMAIL',address:'PRIVATE-ADDRESS'}],
tickets:[{id:TICKET,order_item_id:ITEM,ticket_number:'TEMP-T',product_name_snapshot:'Shopper perfume',variant_name_snapshot:'50 ml',financial_status:'PARTIALLY_PAID',logistics_status:'IN_TRANSIT',agreed_total_cents:10000,paid_principal_cents:2500,created_at:'2026-10-06T18:00:00Z',updated_at:'2026-10-07T18:00:00Z',image_storage_key_snapshot:null}],
payments:[{id:ID,ticket_id:TICKET,amount_cents:2500,method:'TRANSFER',effective_paid_at:'2026-10-07T18:00:00Z'}],
payment_plans:[{id:ID,ticket_id:TICKET,number_of_weeks:4}],
sale_item_fulfillment:[],payment_proofs:[],refund_requests:[],refunds:[],product_images:[],activity_logs:[],inventory_movements:[],
sales_feed:[{kind:'SALE',id:ID,reference:'TEMP-VD',occurred_at:'2026-10-07T18:00:00Z',client_id:null,stage:'DELIVERED',to_collect:false,search_text:'temp-vd labial'},{kind:'ORDER',id:ORDER,reference:'20000000',occurred_at:'2026-10-06T18:00:00Z',client_id:CLIENT,stage:'IN_TRANSIT',to_collect:true,search_text:'maria elena shopper perfume'}],
sales_feed_counts:[{total:2,open:1,to_collect:1,to_confirm:0,to_order:0,in_transit:1,ready:0,delivered:1,cancelled:0}],
sale_tracking_links:[{token:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',sale_id:null,order_id:ORDER,revoked_at:null}]
};
class Query {
constructor(table){this.table=table;this.filters=[];this.orders=[];this.start=0;this.end=999;this.shape='many';this.operation='read';}
select(columns,opts){this.columns=columns;this.count=opts?.count;return this;}
eq(c,v){this.filters.push(r=>r[c]===v);return this;}
neq(c,v){this.filters.push(r=>r[c]!==v);return this;}
is(c,v){return this.eq(c,v);}
in(c,ids){if(ids.length>150)throw new Error('UUID batch too large');this.ids=ids;this.filters.push(r=>ids.includes(r[c]));return this;}
ilike(c,pattern){const search=pattern.slice(1,-1);this.filters.push(r=>String(r[c]).includes(search));return this;}
order(c,opts){this.orders.push([c,opts?.ascending!==false]);return this;}
range(a,b){this.start=a;this.end=b;return this;}
limit(n){this.end=n-1;return this;}
single(){this.shape='one';return this;}
maybeSingle(){this.shape='one';return this;}
update(value){this.operation='update';this.value=value;return this;}
upsert(value){this.operation='upsert';this.value=value;return this;}
insert(value){this.operation='insert';this.value=value;return this;}
then(resolve,reject){try{
state.requests.push({table:this.table,columns:this.columns,ids:this.ids,start:this.start,operation:this.operation});
if(state.missingFulfillment&&this.table==='sale_item_fulfillment')return Promise.resolve({data:null,error:{code:'PGRST205',message:'Missing relation'}}).then(resolve,reject);
if(state.missing&&this.table.startsWith('sales_feed'))return Promise.resolve({data:null,error:{code:'PGRST205',message:'Missing relation'}}).then(resolve,reject);
if(this.table==='sale_tracking_links'&&this.operation==='read'){state.linkReads++;if(state.revokeAtEnd&&state.linkReads>=2)return Promise.resolve({data:null,error:null}).then(resolve,reject);}
const source=tables[this.table]??[];
let rows=source.filter(r=>this.filters.every(f=>f(r)));
if(this.operation==='upsert'){const existing=source.find(r=>r.id===this.value.id);if(existing)Object.assign(existing,this.value);else source.push({...this.value});}
if(this.operation==='update')for(const row of rows)Object.assign(row,this.value);
if(this.operation==='insert'){if(source.some(r=>r.revoked_at===null&&(r.sale_id&&r.sale_id===this.value.sale_id||r.order_id&&r.order_id===this.value.order_id)))return Promise.resolve({data:null,error:{code:'23505',message:'duplicate'}}).then(resolve,reject);source.push({...this.value,revoked_at:null});rows=[source.at(-1)];}
for(const [column,asc] of [...this.orders].reverse())rows.sort((a,b)=>a[column]===b[column]?0:(a[column]<b[column]?-1:1)*(asc?1:-1));
const count=rows.length;rows=rows.slice(this.start,this.end+1);
return Promise.resolve({data:structuredClone(this.shape==='one'?(rows[0]??null):rows),error:null,count}).then(resolve,reject);
}catch(e){return Promise.reject(e).then(resolve,reject);}}
}
export const adminDb=()=>({from:table=>new Query(table)});
export const adminStorage=()=>({from:()=>({getPublicUrl:key=>({data:{publicUrl:'https://example.invalid/'+key}})})});
export const PRODUCT_IMAGE_BUCKET='test';
export const requireAdminActor=async()=>{if(!state.authorized)throw new Error('Forbidden');return {id:CLIENT};};
export const logActivity=async data=>state.logs.push(data);
`;
await build({ input: "\0entry", external: id=>id.startsWith("node:") || id === "react" || id.startsWith("react/"), transform:{jsx:{runtime:"automatic"}}, plugins:[{name:"test-adapter",resolveId(source){if(source==="\0entry"||source==="\0adapter")return source;if(source.endsWith("/auth"))return "\0auth";if(source.endsWith("/incoming-reservations"))return "\0reservations";if(source.endsWith("/business"))return "\0adapter";if(source==="next/cache")return "\0cache";},load(id){if(id==="\0auth")return `import {adminDb,CLIENT} from "\\0adapter";export const getClientProfile=async()=>({user:{id:CLIENT},profile:{id:CLIENT},supabase:{schema:()=>adminDb()}});`.replace("\\0adapter","\0adapter");if(id==="\0reservations")return "export const getClientReservations=async()=>[];";if(id==="\0adapter")return adapter;if(id==="\0cache")return "export const revalidatePath=()=>{};";if(id==="\0entry")return `export * from ${JSON.stringify(resolve(root,"lib/supabase/account.ts"))}; export * from ${JSON.stringify(resolve(root,"lib/supabase/sales.ts"))}; export * from ${JSON.stringify(resolve(root,"lib/supabase/sales-tracking.ts"))}; export * from ${JSON.stringify(resolve(root,"lib/sales-location.ts"))}; export * from ${JSON.stringify(resolve(root,"components/account/AccountPurchases.tsx"))}; export * from ${JSON.stringify(resolve(root,"app/admin/vender/sales-actions.ts"))}; export * from '\\0adapter';`.replace("'\\0adapter'",JSON.stringify("\0adapter"));}}],output:{file:resolve(root,".tmp/sales-integration.mjs"),format:"esm"}});
const api=await import("../.tmp/sales-integration.mjs");
const {state,tables,ID,ORDER}=api;
const accountTickets = ["ORDERED","IN_TRANSIT","RECEIVED_LA_PAZ","IN_TRANSIT","READY_FOR_DELIVERY","DELIVERY_SCHEDULED","CANCELLED_INCIDENT","DELIVERED"].map((status,n) => ({ id:String(n),ticket_number:`TEMP-${n}`,product_name_snapshot:`Product ${n}`,variant_name_snapshot:null,financial_status:"PAID",logistics_status:status,agreed_total_cents:10000,paid_principal_cents:10000 }));
const accountMarkup = renderToStaticMarkup(createElement(api.AccountPurchases,{tickets:accountTickets}));
assert.equal((accountMarkup.match(/class="card purchase-row"/g) ?? []).length,6);
assert.equal((accountMarkup.match(/Favor de agendar pickup/g) ?? []).length,1);
assert.ok(accountMarkup.includes("Product 4"));
assert.ok(accountMarkup.includes("En bodega de McAllen") && accountMarkup.includes("En paquetería") && accountMarkup.includes("En sucursal de La Paz") && accountMarkup.includes("Listo para entrega en La Paz"));
assert.ok(!accountMarkup.includes("Product 6") && !accountMarkup.includes("Product 7"));
const query={search:"",filter:"todas",ascending:false,page:1};
let result=await api.listSales(query);
assert.equal(result.fallback,false);assert.equal(result.total,2);
assert.equal(result.records[0].client,null);
assert.equal(result.records[1].lines[0].name,"Shopper perfume");
assert.match(result.records[1].payment.methodText,/Plan semanal 4/);
state.missing=true;
result=await api.listSales(query);
assert.equal(result.fallback,true);assert.equal(result.total,2);assert.equal(result.records[0].index.kind,"SALE");
state.missing=false;state.requests=[];state.linkReads=0;
assert.equal(await api.getPublicTracking("bad-token"),null);assert.equal(state.requests.length,0);
const tracking=await api.getPublicTracking("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
assert.equal(tracking.firstName,"María");assert.equal(tracking.lines[0].name,"Shopper perfume");
assert.ok(!/PRIVATE-|private-note|2500|10000/.test(JSON.stringify(tracking)));
for(const request of state.requests) assert.ok(!/phone|email|address|last_name|notes|cents|payments|refund/.test(request.columns??""),JSON.stringify(request));
for (const [status,label] of [["ORDERED","En bodega de McAllen"],["IN_TRANSIT","En paquetería"],["RECEIVED_LA_PAZ","En sucursal de La Paz"],["READY_FOR_DELIVERY","Listo para entrega en La Paz"],["DELIVERY_SCHEDULED","Entrega programada"]]) {
  tables.tickets[0].logistics_status=status;
  const live=await api.getPublicTracking("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(live.lines[0].logisticsStatus,status);
  assert.equal(api.trackingLocationLabel(live.lines[0]),label);
  assert.equal(api.trackingSummaryLabel(live),label);
  assert.equal(api.needsPickup(live.lines[0]),status==="READY_FOR_DELIVERY");
}
tables.orders[0].status="CANCELLED";tables.tickets[0].logistics_status="READY_FOR_DELIVERY";
const cancelledTracking=await api.getPublicTracking("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
assert.equal(api.needsPickup(cancelledTracking.lines[0]),false);
assert.equal(api.trackingLocationLabel(cancelledTracking.lines[0]),"Cancelado");
tables.orders[0].status="CONFIRMED";tables.tickets[0].logistics_status="IN_TRANSIT";
state.revokeAtEnd=true;state.linkReads=0;
assert.equal(await api.getPublicTracking("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),null);
state.revokeAtEnd=false;state.authorized=false;state.requests=[];
const form=new FormData();form.set("target",`p-${ORDER}`);form.set("notes","Updated");form.set("mode","regenerate");
assert.equal((await api.saveSalesNotes({},form)).error,"Forbidden");
assert.equal((await api.changeSalesTracking({},form)).error,"Forbidden");assert.equal(state.requests.length,0);
state.authorized=true;
assert.ok((await api.saveSalesNotes({},form)).success);assert.equal(tables.orders[0].internal_notes,"Updated");assert.equal(state.logs.at(-1).previousData.internal_notes,"private-note");
assert.ok((await api.changeSalesTracking({},form)).success);
assert.equal(tables.sale_tracking_links.filter(r=>r.revoked_at===null).length,1);
assert.equal(tables.sale_tracking_links.at(-1).token.length,43);
form.set("mode","revoke");assert.ok((await api.changeSalesTracking({},form)).success);assert.equal(tables.sale_tracking_links.filter(r=>r.revoked_at===null).length,0);
assert.equal(api.salesTarget("p-../../secret"),null);
// Direct-sale fulfillment is independent of payment and inventory.
const locationForm=new FormData();locationForm.set("target",`s-${ID}`);locationForm.set("itemId",ID);locationForm.set("status","ORDERED");
state.authorized=false;state.requests=[];
assert.equal((await api.changeSaleItemLocation({},locationForm)).error,"Forbidden");assert.equal(state.requests.length,0);state.authorized=true;
locationForm.set("itemId",api.ITEM);assert.match((await api.changeSaleItemLocation({},locationForm)).error,/no pertenece/);locationForm.set("itemId",ID);
state.missingFulfillment=true;assert.match((await api.changeSaleItemLocation({},locationForm)).error,/018/);
assert.equal((await api.getSalesRecord(`s-${ID}`)).fulfillmentAvailable,false);state.missingFulfillment=false;
tables.sale_tracking_links.push({token:"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",sale_id:ID,order_id:null,revoked_at:null});
for(const status of ["ORDERED","IN_TRANSIT","RECEIVED_LA_PAZ","READY_FOR_DELIVERY","DELIVERED"]){
 locationForm.set("status",status);state.requests=[];
 assert.ok((await api.changeSaleItemLocation({},locationForm)).success);
 assert.ok(state.requests.filter(r=>r.operation!=="read").every(r=>r.table==="sale_item_fulfillment"));
 const record=await api.getSalesRecord(`s-${ID}`);assert.equal(record.lines[0].logisticsStatus,status);
 const publicSale=await api.getPublicTracking("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");assert.equal(publicSale.lines[0].logisticsStatus,status);assert.equal(api.needsPickup(publicSale.lines[0]),status==="READY_FOR_DELIVERY");
 assert.equal(record.paidCents,1000);assert.equal(tables.sales[0].status,"COMPLETED");
}
tables.sales[0].client_id=api.CLIENT;
tables.sales.push({...tables.sales[0],id:api.ITEM,client_id:api.TICKET,sale_number:"PRIVATE-OTHER"});
tables.sale_items.push({...tables.sale_items[0],id:api.ITEM,sale_id:api.ITEM,product_name_snapshot:"PRIVATE-OTHER-PRODUCT"});
tables.sale_item_fulfillment[0].logistics_status="READY_FOR_DELIVERY";
tables.sale_item_fulfillment.push({id:api.ITEM,logistics_status:"ORDERED",updated_at:new Date().toISOString()});
state.requests=[];const ownAccount=await api.getAccountData();assert.equal(ownAccount.salePurchases.length,1);assert.equal(ownAccount.salePurchases[0].product_name_snapshot,"Labial");assert.ok(!JSON.stringify(ownAccount.salePurchases).includes("PRIVATE-OTHER"));
assert.deepEqual(state.requests.find(r=>r.table==="sales").ids,[api.CLIENT]);
tables.sales.pop();tables.sale_items.pop();tables.sale_item_fulfillment.pop();
tables.sales[0].status="CANCELLED";assert.match((await api.changeSaleItemLocation({},locationForm)).error,/no está activa/);assert.equal((await api.getPublicTracking("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")).stage,"CANCELLED");tables.sales[0].status="COMPLETED";
const many=Array.from({length:1101},(_,n)=>({id:String(n).padStart(4,"0"),sale_id:ID}));
tables.sale_items=many;state.requests=[];
assert.equal((await api.related("sale_items","id,sale_id","sale_id",[ID])).length,1101);
assert.deepEqual(state.requests.map(r=>r.start),[0,1000]);
state.requests=[];await api.related("clients","id","id",Array.from({length:301},(_,n)=>String(n)));
assert.deepEqual(state.requests.map(r=>r.ids.length),[150,150,1]);
console.log("PASS: actual loaders, migration fallback, shopper/weekly data, public allowlist and revocation, owner-only actions, token rotation, >1000 children and 150-ID batches.");
