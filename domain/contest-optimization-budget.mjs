// 产品计算量边界；预设、表单与控制器共用，不能仅依赖输入框约束。
export const OPTIMIZATION_RUN_LIMIT=250000;
export const OPTIMIZATION_BUDGET_LIMITS=Object.freeze({population:256,generations:128,samples:10000,polishParents:32,polishNeighbors:256,polishRounds:8,polishRuns:10000,reviewCandidates:128,screenRuns:10000,reviewRuns:10000,finalCandidates:64,finalRuns:10000,totalRunLimit:OPTIMIZATION_RUN_LIMIT});

export function inspectOptimizationBudget(input){
  const budget={...input,totalRunLimit:input.totalRunLimit??OPTIMIZATION_RUN_LIMIT};
  for(const [field,max] of Object.entries(OPTIMIZATION_BUDGET_LIMITS)){
    if(field==='screenRuns'&&budget.screenRuns===undefined)continue;
    const min=field==='polishRounds'?0:1,value=budget[field];
    if(!Number.isSafeInteger(value)||value<min||value>max)return {budget,error:{code:'optimization_budget_field',field,min,max}};
  }
  if(budget.screenRuns>budget.reviewRuns)return {budget,error:{code:'optimization_budget_screen',field:'reviewRuns'}};
  if(budget.finalCandidates>budget.reviewCandidates)return {budget,error:{code:'optimization_budget_final',field:'finalCandidates'}};
  const search=budget.population*budget.generations*budget.samples;
  // 每轮还会评估父编组；复筛的初筛与加测共享同一份预算。
  const polish=budget.polishParents*(budget.polishNeighbors+1)*budget.polishRounds*budget.polishRuns;
  const review=budget.reviewCandidates*budget.reviewRuns,final=budget.finalCandidates*budget.finalRuns;
  const details=budget.finalCandidates*3,total=search+polish+review+final+details;
  const estimate={search,polish,review,final,details,total,minimum:budget.samples+review+final+details};
  if(total>OPTIMIZATION_RUN_LIMIT)return {budget,estimate,error:{code:'optimization_budget_excessive',max:OPTIMIZATION_RUN_LIMIT,total}};
  if(budget.totalRunLimit<estimate.minimum)return {budget,estimate,error:{code:'optimization_budget_reserve',field:'totalRunLimit',minimum:estimate.minimum}};
  return {budget,estimate,error:null};
}

export function validateOptimizationBudget(input){
  const result=inspectOptimizationBudget(input);
  if(result.error)throw Object.assign(new Error(result.error.code),result.error);
  return result;
}
