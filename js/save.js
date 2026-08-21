/* 苔藓时间 · 存档：localStorage + Base64 导入导出 */
"use strict";

const SaveSys = {
  KEY:"mosstime_save_v1",

  pack(){
    return {
      epoch: Game.state.epoch,
      traits: Game.state.traits,
      substrate: Game.state.substrate,
      unlockedSubs: Game.state.unlockedSubs,
      sliders: {...Game.state.env},
      patches: Game.state.patches.map(p=>({sp:p.sp,x:p.x,y:p.y,r:p.r,health:p.health,seed:p.seed})),
      discovered: Game.state.discovered,
      symbiosis: Game.state.symbiosis,
      ach: Game.state.ach,
      achStats: AchSys.stats,
      guideDone: Game.state.guideDone,
      quests: QuestSys.pack(),
      hints: Game.state.hints,
      lastSave: Date.now(),
    };
  },

  disabled:false,

  save(){
    if(this.disabled) return;
    try{ localStorage.setItem(this.KEY, JSON.stringify(this.pack())); }catch(e){}
  },

  load(){
    try{
      const raw = localStorage.getItem(this.KEY);
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(e){ return null; }
  },

  apply(data){
    const s = Game.state;
    s.epoch = Math.min(5, Math.max(1, data.epoch||1));
    s.traits = data.traits||[];
    s.substrate = data.substrate||"basalt";
    s.unlockedSubs = data.unlockedSubs||["basalt","wood","tile"];
    s.env = Object.assign({temp:20,humidity:75,light:40,ph:6}, data.sliders);
    s.patches = (data.patches||[]).map(p=>Sim.makePatch(p.sp,p.x,p.y,p.r,p.health,p.seed));
    s.discovered = data.discovered||[];
    s.symbiosis = data.symbiosis||[];
    s.ach = data.ach||[];
    s.guideDone = !!data.guideDone;
    AchSys.init(data.achStats);
    return data.lastSave||Date.now();
  },

  export(){
    const json = JSON.stringify(this.pack());
    return btoa(unescape(encodeURIComponent(json)));
  },

  import(code){
    try{
      const json = decodeURIComponent(escape(atob(code.trim())));
      const data = JSON.parse(json);
      if(!data || typeof data!=="object" || !data.sliders) return false;
      this.apply(data);
      this.save();
      return true;
    }catch(e){ return false; }
  },

  wipe(){
    this.disabled=true; // 阻止 beforeunload 把旧状态写回去
    localStorage.removeItem(this.KEY);
  },
};
