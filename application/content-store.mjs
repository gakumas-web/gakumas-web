// 公共内容独立保存，不与账号清理、备份或库存事务共用数据库。
async function run(mode,action){
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('gakumas-public-content',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('content');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('content',mode),store=tx.objectStore('content');let request;
    tx.oncomplete=()=>resolve(request?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    try{request=action(store);}catch(error){tx.abort();reject(error);}
  });}finally{db.close();}
}
export const readContentCache=()=>run('readonly',store=>store.get('active'));
export const writeContentCache=value=>run('readwrite',store=>store.put(value,'active'));
