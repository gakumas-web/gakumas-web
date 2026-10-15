// 共用候选按钮导航；单选是否随焦点选中、多选如何更新活动项由调用方决定。
export function createChoiceNavigation({getButtons,onMove,axis='both'}){
  const keys=axis==='horizontal'?['ArrowLeft','ArrowRight','Home','End']:['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
  return event=>{
    if(!keys.includes(event.key))return;
    // aria-disabled 项仍可获得焦点并说明限额，原生禁用或隐藏的按钮不参与导航。
    const buttons=getButtons().filter(button=>!button.matches(':disabled')&&!button.closest('[hidden]')),index=buttons.indexOf(event.currentTarget);
    if(index<0)return;
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+buttons.length)%buttons.length,target=buttons[next];
    onMove(target);target.focus();
  };
}
