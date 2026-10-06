import {$,el,openDialog} from './dom.mjs';
import {t,onLocaleChange} from '../i18n.mjs';
import {profileAccountId} from '../domain/account.mjs';
import {accountIdentity} from './shared.mjs';

export function setupAccountCleanup({target,summary,remove,complete,lock,report}){
  const dialog=$('account-cleanup-dialog');
  let selected=null,counts=null,busy=false;
  function controls(){
    $('cancel-account-cleanup').disabled=busy;
    $('account-cleanup-confirmed').disabled=busy||!counts;
    $('confirm-account-cleanup').disabled=busy||!counts||!$('account-cleanup-confirmed').checked;
  }
  function describe(){
    const box=$('account-cleanup-summary');box.replaceChildren();if(!selected)return;
    const id=profileAccountId(selected.profile);
    box.append(id?accountIdentity(id):el('strong',selected.label));
    if(counts)box.append(el('p',t('普通回忆 {0} 条 · 历史快照 {1} 份',[counts.memories,counts.history])),
      el('p',t('选拔回忆 {0} 条 · 已关联详情 {1} 条',[counts.selection,counts.details])),
      el('p',t('标签、收藏与偏好存储 {0} 项',[counts.settings])));
  }
  function error(text){const node=$('account-cleanup-error');node.textContent=text;node.hidden=!text;if(text)node.focus();}
  $('clear-account').onclick=async()=>{
    if(busy)return;selected=target();counts=null;$('account-cleanup-confirmed').checked=false;error('');describe();
    busy=true;lock(true);controls();openDialog(dialog,{returnFocus:()=>$('data-dialog').open?($('clear-account').disabled?$('close-data'):$('clear-account')):$('data-open')});
    try{counts=await summary(selected.profile);describe();}
    catch{error(t('无法读取账号数据，请刷新页面后重试。'));}
    finally{busy=false;lock(false);controls();}
  };
  $('account-cleanup-confirmed').onchange=controls;
  $('confirm-account-cleanup').onclick=async()=>{
    if(busy||!counts||!$('account-cleanup-confirmed').checked)return;
    if(target().profile!==selected.profile){error(t('当前账号已变化，请关闭窗口后重新选择。'));return;}
    busy=true;lock(true);controls();error('');let deleted=false;
    try{
      await remove(selected.profile);deleted=true;await complete(selected.profile);
      dialog.close();report(t('已清除所选账号的浏览器数据。'));
    }catch{error(t(deleted?'数据已清除，但页面刷新失败，请刷新页面。':'清理失败，原浏览器数据已保留，请重试。'));}
    finally{busy=false;lock(false);controls();}
  };
  $('cancel-account-cleanup').onclick=()=>{if(!busy)dialog.close();};
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{selected=null;counts=null;$('account-cleanup-confirmed').checked=false;});
  onLocaleChange(()=>{if(dialog.open){selected={...selected,label:target().label};describe();}});
}
