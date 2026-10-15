import {el} from './dom.mjs';

// 原生说明折叠共用标题和装饰图标，正文由业务页面追加。
export function createInfoDisclosure(title,className){
  const element=el('details','',`${className} info-disclosure`),summary=el('summary',title);
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(icon.namespaceURI,'path');
  icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');path.setAttribute('d','M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z');icon.append(path);summary.prepend(icon);element.append(summary);
  return element;
}
