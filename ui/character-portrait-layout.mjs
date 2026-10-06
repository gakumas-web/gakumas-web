// 本地原图 alpha>16 的可见范围；只调整 CSS 展示，不裁改图片文件。
const bounds={
  hski:[743,426,1297,2017],ttmr:[726,304,1375,2022],fktn:[708,364,1379,2005],
  atbm:[601,219,1400,2006],amao:[805,350,1327,1999],kllj:[800,318,1222,1966],
  kcna:[645,442,1433,1981],ssmk:[663,256,1348,2007],shro:[759,341,1331,2003],
  jsna:[671,246,1354,1977],hmsz:[712,319,1230,2023],hume:[719,313,1411,1979],hrnm:[814,293,1246,1986],
};
export const tallestPortrait=Math.max(...Object.values(bounds).map(([,top,,bottom])=>bottom-top));
// 共通立绘没有方形画布的透明边距，按现有角色可见高度的中位数归一化。
const commonHeight=Object.values(bounds).map(([,top,,bottom])=>bottom-top).sort((a,b)=>a-b)[Math.floor(Object.keys(bounds).length/2)];
export function portraitLayout(id){
  if(id==='nasr')return {height:commonHeight/tallestPortrait,top:1-commonHeight/tallestPortrait};
  const box=bounds[id];
  if(!box)return null;
  return {height:2048/tallestPortrait,top:(tallestPortrait-box[3])/tallestPortrait};
}
