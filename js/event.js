/* 苔藓时间 · 随机生态事件：干热风 / 连绵雨 / 孢子雨 / 不速之客 / 水膜来客
   平均几分钟一场，来去自顾自；玩家可以应对，也可以只是看着 */
"use strict";

const EventSys = {
  active:null,              // {def, until}
  nextAt:0,                 // 下一场最早发生时刻

  EVENTS:[
    {id:"drought", name:"干热风", dur:100,
     weather:{hum:-28, temp:6},
     need:()=>Game.state.env.humidity>45,
     intro:"一阵干热的风掠过视野——湿度正在流失"},
    {id:"rainspell", name:"连绵雨", dur:130,
     weather:{hum:18, light:-18},
     need:()=>true,
     intro:"雨云停在玻璃上方，一时不会走"},
    {id:"spore_rain", name:"孢子雨", dur:150,
     need:()=>Game.state.discovered.length<(window.COLLECTIBLE_COUNT||168),
     intro:"风带来别处的孢子：未发现的物种更容易在此时涌现",
     start:()=>{ Game.state.sporeRain=150; }},
    {id:"invasion", name:"不速之客", dur:200,
     need:()=>Game.state.patches.length>=2 && Game.state.patches.length<36,
     intro:"一株来路不明的苔藓落了进来，长势汹汹",
     start:()=>{
       const [x,y]=Sim.randPos();
       const p=Sim.makePatch("moss_invader",x,y,9,1);
       p.invader=true;
       Game.state.patches.push(p);
     }},
    {id:"visitors", name:"水膜来客", dur:90,
     need:()=>Game.state.env.humidity>70 && Sim.richness()>=2 && Game.state.patches.length<36,
     intro:"几只微型动物结伴路过这片水膜",
     start:()=>{
       const pool=SPECIES.filter(s=>s.style==="critter"&&!s.summon&&!s.egg);
       const n=2+Math.floor(Math.random()*2);
       for(let i=0;i<n;i++){
         const sp=pool[Math.floor(Math.random()*pool.length)];
         if(!sp) break;
         const [x,y]=Sim.randPos();
         const p=Sim.makePatch(sp.id,x,y,8,1);
         p.dieAt=performance.now()+60000+Math.random()*40000;
         Game.state.patches.push(p);
         if(!Game.state.discovered.includes(sp.id)){
           Game.state.discovered.push(sp.id);
           UI.toast(`新物种涌现：${sp.name}（已录入图鉴）`);
           AudioSys.chime(); UI.refreshCodex(); UI.refreshDex();
         }
       }
     }},
  ],

  init(){ this.nextAt=performance.now()+150000+Math.random()*150000; }, // 开场 2.5–5 分钟后第一场

  tick(dt){
    const now=performance.now();
    if(this.active && now>=this.active.until){
      this.active=null;
      Sim.weather=null;
      this.nextAt=now+200000+Math.random()*220000; // 结束后 3.3–7 分钟再下一场
      UI.status("系统运行中。调节参数，等待生命涌现。");
    }
    if(this.active || now<this.nextAt) return;
    if(Game.state.patches.length<2){ this.nextAt=now+90000; return; } // 视野太空时按兵不动
    const pool=this.EVENTS.filter(e=>e.need());
    if(!pool.length){ this.nextAt=now+60000; return; }
    const def=pool[Math.floor(Math.random()*pool.length)];
    this.active={def, until:now+def.dur*1000};
    if(def.weather) Sim.weather={...def.weather, until:this.active.until};
    if(def.start) def.start();
    UI.toast(`【${def.name}】${def.intro}`,"event",6500);
    UI.status(`正在发生：${def.name}`);
    AudioSys.blip(def.id==="drought"?330:520, 0.3, 0.06);
    if(window.AchSys) AchSys.stat("event");
  },
};
