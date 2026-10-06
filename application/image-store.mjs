// 图片缓存独立于库存和公开资料；账号清理与备份都不操作这个数据库。
export function createImageStore(){
  let opened;
  function open(){
    if(!opened)opened=new Promise((resolve,reject)=>{
      const request=indexedDB.open('gakumas-public-images',1);
      request.onupgradeneeded=()=>{request.result.createObjectStore('objects');request.result.createObjectStore('meta');};
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opened=null;};resolve(db);};
      request.onerror=()=>{opened=null;reject(request.error);};
    });
    return opened;
  }
  async function transaction(names,mode,action){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(names,mode);let request;
      tx.oncomplete=()=>resolve(request?.result);tx.onabort=tx.onerror=()=>reject(tx.error??new Error('image_cache_failed'));
      try{request=action(tx);}catch(error){tx.abort();reject(error);}
    });
  }
  return {
    get:key=>transaction(['objects'],'readonly',tx=>tx.objectStore('objects').get(key)),
    meta:key=>transaction(['meta'],'readonly',tx=>tx.objectStore('meta').get(key)),
    put:(key,blob)=>transaction(['objects'],'readwrite',tx=>tx.objectStore('objects').put(blob,key)),
    setMeta:(key,value)=>transaction(['meta'],'readwrite',tx=>tx.objectStore('meta').put(value,key)),
    pack:(digest,entries)=>transaction(['objects','meta'],'readwrite',tx=>{
      for(const [key,blob] of entries)tx.objectStore('objects').put(blob,key);
      return tx.objectStore('meta').put(true,'pack:'+digest);
    }),
  };
}
