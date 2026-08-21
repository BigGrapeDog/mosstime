/* 苔藓时间 · 观测委托：每日三条小任务，过凌晨刷新
   完成奖励 = 图鉴线索（暗示一个未发现物种的喜好），写入观测笔记 */
"use strict";

/* 委托池。step(q,dt) 返回 {cur, goal, done}；base 在生成时快照 */
const QUEST_POOL = [
  {id:"humid_hold", text:"让湿度保持在 85% 以上，累计 10 分钟",
   goal:600, fmt:"time",
   step:(q,dt)=>({cur:q.cur+(Game.state.env.humidity>=85?dt:0)})},
  {id:"dry_hold", text:"让湿度降到 30% 以下，累计 5 分钟",
   goal:300, fmt:"time",
   step:(q,dt)=>({cur:q.cur+(Game.state.env.humidity<=30?dt:0)})},
  {id:"dark_hold", text:"把光照降到 20% 以下，累计 8 分钟——为夜行的生灵留一个夜晚",
   goal:480, fmt:"time",
   step:(q,dt)=>({cur:q.cur+(Game.state.env.light<=20?dt:0)})},
  {id:"warm_hold", text:"让温度停留在 24–28°C 之间，累计 8 分钟",
   goal:480, fmt:"time",
   step:(q,dt)=>{const t=Game.state.env.temp;return{cur:q.cur+((t>=24&&t<=28)?dt:0)};}},
  {id:"ph_edge", text:"把 pH 推到极致一次：低于 4.5 或高于 9",
   goal:1, fmt:"count",
   step:(q)=>({cur:(Game.state.env.ph<4.5||Game.state.env.ph>9)?1:q.cur})},
  {id:"cover_30", text:"让覆盖度达到 30%",
   goal:1, fmt:"count",
   step:(q)=>({cur:Sim.coverage()>=0.3?1:q.cur})},
  {id:"rich_6", text:"让视野里同时住着 6 种生命",
   goal:1, fmt:"count",
   step:(q)=>({cur:Sim.richness()>=6?1:q.cur})},
  {id:"new_species", text:"见证任意一个新物种涌现",
   goal:1, fmt:"count", base:()=>Game.state.discovered.length,
   step:(q)=>({cur:Game.state.discovered.length-q.base})},
  {id:"sym_witness", text:"见证一次共生奇观的形成",
   goal:1, fmt:"count", base:()=>AchSys.stats.sym||0,
   step:(q)=>({cur:(AchSys.stats.sym||0)-q.base})},
  {id:"spray_op", text:"使用一次「喷淋灌溉」",
   goal:1, fmt:"count", base:()=>AchSys.stats.op_spray||0,
   step:(q)=>({cur:(AchSys.stats.op_spray||0)-q.base})},
  {id:"inoculate_op", text:"完成一次「接种孢子」",
   goal:1, fmt:"count", base:()=>AchSys.stats.op_inoculate||0,
   step:(q)=>({cur:(AchSys.stats.op_inoculate||0)-q.base})},
  {id:"photo_op", text:"用「拍照」为今天留下一张海报",
   goal:1, fmt:"count", base:()=>AchSys.stats.op_photo||0,
   step:(q)=>({cur:(AchSys.stats.op_photo||0)-q.base})},
  {id:"drop_op", text:"用指尖在视野里点下一颗水珠",
   goal:1, fmt:"count", base:()=>AchSys.stats.op_drop||0,
   step:(q)=>({cur:(AchSys.stats.op_drop||0)-q.base})},
  {id:"beetle_op", text:"引入一只「食腐甲虫」帮群落更新",
   goal:1, fmt:"count", base:()=>AchSys.stats.op_beetle||0,
   step:(q)=>({cur:(AchSys.stats.op_beetle||0)-q.base})},
  {id:"critter_watch", text:"让微型动物在视野里累计驻留 60 秒",
   goal:60, fmt:"time",
   step:(q,dt)=>({cur:q.cur+(Game.state.patches.some(p=>{const sp=Sim.spOf(p.sp);return sp&&sp.style==="critter"&&!sp.summon;})?dt:0)})},
];

