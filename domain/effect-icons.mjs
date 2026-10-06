// 增长枚举按其明确作用对象取图标，不根据日文说明猜测。
const targets={
  Lesson:'ExamLesson',LessonCount:'ExamLesson',Block:'ExamBlock',FullPowerPoint:'ExamFullPowerPoint',
  ParameterBuffTurn:'ExamParameterBuff',LessonBuff:'ExamLessonBuff',Review:'ExamReview',Aggressive:'ExamCardPlayAggressive',
  CardDraw:'ExamCardCreateId',ParameterBuffMultiplePerTurn:'ExamParameterBuffMultiplePerTurn',
  StaminaConsumptionDownTurn:'ExamStaminaConsumptionDown',StaminaConsumptionAddTurn:'ExamStaminaConsumptionDown',
  CostLessonBuff:'ExamLessonBuff',CostReview:'ExamReview',CostAggressive:'ExamCardPlayAggressive',
  CostParameterBuff:'ExamParameterBuff',CostFullPowerPoint:'ExamFullPowerPoint',CostParameterBuffMultiplePerTurn:'ExamParameterBuffMultiplePerTurn',
  LessonDependBlock:'ExamLesson',LessonDependExamCardPlayAggressive:'ExamLesson',LessonDependExamReview:'ExamLesson',
};
export function growEffectIconType(type=''){
  const kind=type.replace('ProduceCardGrowEffectType_','').replace(/(?:Add|Reduce)$/,'');
  return targets[kind];
}
export function descriptionIconType(part){
  return part.examEffectType?.replace('ProduceExamEffectType_','')??growEffectIconType(part.produceCardGrowEffectType)??
    (part.text==='スキルカードを引く'?'ExamCardCreateId':undefined);
}
