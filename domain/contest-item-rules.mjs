import {contestItemRules} from './community-rules.mjs';
import {selectionGrades} from './selection-memories.mjs';

// 只计算额外道具名额；主回忆的角色专属道具不占用这些名额。
export function contestExtraItemLimit(grade,rules=contestItemRules){
  return rules?.ranks?.[typeof grade==='number'?selectionGrades[grade]:grade]??null;
}
