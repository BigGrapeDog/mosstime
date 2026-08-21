/* 苔藓时间 · 成就系统：清单 + 检测 + 解锁提示 + 面板 */
"use strict";

const ACHIEVEMENTS=[
 {id:"first_life", name:"第一抹绿",   desc:"见证第一个物种涌现",            test:(s,st)=>s.discovered.length>=1},
 {id:"dex10",     name:"见习观测者", desc:"图鉴收录 10 个物种",             test:(s,st)=>s.discovered.length>=10},
 {id:"dex30",     name:"熟手观测者", desc:"图鉴收录 30 个物种",             test:(s,st)=>s.discovered.length>=30},
 {id:"dex60",     name:"资深观测者", desc:"图鉴收录 60 个物种",             test:(s,st)=>s.discovered.length>=60},
 {id:"dex100",    name:"博物学家",   desc:"图鉴收录 100 个物种",            test:(s,st)=>s.discovered.length>=100},
 {id:"dex_all",   name:"尘世全览",   desc:"收录全部物种",                   test:(s,st)=>s.discovered.length>=(window.COLLECTIBLE_COUNT||SPECIES.length)},
 {id:"styles8",   name:"生态全景",   desc:"发现 8 个不同类群",              test:(s,st)=>AchSys.stylesFound()>=8},
 {id:"styles_all",name:"万物并作",   desc:"发现全部 10 个类群",             test:(s,st)=>AchSys.stylesFound()>=10},
 {id:"sym1",      name:"共生初见",   desc:"第一次见证共生奇观",             test:(s,st)=>st.sym>=1},
 {id:"sym_all",   name:"织网者",     desc:"见证全部共生奇观",               test:(s,st)=>s.symbiosis.length>=Object.keys(SYMBIOSIS).length},
 {id:"climax1",   name:"顶极时刻",   desc:"第一次达成顶极群落",             test:(s,st)=>st.climax>=1},
 {id:"epoch2",    name:"第二纪元",   desc:"进入第 2 纪元",                  test:(s,st)=>s.epoch>=2},
 {id:"epoch5",    name:"时间深处",   desc:"抵达第 5 纪元",                  test:(s,st)=>s.epoch>=5},
 {id:"extinct3",  name:"毁灭与新生", desc:"触发 3 次大灭绝",                test:(s,st)=>st.extinct>=3},
 {id:"slime",     name:"会思考的黄色",desc:"发现任意一种黏菌",              test:(s,st)=>s.discovered.some(id=>{const q=SPECIES.find(x=>x.id===id);return q&&q.style==="slime";})},
 {id:"shroom",    name:"森林的信使", desc:"发现任意一种蘑菇子实体",         test:(s,st)=>s.discovered.some(id=>{const q=SPECIES.find(x=>x.id===id);return q&&q.style==="shroom";})},
 {id:"critter_sp",name:"水滴里的鲸", desc:"发现任意一种微型动物",           test:(s,st)=>s.discovered.some(id=>{const q=SPECIES.find(x=>x.id===id);return q&&q.style==="critter";})},
 {id:"egg1",      name:"视野之外",   desc:"发现任意彩蛋物种",               test:(s,st)=>s.discovered.some(id=>{const q=SPECIES.find(x=>x.id===id);return q&&q.egg;})},
 {id:"egg_all",   name:"传说收藏家", desc:"发现全部彩蛋物种",               test:(s,st)=>SPECIES.filter(x=>x.egg).every(x=>s.discovered.includes(x.id))},
 {id:"tardigrade",name:"水熊虫之友", desc:"观测到路过的水熊虫",             test:(s,st)=>s.discovered.includes("tardigrade")},
 {id:"cover80",   name:"绿意盎然",   desc:"覆盖度达到 80%",                 test:(s,st)=>Sim.coverage()>=0.8},
 {id:"crowded",   name:"摩肩接踵",   desc:"同一视野 12 个物种共存",         test:(s,st)=>Sim.richness()>=12},
 {id:"ops_all",   name:"干预之手",   desc:"四种手动操作各使用一次",         test:(s,st)=>st.op_inoculate&&st.op_nutrient&&st.op_uv&&st.op_spray},
 {id:"offline1",  name:"不在场的演化",desc:"第一次收到离岗报告",            test:(s,st)=>st.offline>=1},
 {id:"quest1",    name:"第一份委托", desc:"完成一条观测委托",               test:(s,st)=>st.quest>=1},
 {id:"quest10",   name:"履约人",     desc:"累计完成 10 条观测委托",          test:(s,st)=>st.quest>=10},
 {id:"event3",    name:"看天的眼睛", desc:"经历 3 场生态事件",              test:(s,st)=>st.event>=3},
 {id:"patient",   name:"苔藓时间",   desc:"累计观察满 30 分钟——和苔藓一个时制", test:(s,st)=>st.playSec>=1800},
];

const AchSys={
  stats:{},

  init(savedStats){
    this.stats=savedStats||{};
  },

  stylesFound(){
    const set=new Set();
    for(const id of Game.state.discovered){
      const sp=SPECIES.find(s=>s.id===id);
      if(sp) set.add(sp.style);
    }
    return set.size;
  },

  stat(k){
    this.stats[k]=(this.stats[k]||0)+1;
    this.check();
  },

  check(){
    const s=Game.state;
    for(const a of ACHIEVEMENTS){
      if(s.ach.includes(a.id)) continue;
      let ok=false;
      try{ ok=a.test(s,this.stats); }catch(e){}
      if(ok) this.unlock(a);
    }
  },

  unlock(a){
    Game.state.ach.push(a.id);
    UI.toast(`成就解锁【${a.name}】——${a.desc}`,"ach");
    AudioSys.chime();
    if(UI.refreshAch) UI.refreshAch();
    SaveSys.save();
  },
};
