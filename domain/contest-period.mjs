const jstOffset=9*60*60*1000;
const periodSources=group=>group.stages.flatMap(stage=>[stage.season,stage.preset]).filter(Boolean);
const timestamp=value=>{
  if(typeof value!=='number'&&!(typeof value==='string'&&/^\d+$/.test(value)))return null;
  const time=Number(value);
  return Number.isFinite(new Date(time).getTime())&&Number.isFinite(new Date(time+jstOffset).getTime())?time:null;
};
const compactDate=value=>new Date(value+jstOffset).toISOString().slice(2,10).replaceAll('-','');
const validCalendarDate=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
};

// 赛期使用公开资料中的实际时间；缺失时不从赛季序号或固定周期推算。
export function contestGroupPeriod(group){
  const sources=periodSources(group);
  const source=sources.find(value=>timestamp(value.startTime)!==null||timestamp(value.endTime)!==null);
  return {startTime:timestamp(source?.startTime),endTime:timestamp(source?.endTime)};
}

export function contestGroupDateRange(group){
  const calendar=periodSources(group).find(value=>validCalendarDate(value.startDate)&&validCalendarDate(value.endDate));
  if(calendar)return `${calendar.startDate.slice(2).replaceAll('-','')}-${calendar.endDate.slice(2).replaceAll('-','')}`;
  const {startTime,endTime}=contestGroupPeriod(group);
  return startTime===null||endTime===null?'':`${compactDate(startTime)}-${compactDate(endTime)}`;
}

export function contestGroupUpcoming(group,now=Date.now()){
  const {startTime}=contestGroupPeriod(group);
  return startTime===null?group.stages.some(stage=>stage.preset?.preview===true):now<startTime;
}