const QuestSys = {
  day:"", quests:[], // {id, cur, base, done}

  todayStr(){
    const d=new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  },

  // 日期种子伪随机：同一天所有人生成同样的三条
  seededPick(dateStr,n){
    let h=2166136261;
    for(const ch of dateStr){ h^=ch.charCodeAt(0); h=(h*16777619)>>>0; }
    const pool=[...QUEST_POOL], out=[];
    while(out.length<n && pool.length){
      h=(h*1664525+1013904223)>>>0;
      out.push(pool.splice(h%pool.length,1)[0]);
    }
    return out;
  },

  ensure(silent){
    const today=this.todayStr();
    if(this.day===today && this.quests.length) return;
    const had=!!this.day; // 不是首次进入才算"新的一天"
    this.day=today;
    this.quests=this.seededPick(today,3).map(def=>({
      id:def.id, cur:0, done:false,
      base:def.base?def.base():0,
    }));
    UI.renderQuests();
    if(had && !silent) UI.toast("新的一天，观测台留下了三条新委托","warn");
  },

  tick(dt){
    this.ensure();
    let dirty=false;
    for(const q of this.quests){
      if(q.done) continue;
      const def=QUEST_POOL.find(d=>d.id===q.id); if(!def) continue;
      const r=def.step(q,dt);
      q.cur=Math.min(r.cur, def.goal);
      if(q.cur>=def.goal) this.complete(q,def);
      dirty=true;
    }
    if(dirty) UI.renderQuestProgress();
  },

  complete(q,def){
    q.done=true;
    AudioSys.chime();
    if(window.AchSys){ AchSys.stat("quest"); AchSys.check(); }
    const hint=this.makeHint();
    UI.renderQuests();
    if(hint){
      Game.state.hints.push(hint);
      if(Game.state.hints.length>6) Game.state.hints.shift();
      UI.toast(`委托达成「${def.text.split("，")[0].split("：")[0]}」· 观测笔记新得一页`,"warn");
      setTimeout(()=>UI.toast(hint,"hint",9000),600);
    }else{
      UI.toast("委托达成。图鉴已全览，笔记上只剩一句：谢谢你。" ,"warn");
    }
    SaveSys.save();
  },

  // 为一个未发现的物种生成线索
  makeHint(){
    const undisc=SPECIES.filter(s=>!s.summon && !Game.state.discovered.includes(s.id));
    if(!undisc.length) return null;
    const sp=undisc[Math.floor(Math.random()*undisc.length)];
    const n=sp.need;
    const parts=[];
    parts.push(n[1]>=70?"水汽丰沛之处":n[1]>=45?"半湿之地":"偏干之处");
    parts.push(n[0]<=10?"冷处":n[0]>=28?"暖处":"不冷不热处");
    parts.push(n[2]<=20?"暗处":n[2]>=60?"亮处":"半明半暗处");
    parts.push(n[3]<=5?"酸性的表面":n[3]>=8?"碱性的表面":"近中性的表面");
    let subHint="";
    if(sp.subs!=="any"){
      const names=sp.subs.map(id=>{const s=SUBSTRATES.find(x=>x.id===id);return s?s.name:id;});
      subHint=`，偏爱「${names.join("」「")}」`;
    }
    return `观测笔记：有种未知的生命喜欢${parts.join("、")}${subHint}。`;
  },

  /* ---- 存档 ---- */
  pack(){ return {day:this.day, quests:this.quests}; },
  load(data){
    if(!data) return;
    if(data.day===this.todayStr() && Array.isArray(data.quests)){
      this.day=data.day; this.quests=data.quests;
    } // 跨天的旧委托不恢复，交给 ensure() 重新生成
  },
};
