import {$,el,openDialog} from './dom.mjs';
import {t,locale,onLocaleChange} from '../i18n.mjs';
import {accountIdentity} from './shared.mjs';
import {AccountPackageError,PACKAGE_FILE_LIMIT,inspectAccountPackage,encodeAccountPackage,decodeAccountPackage} from '../application/account-package.mjs';

export function setupAccountPackage({capture,restore,lock,report,currentAccount=()=>null}){
  const dialog=$('account-package-dialog');
  let busy=false,mode='export',payload=null,envelope=null;
  const passwords=()=>[$('package-password'),$('package-password-confirm'),$('package-import-password')];
  async function fileChecksum(bytes){
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  function showChecksum(prefix,name,checksum){
    $(prefix+'-checksum-name').textContent=name;
    $(prefix+'-checksum-value').textContent=checksum;
    $(prefix+'-checksum-status').textContent='';
    $(prefix+'-checksum').hidden=false;
  }
  for(const prefix of ['export','import'])$(prefix+'-checksum-copy').onclick=async()=>{
    try{await navigator.clipboard.writeText($(prefix+'-checksum-value').textContent);$(prefix+'-checksum-status').textContent=t('校验码已复制');}
    catch{$(prefix+'-checksum-status').textContent=t('复制失败，请手动选择校验码复制。');}
  };
  function resetPasswords(){
    $('package-show-password').checked=false;
    for(const input of passwords()){input.value='';input.type='password';}
  }
  $('package-show-password').onchange=()=>{
    for(const id of ['package-password','package-password-confirm'])$(id).type=$('package-show-password').checked?'text':'password';
  };
  function controls(){
    $('close-package').disabled=busy;
    $('package-export-encrypted').disabled=busy;
    $('package-show-password').disabled=busy;
    for(const input of passwords())input.disabled=busy;
    $('package-download').disabled=busy||!payload;
    $('package-decrypt').disabled=busy||!envelope;
    $('package-apply').disabled=busy||!payload;
    $('package-export-passwords').hidden=!$('package-export-encrypted').checked;
  }
  function error(message){const output=$('package-message');output.textContent=message;output.hidden=!message;if(message)output.focus();}
  function summary(){
    const box=$('package-summary');box.replaceChildren();if(!payload)return;
    box.append(el('span',t('游戏账号'),'account-caption'),accountIdentity(payload.publicUserId));
    const counts=el('dl','','package-counts');
    for(const [label,value] of [['库存历史',payload.snapshots.length],['选拔回忆',payload.selectionSnapshot?.count??t('未采集')],['已关联详情',payload.selectionSnapshot?.details?.length??0],['标签',payload.library.tags.length],['收藏',Object.values(payload.library.favorites).reduce((total,items)=>total+items.length,0)]]){
      const item=el('div');item.append(el('dt',t(label)),el('dd',String(value)));counts.append(item);
    }
    box.append(counts,el('p',t('备份导出时间：{0}',[new Date(payload.exportedAt).toLocaleString(locale())])));
    if(mode==='import')box.append(el('p',t(currentAccount()===payload.publicUserId?'将更新当前账号。':'将导入到此数据包所属账号，其他账号保留。')));
  }
  function open(next){
    mode=next;payload=null;envelope=null;resetPasswords();
    $('import-checksum').hidden=true;$('import-checksum-value').textContent='';$('import-checksum-status').textContent='';
    $('package-export-encrypted').checked=false;$('package-summary').replaceChildren();error('');
    $('package-title').textContent=t(mode==='export'?'导出账号数据包':'导入账号数据包');
    $('package-export-panel').hidden=mode!=='export';$('package-import-panel').hidden=mode!=='import';
    $('package-import-unlock').hidden=true;$('package-import-confirm').hidden=true;
    openDialog(dialog);controls();
  }
  async function run(action){
    if(busy)return;busy=true;lock(true);error('');controls();
    try{await action();}
    catch(reason){error(reason instanceof AccountPackageError?t(reason.message):t('数据包处理失败，请检查文件格式和浏览器存储空间；原数据保留。'));}
    finally{busy=false;lock(false);controls();}
  }
  function showImport(){summary();$('package-import-unlock').hidden=true;$('package-import-confirm').hidden=false;resetPasswords();}
  $('export-account-package').onclick=()=>{open('export');void run(async()=>{payload=await capture();summary();});};
  $('import-account-package').onclick=()=>$('account-package-file').click();
  $('account-package-file').onchange=event=>{
    const file=event.target.files[0];event.target.value='';if(!file||busy)return;
    open('import');void run(async()=>{
      if(file.size>PACKAGE_FILE_LIMIT)throw new AccountPackageError('数据包文件超过 300 MiB，无法导入。');
      const bytes=await file.arrayBuffer();
      showChecksum('import',file.name,await fileChecksum(bytes));
      envelope=JSON.parse(new TextDecoder().decode(bytes));
      if(inspectAccountPackage(envelope)){$('package-import-unlock').hidden=false;}
      else{payload=await decodeAccountPackage(envelope);showImport();}
    });
  };
  $('package-export-encrypted').onchange=()=>{if(!$('package-export-encrypted').checked)resetPasswords();controls();};
  $('package-download').onclick=()=>void run(async()=>{
    const encrypted=$('package-export-encrypted').checked,password=encrypted?$('package-password').value:'';
    if(encrypted&&(password.length<8||password.length>1024))throw new AccountPackageError('加密密码需要 8–1024 个字符。');
    if(encrypted&&password!==$('package-password-confirm').value)throw new AccountPackageError('两次输入的密码不一致。');
    const packaged=await encodeAccountPackage(payload,password),link=el('a');
    const file=new Blob([JSON.stringify(packaged)],{type:'application/json'});
    const checksum=await fileChecksum(await file.arrayBuffer());
    const url=URL.createObjectURL(file);
    link.href=url;link.download=`account-backup-${new Date().toISOString().replace(/[:.]/g,'-')}${encrypted?'-encrypted':''}.gakumas.json`;
    link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);resetPasswords();
    showChecksum('export',link.download,checksum);
    dialog.close();report(t(encrypted?'已导出加密账号数据包。':'已导出账号数据包。'));
  });
  $('package-decrypt').onclick=()=>void run(async()=>{payload=await decodeAccountPackage(envelope,$('package-import-password').value);showImport();});
  $('package-apply').onclick=()=>void run(async()=>{await restore(payload);resetPasswords();dialog.close();report(t('账号数据包已导入。'),false,{transient:true});});
  $('close-package').onclick=()=>{if(!busy)dialog.close();};
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{payload=null;envelope=null;resetPasswords();});
  onLocaleChange(()=>{if(dialog.open){$('package-title').textContent=t(mode==='export'?'导出账号数据包':'导入账号数据包');summary();}});
}
