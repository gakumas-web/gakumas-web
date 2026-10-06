import {validProfile} from './account.mjs';

export class LibraryError extends Error {}
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const unique=values=>[...new Set(values)];
export function tagName(value){
  if(typeof value!=='string'||!value.trim()||value.trim().length>40)throw new LibraryError('标签名称需要 1–40 个字符。');
  return value.trim();
}
export function emptyLibrary(profile){return {version:1,profile,tags:[],memories:{},selectionMemories:{},favorites:{idolCards:[],supportCards:[],idolCardSkins:[],memories:[],selectionMemories:[]}};}
export function parseLibrary(input,profile){
  if(!validProfile(profile)||!object(input)||input.version!==1||input.profile!==profile||!Array.isArray(input.tags)||input.tags.length>10000)throw new LibraryError('标签与收藏数据格式无效或账号不匹配。');
  const tags=unique(input.tags.map(tagName)),known=new Set(tags),result=emptyLibrary(profile);result.tags=tags;
  for(const kind of ['memories','selectionMemories']){
    if(!object(input[kind])||Object.keys(input[kind]).length>100000)throw new LibraryError('标签关联数据无效。');
    result[kind]=Object.fromEntries(Object.entries(input[kind]).map(([key,values])=>{
      if(!/^[a-f0-9]{64}$/.test(key)||!Array.isArray(values)||values.length>10000||values.some(name=>!known.has(name)))throw new LibraryError('标签关联数据无效。');
      return [key,unique(values)];
    }));
  }
  if(!object(input.favorites))throw new LibraryError('收藏数据无效。');
  for(const kind of ['idolCards','supportCards','idolCardSkins','memories','selectionMemories']){
    const values=input.favorites[kind];
    if(!Array.isArray(values)||values.length>100000||values.some(id=>typeof id!=='string'||!id||id.length>256))throw new LibraryError('收藏数据无效。');
    result.favorites[kind]=unique(values);
  }
  return result;
}
export function changeTag(input,oldName,newName){
  const result=parseLibrary(input,input.profile),name=tagName(newName);
  if(result.tags.includes(name)&&name!==oldName)throw new LibraryError('已存在同名标签。');
  if(oldName!==null&&!result.tags.includes(oldName))throw new LibraryError('标签已不存在，请重新打开。');
  if(oldName===null)result.tags.push(name);
  else{
    result.tags=result.tags.map(value=>value===oldName?name:value);
    for(const kind of ['memories','selectionMemories'])for(const [key,values] of Object.entries(result[kind]))result[kind][key]=values.map(value=>value===oldName?name:value);
  }
  return result;
}
export function removeTag(input,name){
  const result=parseLibrary(input,input.profile);result.tags=result.tags.filter(value=>value!==name);
  for(const kind of ['memories','selectionMemories'])for(const [key,values] of Object.entries(result[kind]))result[kind][key]=values.filter(value=>value!==name);
  return result;
}
export function mergeLibraries(existing,incoming){
  const before=parseLibrary(existing,incoming.profile),after=parseLibrary(incoming,incoming.profile);
  return parseLibrary({...after,tags:unique([...before.tags,...after.tags]),memories:{...before.memories,...after.memories},selectionMemories:{...before.selectionMemories,...after.selectionMemories}},after.profile);
}
export function matchesTag(library,kind,key,filter){
  const tags=library?.[kind]?.[key]??[];
  return !filter||(filter==='__untagged__'?tags.length===0:filter.startsWith('tag:')&&tags.includes(filter.slice(4)));
}
export function favoriteRecords(snapshot,field,filters,collect){
  const rows=collect(snapshot,field,filters.ownership==='favorites'?'all':filters.ownership??(field==='supportCards'?'all':'owned'));
  return filters.ownership==='favorites'?rows.filter(row=>(filters.favorites??[]).includes(row[{idolCards:'idolCardId',supportCards:'supportCardId',idolCardSkins:'idolCardSkinId'}[field]])):rows;
}
