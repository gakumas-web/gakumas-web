import {validateImageDelivery,imageObjectKey} from './image-delivery.mjs';

// 以对象身份联接构建期基础图片与最新发布索引；同名换图不能沿用旧缩略图。
export function combineImagePlan(index,plan,root){
  validateImageDelivery(index);
  const files={...index.files},thumbnails={},local=new Map();
  let packages=plan.packages.map(pack=>({...pack,url:new URL(pack.url,root).href}));
  if(!packages.length){
    const known=new Map(plan.sourcePackages.map(pack=>[pack.sha256,pack]));
    packages=index.baseline.packages.filter(pack=>known.get(pack.sha256)?.bytes===pack.bytes).map(pack=>({...pack,url:new URL(known.get(pack.sha256).url,root).href}));
  }
  for(const pack of packages)for(const [key,row] of Object.entries(pack.objects))local.set(key,row);
  for(const [name,thumb] of Object.entries(plan.thumbnails)){
    const current=index.files[name],original=plan.files[name];
    if(current&&current.sha256===original.sha256&&current.bytes===original.bytes){files[thumb]=plan.files[thumb];thumbnails[name]=thumb;}
  }
  const cdn=new Set(index.cdn_objects);
  for(const [name,row] of Object.entries(files)){
    const key=imageObjectKey(name,row),built=local.get(key);
    if(!(built?.sha256===row.sha256&&built.bytes===row.bytes)&&!cdn.has(key))throw new Error('image_program_update_required');
  }
  if(!packages.length)throw new Error('image_program_update_required');
  return {thumbnails,index:validateImageDelivery({...index,files,baseline:{version:index.baseline.version,packages},cdn_objects:index.cdn_objects.filter(key=>!local.has(key))})};
}
