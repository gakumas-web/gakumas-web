// 档案只使用游戏公开 ID，不创建匿名占位账号。
export const validPublicUserId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
export const accountProfile=id=>validPublicUserId(id)?`account-${id}`:null;
export const profileAccountId=profile=>typeof profile==='string'&&profile.startsWith('account-')&&validPublicUserId(profile.slice(8))?profile.slice(8):null;
export const validProfile=profile=>Boolean(profileAccountId(profile));
// 仅用于界面展示；身份匹配、链接和数据包始终保留原始 ID。
export function maskedAccountId(id){
  if(!validPublicUserId(id))return '';
  if(id.length<=4)return '****';
  const start=Math.floor((id.length-4)/2);
  return id.slice(0,start)+'****'+id.slice(start+4);
}
export function snapshotFitsProfile(snapshot,profile){
  const id=profileAccountId(profile);
  return Boolean(id)&&snapshot?.publicUserId===id;
}
