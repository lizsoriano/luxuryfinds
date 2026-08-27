(function(){'use strict';
window.exportLuxuryFindsBackup=function(){
  const blob=new Blob([JSON.stringify(GlamData.exportBackup(),null,2)],{type:'application/json'});
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);
  link.download=`luxury-finds-respaldo-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(link.href);
};
window.importLuxuryFindsBackup=function(input){
  const file=input.files[0];if(!file)return;const reader=new FileReader();
  reader.onload=()=>{try{GlamData.importBackup(JSON.parse(reader.result));alert('Respaldo importado correctamente.');location.reload()}catch(error){alert(error.message)}};
  reader.readAsText(file);
};
function renderAvailable(){
  const catalogRoot=document.getElementById('admin-catalog-stock');
  const arrivalRoot=document.getElementById('admin-client-arrivals');
  if(catalogRoot){
    const list=GlamData.getProducts().filter(p=>Number(p.stock)>0);
    catalogRoot.innerHTML=list.map(p=>`<article class="cat-card" onclick="editProduct(${p.id})"><div class="cat-img">${p.emoji||'📦'}</div><div class="cat-info"><div class="cat-pname">${p.name}</div><div class="cat-price">$${Number(p.price).toLocaleString()}</div><div class="cat-stock">${p.category||''}</div></div></article>`).join('')||'<div class="empty-compact">Sin inventario disponible.</div>';
  }
  if(arrivalRoot){
    const clients=GlamData.getClients();
    const rows=GlamData.getOrders().flatMap(o=>(o.products||[]).filter(p=>p.status==='received').map(p=>({o,p,c:clients.find(c=>c.id===o.clientId)})));
    arrivalRoot.innerHTML=rows.map(({o,p,c})=>`<article class="operation-card"><div class="operation-image">${p.emoji||'📦'}</div><div class="operation-main"><h3>${p.name}</h3><p>${c?.name||'Clienta'} · Pedido #${o.id}</p></div><div class="card-actions"><button class="btn-sm btn-sched" onclick="openSched(${o.id},${!!o.entrega})">${o.entrega?'Reagendar':'Agendar'}</button><button class="btn-primary" onclick="advanceProduct(${o.id},'${p.id}','delivered')">Marcar entregado</button></div></article>`).join('')||'<div class="empty-compact">No hay productos de clientas disponibles.</div>';
  }
}
document.addEventListener('DOMContentLoaded',renderAvailable);window.renderAdminAvailable=renderAvailable;
})();
