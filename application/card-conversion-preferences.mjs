export const cardConversionKey=profile=>`gakumas-web:card-conversions:${profile}`;
export function loadCardConversions(profile,storage=globalThis.localStorage){
  if(!profile)return {};
  try{
    const value=JSON.parse(storage.getItem(cardConversionKey(profile))??'{}');
    if(!value||typeof value!=='object'||Array.isArray(value))return {};
    return Object.fromEntries(Object.entries(value).filter(([,version])=>['before','after'].includes(version)));
  }catch{return {};}
}
export function saveCardConversions(profile,value,storage=globalThis.localStorage){
  if(profile)storage.setItem(cardConversionKey(profile),JSON.stringify(value));
}
