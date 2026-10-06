// HIF スター性估算配置。运营调整后修改此文件并刷新页面，无需改动计算或展示代码。
// 基础奖励尚未乘加成；本战课程与试验只填写选拔结束后还能获得的部分。
export const hifStarRules={
  enabled:true,
  revision:'2026-10-01',
  finalCap:1335,
  bonusMultiplier:1.5,
  // 各次奖励分别取整；当前取整方式仍为推定，可选 floor／round／ceil／none。
  rounding:'floor',
  item:{
    id:'pitem_00-3-265-0',
    name:'H.I.Fワッペン',
    limit:20,
    baseReward:10,
    // 两个计数不一致时停止估算；确认语义后可取消交叉核对或更换计数字段。
    countField:'triggerCount',
    matchingCountField:'reactionCount',
  },
  battle:{
    spLessons:[30,10],
    rounds:[120,150],
  },
};
