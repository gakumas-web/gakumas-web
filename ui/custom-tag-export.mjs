import {$,el} from './dom.mjs';
import {t} from '../i18n.mjs';
import {createCustomTagExport} from '../application/custom-tag-export.mjs';

export function setupCustomTagExport({current}){
  const trigger=$('export-custom-tags'),status=$('custom-tag-export-status');
  let previous=[],result=null;
  function describe(){
    status.hidden=!result;
    status.textContent=!result?'':result.error?t('自定义标签导出失败，请检查当前账号的库存和标签数据后重试。'):t('已导出普通回忆 {0} 条、选拔回忆 {1} 条及其自定义标签。',result.counts);
  }
  const hasTagged=({snapshot,selectionSnapshot,library})=>Boolean(library&&[
    ['memories',snapshot?.memories],['selectionMemories',selectionSnapshot?.selectionMemories],
  ].some(([kind,rows])=>rows?.some(memory=>library[kind]?.[memory.key]?.length)));
  function sync(){
    const context=current(),identity=[context.profile,context.snapshot,context.selectionSnapshot,context.library];
    if(identity.some((value,index)=>value!==previous[index])){result=null;previous=identity;}
    trigger.disabled=context.loading||!hasTagged(context);
    describe();
  }
  trigger.onclick=()=>{
    const context=current();if(context.loading||!hasTagged(context))return;
    try{
      // 每次点击读取当前账号的全部标签关联，不使用页面筛选或勾选结果。
      const value=createCustomTagExport(context),blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=el('a');
      anchor.href=url;anchor.download=`gakumas-custom-tags-${value.exported_at.replace(/[^0-9TZ]/g,'')}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      result={counts:[value.memories.length,value.selectionMemories.length]};
    }catch{result={error:true};}
    describe();
  };
  sync();return {sync};
}
