'use strict';
// ════════════════════════════════════════════════════════
//  PIKA-PIKA  |  쥐토끼의 겨울나기
// ════════════════════════════════════════════════════════

// ── CONSTANTS ─────────────────────────────────────────
const CELL        = 16;
const COLS        = 50;
const ROWS        = 50;
const CW          = COLS * CELL;   // 800
const CH          = ROWS * CELL;   // 800
const WIN_COUNT   = 30;
const RIPEN_MS    = 10000;
const HP_DRAIN_S  = 1;
const INTERACT_PX = CELL * 2;
const GRASS_SAFE  = 4;   // cell radius
const OBS_SAFE    = 3;   // cell radius around burrows
const OBSTACLE_RATIO = 0.08;

// tile
const T_EMPTY = 0, T_ROCK = 1, T_WATER = 2;

// ── CHARACTER DEFS ────────────────────────────────────
const CHAR_DEFS = {
  pika:  { name:'Pika',  startHp:200, maxHp:250, speed:6,  carry:2, color:'#c4945a', earColor:'#b07840', desc:'그냥 쥐토끼',          behavior:'balanced' },
  rpika: { name:'Rpika', startHp:250, maxHp:300, speed:3,  carry:2, color:'#e8dfc8', earColor:'#d0c0a0', desc:'털이 복슬복슬한 쥐토끼', behavior:'defensive' },
  pyka:  { name:'Pyka',  startHp:150, maxHp:250, speed:12, carry:2, color:'#6a6a8a', earColor:'#5a5a7a', desc:'매끈매끈한 쥐토끼',    behavior:'fast' },
  hika:  { name:'Hika',  startHp:150, maxHp:250, speed:6,  carry:4, color:'#8a6040', earColor:'#7a5030', desc:'카우보이 쥐토끼',      behavior:'thief' },
};

const BURROW_CORNERS = [
  { cx:1,  cy:1  },
  { cx:48, cy:1  },
  { cx:1,  cy:48 },
  { cx:48, cy:48 },
];

// ── STORY ─────────────────────────────────────────────
const STORY_SCENES = [
  { emoji:'☀️🌿', text:'아 대충 등따숩고 햇볕 들고 좋다~' },
  { emoji:'❄️🌨️', text:'갑자기 겨울이 찾아왔다!' },
  { emoji:'😱❄️', text:'큰일났다. 겨울나기 준비를 안 했다!' },
  { emoji:'🌿🏃', text:'빨리 풀더미를 모으자!' },
];

// ── AUDIO ──────────────────────────────────────────────
let _ctx = null;
function ac() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}
function tone(freq, type, dur, vol = 0.25) {
  try {
    const c = ac();
    const o = c.createOscillator(), g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.start(); o.stop(c.currentTime + dur);
  } catch(_) {}
}
const SFX = {
  swing:     () => tone(180, 'square', 0.05, 0.15),
  harvest:   () => { tone(440,'sine',0.1); setTimeout(()=>tone(660,'sine',0.1),80); },
  eatHerb:   () => tone(880, 'sine', 0.18),
  eatPoison: () => tone(220, 'sawtooth', 0.2),
  eatSpecial:() => { tone(880,'sine',0.08); setTimeout(()=>tone(1100,'sine',0.08),100); setTimeout(()=>tone(1320,'sine',0.08),200); },
  ripen:     () => tone(1200, 'triangle', 0.3, 0.18),
  lowHp:     () => tone(160, 'square', 0.12, 0.35),
  deposit:   () => tone(330, 'sine', 0.12),
  win:       () => [523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,'sine',0.35),i*160)),
  lose:      () => [440,330,220,110].forEach((f,i)=>setTimeout(()=>tone(f,'sawtooth',0.4),i*180)),
};

// ── SAVE ──────────────────────────────────────────────
function loadSave() { try { return JSON.parse(localStorage.getItem('pikapika')||'{}'); } catch(_) { return {}; } }
function patchSave(d) { localStorage.setItem('pikapika', JSON.stringify({...loadSave(),...d})); }

// ── STATE ─────────────────────────────────────────────
let S = {};   // game state — reset by initGame()

// ── UTILS ─────────────────────────────────────────────
function poisson(lam) {
  if (lam <= 0) return 0;
  let L=Math.exp(-lam), k=0, p=1;
  do { k++; p*=Math.random(); } while (p>L);
  return k-1;
}
function bern(p)  { return Math.random() < p; }
function ri(a,b)  { return Math.floor(Math.random()*(b-a+1))+a; }
function px2c(p)  { return Math.floor(p/CELL); }
function c2px(c)  { return c*CELL; }
function cdist(ax,ay,bx,by) { return Math.max(Math.abs(ax-bx),Math.abs(ay-by)); }
function pdist(x1,y1,x2,y2) { return Math.sqrt((x1-x2)**2+(y1-y2)**2); }
function shuffle(a) { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }

// ── MAP ───────────────────────────────────────────────
function makeMap() {
  const map = Array.from({length:ROWS}, ()=>new Uint8Array(COLS));
  const n = Math.floor(COLS*ROWS*OBSTACLE_RATIO);
  let placed=0, tries=0;
  while (placed<n && tries<20000) {
    tries++;
    const cx=ri(0,COLS-1), cy=ri(0,ROWS-1);
    if (map[cy][cx]!==T_EMPTY) continue;
    if (BURROW_CORNERS.some(b=>cdist(cx,cy,b.cx,b.cy)<=OBS_SAFE)) continue;
    map[cy][cx] = bern(0.5) ? T_ROCK : T_WATER;
    placed++;
  }
  return map;
}

function walkable(cx,cy) {
  if (cx<0||cy<0||cx>=COLS||cy>=ROWS) return false;
  return S.map[cy][cx]===T_EMPTY;
}

// ── BURROW ────────────────────────────────────────────
function makeBurrow(cx,cy) {
  return { cx, cy, count:0, stored:[], topBundle:null, owner:null };
}

// ── GRASS ─────────────────────────────────────────────
let _gid=0, _bid=0;

function spawnGrass(type,count) {
  for (let i=0;i<count;i++) {
    for (let t=0;t<40;t++) {
      const cx=ri(1,COLS-2), cy=ri(1,ROWS-2);
      if (S.map[cy][cx]!==T_EMPTY) continue;
      if (BURROW_CORNERS.some(b=>cdist(cx,cy,b.cx,b.cy)<=GRASS_SAFE)) continue;
      if (S.grasses.some(g=>g.cx===cx&&g.cy===cy)) continue;
      if (S.bundles.some(b=>!b.carrier&&!b.stored&&px2c(b.x)===cx&&px2c(b.y)===cy)) continue;
      S.grasses.push({id:_gid++,cx,cy,type,hits:0});
      break;
    }
  }
}

// ── BUNDLE ────────────────────────────────────────────
function makeBundle(cx,cy,type,carrier=null,offset=0) {
  const b = {id:_bid++, x:c2px(cx), y:c2px(cy), type, effectType:type,
             createdAt:Date.now(), isRipe:false, carrier, stored:false,
             storedIn:null, stackOff:offset};
  S.bundles.push(b);
  return b;
}

function removeBundle(b) {
  if (b.carrier) {
    const i=b.carrier.carrying.indexOf(b);
    if (i>=0) b.carrier.carrying.splice(i,1);
    b.carrier=null;
  }
  if (b.storedIn) {
    const brow=b.storedIn;
    brow.count--;
    const i=brow.stored.indexOf(b);
    if (i>=0) brow.stored.splice(i,1);
    brow.topBundle = brow.stored.at(-1)||null;
    b.storedIn=null;
  }
  const i=S.bundles.indexOf(b);
  if (i>=0) S.bundles.splice(i,1);
}

function depositBundle(b, brow) {
  const char=b.carrier;
  if (char) {
    const i=char.carrying.indexOf(b);
    if (i>=0) char.carrying.splice(i,1);
    b.carrier=null;
  }
  b.stored=true; b.storedIn=brow;
  brow.stored.push(b);
  brow.topBundle=b;
  brow.count++;
  SFX.deposit();
  if (brow.count>=WIN_COUNT) {
    if (brow.owner?.isPlayer) endGame('win');
    else endGame('lose');
  }
}

function applyBundleEffect(b, char) {
  const {isRipe, effectType} = b;
  if (effectType==='herb') {
    const gain = isRipe ? 3 : ri(15,30);
    char.hp = Math.min(char.maxHp, char.hp+gain);
    SFX.eatHerb();
  } else if (effectType==='poison') {
    char.hp = Math.max(0, char.hp - ri(1,10));
    SFX.eatPoison();
    checkDeath(char);
  } else if (effectType==='special') {
    SFX.eatSpecial();
    if (isRipe) {
      const r=ri(1,3);
      if (r===1) { char.maxHp+=50; char.hp=Math.min(char.maxHp,char.hp+50); }
      else if (r===2) { char.speed++; }
      else { char.carryMax+=2; }
    } else {
      const r=ri(1,3);
      if (r===1) {
        if (char.maxHp<=100) { applyBundleEffect({...b,effectType:'poison'}, char); return; }
        char.maxHp=Math.max(100,char.maxHp-20);
        if (char.hp>char.maxHp) char.hp=char.maxHp;
      } else if (r===2) {
        if (char.speed<=1) { applyBundleEffect({...b,effectType:'poison'}, char); return; }
        char.speed--;
      } else {
        if (char.carryMax<=1) { applyBundleEffect({...b,effectType:'poison'}, char); return; }
        char.carryMax--;
      }
    }
  }
}

function consumeBundle(b, char) {
  applyBundleEffect(b, char);
  removeBundle(b);
}

function checkDeath(char) {
  if (char.hp<=0) {
    char.hp=0;
    if (char.isPlayer) endGame('lose');
    else {
      char.isDead=true;
      // 모든 AI가 죽었으면 플레이어 승리
      const allAIDead=S.characters.every(c=>c.isPlayer||c.isDead);
      if (allAIDead) endGame('win');
    }
  }
}

// ── CHARACTER ─────────────────────────────────────────
class Char {
  constructor(type, isPlayer, brow) {
    const d=CHAR_DEFS[type];
    this.type=type; this.isPlayer=isPlayer;
    this.name=d.name; this.color=d.color; this.earColor=d.earColor;
    this.behavior=d.behavior;
    this.hp=d.startHp; this.maxHp=d.maxHp;
    this.speed=d.speed; this.carryMax=d.carry;
    this.burrow=brow; brow.owner=this;
    this.x=c2px(brow.cx); this.y=c2px(brow.cy);
    this.facing='down';
    this.carrying=[];
    this.isDead=false;
    this.swingCd=0; this.swingAnim=0;
    this.aiState='SEEK'; this.aiTarget=null; this.aiTimer=0; this.aiStuck=0;
  }
  get cx() { return px2c(this.x); }
  get cy() { return px2c(this.y); }
  get midX() { return this.x+CELL/2; }
  get midY() { return this.y+CELL/2; }
}

// ── MOVEMENT / COLLISION ──────────────────────────────
function tryMove(char, dx, dy) {
  if (!dx && !dy) return;
  const M=1;
  // X axis
  const nx=char.x+dx;
  const cx0=px2c(nx+M), cx1=px2c(nx+CELL-M);
  const cy0=px2c(char.y+M), cy1=px2c(char.y+CELL-M);
  if (walkable(cx0,cy0)&&walkable(cx1,cy0)&&walkable(cx0,cy1)&&walkable(cx1,cy1)) {
    char.x=Math.max(0,Math.min(CW-CELL,nx));
  }
  // Y axis
  const ny=char.y+dy;
  const cx2=px2c(char.x+M), cx3=px2c(char.x+CELL-M);
  const cy2=px2c(ny+M), cy3=px2c(ny+CELL-M);
  if (walkable(cx2,cy2)&&walkable(cx3,cy2)&&walkable(cx2,cy3)&&walkable(cx3,cy3)) {
    char.y=Math.max(0,Math.min(CH-CELL,ny));
  }
  if (Math.abs(dx)>Math.abs(dy)) char.facing=dx>0?'right':'left';
  else if (dy!==0) char.facing=dy>0?'down':'up';
}

// ── INTERACTION HELPERS ───────────────────────────────
function nearestGrass(char) {
  let best=null, bd=Infinity;
  for (const g of S.grasses) {
    const d=pdist(char.midX,char.midY,c2px(g.cx)+CELL/2,c2px(g.cy)+CELL/2);
    if (d<bd) { bd=d; best=g; }
  }
  return best;
}

function grassInRange(char) {
  let best=null, bd=Infinity;
  for (const g of S.grasses) {
    const d=pdist(char.midX,char.midY,c2px(g.cx)+CELL/2,c2px(g.cy)+CELL/2);
    if (d<=INTERACT_PX && d<bd) { bd=d; best=g; }
  }
  return best;
}

function bundleInRange(char) {
  let best=null, bd=Infinity;
  for (const b of S.bundles) {
    if (b.carrier||b.stored) continue;
    const bx=b.x+CELL/2, by=b.y+CELL/2;
    const d=pdist(char.midX,char.midY,bx,by);
    if (d<=INTERACT_PX && d<bd) { bd=d; best=b; }
  }
  return best;
}

function burrowInRange(char, includeOwn=true) {
  for (const bw of S.burrows) {
    if (!includeOwn && bw===char.burrow) continue;
    const d=pdist(char.midX,char.midY,c2px(bw.cx)+CELL/2,c2px(bw.cy)+CELL/2);
    if (d<=INTERACT_PX*2) return bw;
  }
  return null;
}

// ── PLAYER ACTIONS ────────────────────────────────────
function doSwing(char) {
  if (char.swingCd>0) return;
  char.swingCd=380; char.swingAnim=180;
  SFX.swing();
  const g=grassInRange(char);
  if (!g) return;
  g.hits++;
  if (g.hits>=3) {
    const i=S.grasses.indexOf(g);
    if (i>=0) S.grasses.splice(i,1);
    SFX.harvest();
    const b=makeBundle(g.cx,g.cy,g.type);
    if (bern(0.3)) makeBundle(g.cx,g.cy,g.type,null,3);
    // auto-pickup
    if (char.carrying.length<char.carryMax) {
      b.carrier=char; char.carrying.push(b);
    }
  }
}

function doPickup(char) {
  // if carrying: drop last bundle onto map
  if (char.carrying.length>0) {
    const b=char.carrying.at(-1);
    b.carrier=null; b.x=char.x; b.y=char.y;
    char.carrying.splice(char.carrying.length-1,1);
    return;
  }
  // pull from nearby burrow
  const bw=burrowInRange(char,true);
  if (bw && bw.stored.length>0 && char.carrying.length<char.carryMax) {
    const b=bw.stored.at(-1);
    bw.stored.splice(bw.stored.length-1,1);
    bw.topBundle=bw.stored.at(-1)||null;
    bw.count--;
    b.stored=false; b.storedIn=null; b.carrier=char;
    char.carrying.push(b);
    return;
  }
  // pickup from ground
  const b=bundleInRange(char);
  if (b && char.carrying.length<char.carryMax) {
    b.carrier=char; char.carrying.push(b);
  }
}

function doConsume(char) {
  // from burrow
  const bw=burrowInRange(char,true);
  if (bw && bw.stored.length>0) {
    const b=bw.stored.at(-1);
    bw.stored.splice(bw.stored.length-1,1);
    bw.topBundle=bw.stored.at(-1)||null;
    bw.count--;
    b.stored=false; b.storedIn=null;
    consumeBundle(b,char);
    return;
  }
  // from carrying
  if (char.carrying.length>0) {
    const b=char.carrying.at(-1);
    char.carrying.splice(char.carrying.length-1,1);
    b.carrier=null;
    consumeBundle(b,char);
    return;
  }
  // from ground
  const b=bundleInRange(char);
  if (b) consumeBundle(b,char);
}

function checkAutoDeposit(char) {
  if (!char.carrying.length) return;
  const bw=char.burrow;
  const d=pdist(char.midX,char.midY,c2px(bw.cx)+CELL/2,c2px(bw.cy)+CELL/2);
  if (d<=INTERACT_PX*2) {
    while (char.carrying.length) depositBundle(char.carrying[0],bw);
  }
}

// ── AI ────────────────────────────────────────────────
function updateAI(char, dt) {
  if (char.isDead) return;
  char.swingCd = Math.max(0, char.swingCd-dt);
  char.aiTimer -= dt;

  // Emergency: low HP, eat herb from carrying or nearby
  if (char.hp/char.maxHp < 0.25) {
    const h=char.carrying.find(b=>b.effectType==='herb'||(b.type==='poison'&&b.isRipe));
    if (h) { const i=char.carrying.indexOf(h); char.carrying.splice(i,1); h.carrier=null; consumeBundle(h,char); return; }
    // Look for ripe poison (becomes herb)
  }

  const beh=char.behavior;
  switch(char.aiState) {
    case 'SEEK': {
      // Thief: occasionally steal if opponent burrow has many bundles
      if (beh==='thief' && bern(0.002) && char.carrying.length===0) {
        const rich=S.burrows.filter(b=>b!==char.burrow&&b.count>3).sort((a,b_)=>b_.count-a.count)[0];
        if (rich) { char.aiState='STEAL'; char.aiTarget=rich; break; }
      }
      // Defensive: eat ripe poison-now-herb bundles near own burrow
      if (beh==='defensive' && char.carrying.length>0) {
        char.aiState='DEPOSIT'; break;
      }
      const g=nearestGrass(char);
      if (!g) { char.aiState='IDLE'; break; }
      char.aiTarget=g;
      // Move toward grass
      const tx=c2px(g.cx), ty=c2px(g.cy);
      aiMoveToward(char,tx,ty,dt);
      if (pdist(char.midX,char.midY,c2px(g.cx)+CELL/2,c2px(g.cy)+CELL/2)<=INTERACT_PX) {
        char.facing=char.midX<c2px(g.cx)+CELL/2?'right':'left';
        doSwing(char);
        if (!S.grasses.includes(g)) { char.aiTarget=null; if (char.carrying.length) char.aiState='DEPOSIT'; }
      }
      if (char.carrying.length>=char.carryMax) char.aiState='DEPOSIT';
      break;
    }
    case 'DEPOSIT': {
      const bw=char.burrow;
      aiMoveToward(char, c2px(bw.cx), c2px(bw.cy), dt);
      checkAutoDeposit(char);
      if (!char.carrying.length) char.aiState='SEEK';
      break;
    }
    case 'STEAL': {
      const bw=char.aiTarget;
      if (!bw||bw.count===0) { char.aiState='SEEK'; break; }
      aiMoveToward(char, c2px(bw.cx), c2px(bw.cy), dt);
      if (pdist(char.midX,char.midY,c2px(bw.cx)+CELL/2,c2px(bw.cy)+CELL/2)<=INTERACT_PX*2) {
        if (bw.stored.length>0 && char.carrying.length<char.carryMax) {
          const b=bw.stored.at(-1);
          bw.stored.splice(bw.stored.length-1,1);
          bw.topBundle=bw.stored.at(-1)||null;
          bw.count--;
          b.stored=false; b.storedIn=null; b.carrier=char;
          char.carrying.push(b);
        }
        if (char.carrying.length>=char.carryMax||bw.count===0) char.aiState='DEPOSIT';
      }
      break;
    }
    case 'IDLE':
      if (char.aiTimer<=0) { char.aiTimer=1000; char.aiState='SEEK'; }
      break;
  }
}

function aiMoveToward(char, tx, ty, dt) {
  const dx=tx-char.x, dy=ty-char.y;
  const d=Math.sqrt(dx*dx+dy*dy);
  if (d<2) return;
  const spd=char.speed*CELL*(dt/1000);
  tryMove(char, (dx/d)*spd, (dy/d)*spd);
}

// ── GAME INIT ─────────────────────────────────────────
function initGame() {
  _gid=0; _bid=0;
  S = {
    map:null, grasses:[], bundles:[], characters:[], player:null,
    burrows:[], grassPaused:false, grassTimer:0, hpTimer:0, lowHpTimer:0,
    keys:{}, justPressed:{}, gameOver:false,
  };
  S.map=makeMap();

  // Randomise corners
  const corners=shuffle([...BURROW_CORNERS]);
  S.burrows=corners.map(c=>makeBurrow(c.cx,c.cy));

  // All 4 char types, shuffle assignment
  const sel=state.selectedChar;
  const rest=['pika','rpika','pyka','hika'].filter(t=>t!==sel);
  shuffle(rest);

  const player=new Char(sel,true,S.burrows[0]);
  S.characters.push(player); S.player=player;
  rest.forEach((t,i)=>{
    S.characters.push(new Char(t,false,S.burrows[i+1]));
  });

  // Initial grass
  spawnGrass('herb',5); spawnGrass('poison',4); spawnGrass('special',1);
}

// ── UPDATE ────────────────────────────────────────────
function updateGame(dt) {
  if (S.gameOver) return;
  const p=S.player;

  // Player movement
  if (!p.isDead) {
    const spd=p.speed*CELL*(dt/1000);
    let mx=0, my=0;
    if (S.keys['ArrowLeft'])  mx-=spd;
    if (S.keys['ArrowRight']) mx+=spd;
    if (S.keys['ArrowUp'])    my-=spd;
    if (S.keys['ArrowDown'])  my+=spd;
    if (mx&&my) { mx/=Math.SQRT2; my/=Math.SQRT2; }
    if (mx||my) tryMove(p,mx,my);

    p.swingCd=Math.max(0,p.swingCd-dt);
    p.swingAnim=Math.max(0,p.swingAnim-dt);

    if (S.justPressed['a']||S.justPressed['A']) doSwing(p);
    if (S.justPressed['s']||S.justPressed['S']) doPickup(p);
    if (S.justPressed['d']||S.justPressed['D']) doConsume(p);

    checkAutoDeposit(p);
  }

  // AI
  for (const ch of S.characters) {
    if (!ch.isPlayer) {
      ch.swingAnim=Math.max(0,ch.swingAnim-dt);
      updateAI(ch,dt);
    }
  }

  // Carried bundles follow carrier
  for (const b of S.bundles) {
    if (b.carrier) { b.x=b.carrier.x; b.y=b.carrier.y; }
  }

  // Grass timer
  S.grassTimer+=dt;
  if (S.grassTimer>=1000) {
    S.grassTimer-=1000;
    const tot=S.grasses.length;
    if (!S.grassPaused) {
      spawnGrass('herb',poisson(3));
      spawnGrass('poison',poisson(3));
      spawnGrass('special',poisson(0.5));
      if (S.grasses.length>=50) S.grassPaused=true;
    } else if (tot<35) {
      S.grassPaused=false;
    }
  }

  // HP drain
  S.hpTimer+=dt;
  if (S.hpTimer>=1000) {
    S.hpTimer-=1000;
    for (const ch of S.characters) {
      if (!ch.isDead) { ch.hp-=HP_DRAIN_S; checkDeath(ch); }
    }
  }

  // Ripening
  const now=Date.now();
  for (const b of S.bundles) {
    if (!b.isRipe && now-b.createdAt>=RIPEN_MS) {
      b.isRipe=true;
      if (b.type==='poison') { b.effectType='herb'; }
      SFX.ripen();
    }
  }

  // Low HP alarm
  if (p.hp/p.maxHp<0.25 && !p.isDead) {
    S.lowHpTimer-=dt;
    if (S.lowHpTimer<=0) { S.lowHpTimer=2500; SFX.lowHp(); }
  }

  S.justPressed={};
}

// ── RENDER ────────────────────────────────────────────
const canvas=document.getElementById('gameCanvas');
const ctx=canvas.getContext('2d');

// Tile colours
const TILE_CLR=[
  ['#4e7a40','#5a8a4a'],  // empty
  ['#7a7060','#8a8070'],  // rock
  ['#2a5a9a','#3a6aaa'],  // water
];

function render() {
  ctx.clearRect(0,0,CW,CH);
  drawMap();
  drawBurrows();
  drawGrasses();
  drawBundles();
  drawChars();
}

function drawMap() {
  for (let cy=0;cy<ROWS;cy++) for (let cx=0;cx<COLS;cx++) {
    const t=S.map[cy][cx];
    ctx.fillStyle=TILE_CLR[t][(cx+cy)%2];
    ctx.fillRect(cx*CELL,cy*CELL,CELL,CELL);
  }
}

function drawBurrows() {
  for (const bw of S.burrows) {
    const px=c2px(bw.cx)-CELL, py=c2px(bw.cy)-CELL, sz=CELL*3;
    ctx.globalAlpha=0.35;
    ctx.fillStyle=bw.owner?bw.owner.color:'#806020';
    ctx.fillRect(px,py,sz,sz);
    ctx.globalAlpha=1;
    ctx.strokeStyle=bw.owner?bw.owner.color:'#806020';
    ctx.lineWidth=2;
    ctx.strokeRect(px,py,sz,sz);
    ctx.lineWidth=1;
    // Count label
    const lbl=`${bw.count}/${WIN_COUNT}`;
    ctx.fillStyle='rgba(0,0,0,0.65)';
    ctx.fillRect(px+1,py+sz-13,sz-2,12);
    ctx.fillStyle='#fff';
    ctx.font='bold 9px monospace';
    ctx.textAlign='center';
    ctx.fillText(lbl,px+sz/2,py+sz-3);
    if (bw.owner) {
      ctx.fillStyle=bw.owner.color;
      ctx.font='bold 8px monospace';
      ctx.fillText(bw.owner.name,px+sz/2,py+9);
    }
    // Top bundle indicator
    if (bw.topBundle) {
      const bc=bundleColor(bw.topBundle);
      ctx.fillStyle=bc;
      ctx.fillRect(px+sz-7,py+3,5,4);
    }
  }
}

function bundleColor(b) {
  if (b.isRipe && b.type==='poison') return '#2ecc40';
  if (b.isRipe && b.type==='herb')   return '#ddd';
  if (b.type==='herb')    return '#2ecc40';
  if (b.type==='poison')  return '#9b59b6';
  if (b.type==='special') return '#f1c40f';
  return '#aaa';
}

function drawGrasses() {
  for (const g of S.grasses) {
    const px=c2px(g.cx), py=c2px(g.cy);
    const clr=g.type==='herb'?'#27ae60':g.type==='poison'?'#8e44ad':'#d4ac0d';
    ctx.fillStyle=clr;
    // simple grass blade icon
    ctx.fillRect(px+4,py+8,8,6);  // leaf
    ctx.fillRect(px+6,py+3,4,7);  // stem
    // harvest bar
    if (g.hits>0) {
      ctx.fillStyle='rgba(255,255,255,0.8)';
      ctx.fillRect(px+2,py+14,(CELL-4)*(g.hits/3),2);
    }
  }
}

function drawBundles() {
  const now=Date.now();
  for (const b of S.bundles) {
    if (b.stored) continue;
    if (b.carrier) continue;
    drawBundle(b, b.x, b.y, now, 1);
  }
}

function drawBundle(b, bx, by, now, alpha=1) {
  ctx.globalAlpha=alpha;
  const clr=bundleColor(b);
  const ox=b.stackOff||0;
  ctx.fillStyle=clr;
  ctx.fillRect(bx+2+ox, by+5+ox, CELL-4, CELL-8);
  // Ripe special: flash red border
  if (b.isRipe && b.type==='special' && Math.sin(now/200)>0) {
    ctx.strokeStyle='#ff2020';
    ctx.lineWidth=2;
    ctx.strokeRect(bx+2+ox,by+5+ox,CELL-4,CELL-8);
    ctx.lineWidth=1;
  }
  // Ripen progress (if not ripe)
  if (!b.isRipe) {
    const prog=Math.min(1,(now-b.createdAt)/RIPEN_MS);
    ctx.fillStyle='rgba(0,0,0,0.4)';
    ctx.fillRect(bx+2,by+CELL-3,CELL-4,2);
    ctx.fillStyle='rgba(255,255,255,0.7)';
    ctx.fillRect(bx+2,by+CELL-3,(CELL-4)*prog,2);
  }
  ctx.globalAlpha=1;
}

function drawChars() {
  const now=Date.now();
  for (const ch of S.characters) {
    if (ch.isDead) { drawDeadChar(ch); continue; }
    // Draw carried bundles above character
    ch.carrying.forEach((b,i)=>drawBundle(b,ch.x-i*2,ch.y-CELL-i*2,now,0.9));
    drawChar(ch);
  }
}

function drawDeadChar(ch) {
  ctx.globalAlpha=0.4;
  ctx.fillStyle='#888';
  ctx.fillRect(ch.x+1,ch.y+5,CELL-2,CELL-9);
  ctx.globalAlpha=1;
}

function drawChar(ch) {
  const {x,y,color,earColor,facing,swingAnim,isPlayer,type} = ch;

  // Ears
  ctx.fillStyle=earColor;
  if (type==='rpika') {
    ctx.fillRect(x,y-4,6,8); ctx.fillRect(x+CELL-6,y-4,6,8);
    // fluffy dots
    ctx.fillStyle='#fff';
    ctx.fillRect(x+1,y-3,2,5); ctx.fillRect(x+CELL-5,y-3,2,5);
  } else if (type==='pyka') {
    ctx.fillRect(x+4,y,3,5); ctx.fillRect(x+CELL-7,y,3,5);
  } else if (type==='hika') {
    // hat brim
    ctx.fillStyle='#3a2010';
    ctx.fillRect(x-1,y-1,CELL+2,3);
    ctx.fillRect(x+3,y-7,CELL-6,7);
    ctx.fillStyle=earColor;
    ctx.fillRect(x+3,y+1,2,4); ctx.fillRect(x+CELL-5,y+1,2,4);
  } else {
    ctx.fillRect(x+3,y-1,3,6); ctx.fillRect(x+CELL-6,y-1,3,6);
  }

  // Body
  ctx.fillStyle=color;
  ctx.fillRect(x+2,y+4,CELL-4,CELL-6);

  // Rpika fur texture
  if (type==='rpika') {
    ctx.fillStyle='rgba(255,255,255,0.3)';
    ctx.fillRect(x+3,y+5,4,3); ctx.fillRect(x+9,y+8,3,3);
  }

  // Eyes
  ctx.fillStyle='#111';
  if (facing==='left')       { ctx.fillRect(x+2,y+7,2,2); }
  else if (facing==='right') { ctx.fillRect(x+CELL-4,y+7,2,2); }
  else { ctx.fillRect(x+3,y+7,2,2); ctx.fillRect(x+CELL-5,y+7,2,2); }

  // Player white outline
  if (isPlayer) {
    ctx.strokeStyle='rgba(255,255,255,0.8)';
    ctx.lineWidth=1.5;
    ctx.strokeRect(x+2,y+4,CELL-4,CELL-6);
    ctx.lineWidth=1;
  }

  // Swing effect
  if (swingAnim>0) {
    ctx.globalAlpha=swingAnim/180*0.7;
    ctx.fillStyle='#ffe060';
    let ax=x+CELL/2, ay=y+CELL/2;
    if (facing==='right')      ax+=CELL-2;
    else if (facing==='left')  ax-=CELL-2;
    else if (facing==='down')  ay+=CELL-2;
    else                        ay-=CELL-2;
    ctx.beginPath(); ctx.arc(ax,ay,5,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
  }

  // HP bar
  const hpR=ch.hp/ch.maxHp;
  ctx.fillStyle='#222';
  ctx.fillRect(x,y+CELL+1,CELL,2);
  ctx.fillStyle=hpR>0.5?'#2ecc40':hpR>0.25?'#f39c12':'#e74c3c';
  ctx.fillRect(x,y+CELL+1,CELL*hpR,2);

  // Name
  ctx.fillStyle=isPlayer?'#fff':'#ddd';
  ctx.font='7px monospace';
  ctx.textAlign='center';
  ctx.fillText(ch.name,x+CELL/2,y-2);
}

// ── HUD ───────────────────────────────────────────────
function updateHUD() {
  const p=S.player; if (!p) return;
  const now=Date.now();
  const hpR=(p.hp/p.maxHp*100).toFixed(0);
  const hpCol=p.hp/p.maxHp>0.5?'#2ecc40':p.hp/p.maxHp>0.25?'#f39c12':'#e74c3c';

  document.getElementById('hud-hp').innerHTML=`
    <div class="hud-label">HP</div>
    <div class="hud-bar"><div class="hud-bar-fill" style="width:${hpR}%;background:${hpCol}"></div></div>
    <div class="hud-value" style="color:${hpCol}">${p.hp} / ${p.maxHp}</div>`;

  document.getElementById('hud-stats').innerHTML=`
    <div class="hud-label">캐릭터 스탯</div>
    <div style="font-size:12px;color:#aaa">이동속도: <strong style="color:#fff">${p.speed}</strong></div>
    <div style="font-size:12px;color:#aaa">최대 운반: <strong style="color:#fff">${p.carryMax}</strong></div>`;

  const carryHtml=p.carrying.length?p.carrying.map(b=>{
    const clr=bundleColor(b);
    const pct=Math.min(100,(now-b.createdAt)/RIPEN_MS*100|0);
    return `<span style="color:${clr};font-size:12px">■ ${b.type[0].toUpperCase()} ${b.isRipe?'✓':pct+'%'}</span>`;
  }).join('<br>'):'<span style="color:#555;font-size:11px">없음</span>';
  document.getElementById('hud-carrying').innerHTML=`
    <div class="hud-label">운반 중 (${p.carrying.length}/${p.carryMax})</div>${carryHtml}`;

  const ripenHtml=p.carrying.length?p.carrying.map(b=>{
    const clr=bundleColor(b);
    const pct=Math.min(100,(now-b.createdAt)/RIPEN_MS*100|0);
    return `<div class="hud-ripen">
      <span style="color:${clr}">■</span>
      <div class="hud-bar"><div class="hud-bar-fill" style="width:${pct}%;background:${clr}"></div></div>
      ${b.isRipe?'<span style="color:#aaa;font-size:10px">완료</span>':''}
    </div>`;
  }).join(''):'<span style="color:#555;font-size:11px">없음</span>';
  document.getElementById('hud-ripening').innerHTML=`<div class="hud-label">숙성 현황</div>${ripenHtml}`;

  const burrowHtml=S.burrows.map(bw=>{
    const isMe=bw.owner===p;
    const topClr=bw.topBundle?bundleColor(bw.topBundle):'#444';
    const barW=Math.min(100,bw.count/WIN_COUNT*100);
    return `<div class="hud-burrow-row${isMe?' my-burrow':''}">
      <span>${bw.owner?.name||'?'} ${isMe?'(나)':''}</span>
      <span style="color:${topClr}">${bw.topBundle?'■':''} ${bw.count}/${WIN_COUNT}</span>
    </div>
    <div class="hud-bar" style="margin-bottom:4px">
      <div class="hud-bar-fill" style="width:${barW}%;background:${isMe?'#e94560':'#444'}"></div>
    </div>`;
  }).join('');
  document.getElementById('hud-burrows').innerHTML=`<div class="hud-label">굴 현황</div>${burrowHtml}`;
}

// ── GAME LOOP ─────────────────────────────────────────
let _rafId=null, _lastT=0;

function gameLoop(ts) {
  const dt=Math.min(ts-(_lastT||ts), 60);
  _lastT=ts;
  updateGame(dt);
  render();
  updateHUD();
  if (state.screen==='game') _rafId=requestAnimationFrame(gameLoop);
}

function startLoop() {
  if (_rafId) cancelAnimationFrame(_rafId);
  _lastT=0;
  _rafId=requestAnimationFrame(gameLoop);
}

function stopLoop() {
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId=null; }
}

// ── SCREEN MANAGEMENT ────────────────────────────────
const state = { screen:'title', selectedChar:null, storyIdx:0 };

function showScreen(name) {
  state.screen=name;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el=document.getElementById('screen-'+name);
  if (el) el.classList.add('active');
  const gw=document.getElementById('game-wrapper');
  if (name==='game') {
    gw.style.display='flex';
    startLoop();
  } else {
    gw.style.display='none';
    if (name!=='game') stopLoop();
  }
}

function endGame(result) {
  S.gameOver=true;
  stopLoop();
  patchSave({lastChar:state.selectedChar});
  if (result==='win') {
    SFX.win();
    document.getElementById('win-desc').textContent=
      `${CHAR_DEFS[state.selectedChar].name}으로 굴에 풀더미 ${WIN_COUNT}개를 쌓았습니다!`;
    showScreen('win');
  } else {
    SFX.lose();
    const reason=S.player.hp<=0?'HP가 0이 됐습니다.':'다른 쥐토끼가 먼저 30개를 쌓았습니다.';
    document.getElementById('lose-desc').textContent=reason;
    showScreen('lose');
  }
}

// ── STORY ─────────────────────────────────────────────
function showStoryScreen() {
  state.storyIdx=0; showScreen('story'); renderStory();
}
function renderStory() {
  const s=STORY_SCENES[state.storyIdx];
  document.getElementById('story-scene').textContent=s.emoji;
  document.getElementById('story-text').textContent=s.text;
  document.getElementById('story-progress').textContent=`${state.storyIdx+1} / ${STORY_SCENES.length}`;
}
function advanceStory() {
  state.storyIdx++;
  if (state.storyIdx>=STORY_SCENES.length) { showScreen('rules'); }
  else renderStory();
}

// ── COUNTDOWN ─────────────────────────────────────────
function startCountdown() {
  showScreen('countdown');
  let n=5;
  const el=document.getElementById('countdown-number');
  el.textContent=n;
  const tick=()=>{
    n--;
    if (n<=0) { el.textContent='GO!'; setTimeout(()=>showScreen('game'),600); }
    else { el.textContent=n; setTimeout(tick,1000); }
  };
  setTimeout(tick,1000);
}

// ── CHAR SELECT ───────────────────────────────────────
function buildCharSelect() {
  const save=loadSave();
  const grid=document.getElementById('charselect-grid');
  grid.innerHTML='';
  const keys=['Enter','A','S','D'];
  Object.entries(CHAR_DEFS).forEach(([type,def],i)=>{
    const card=document.createElement('div');
    card.className='char-card'+(save.lastChar===type?' last-played':'');
    card.innerHTML=`
      <div class="char-key">[${keys[i]}]</div>
      <div class="char-icon" style="background:${def.color}"></div>
      <div class="char-name">${def.name}</div>
      <div class="char-desc">${def.desc}</div>
      <div class="char-stats">
        <span>HP: ${def.startHp}/${def.maxHp}</span>
        <span>속도: ${def.speed}</span>
        <span>운반: ${def.carry}</span>
      </div>`;
    card.onclick=()=>pickChar(type);
    grid.appendChild(card);
  });
}

function pickChar(type) {
  state.selectedChar=type;
  initGame();
  showStoryScreen();
}

// ── INPUT ─────────────────────────────────────────────
window.addEventListener('keydown', e=>{
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
  if (!S.keys?.[e.key]) {
    if (!S.justPressed) S.justPressed={};
    S.justPressed[e.key]=true;
  }
  if (S.keys) S.keys[e.key]=true;

  if (state.screen==='charselect') {
    const types=['pika','rpika','pyka','hika'];
    if (e.key==='Enter') pickChar(types[0]);
    else if (e.key==='a'||e.key==='A') pickChar(types[1]);
    else if (e.key==='s'||e.key==='S') pickChar(types[2]);
    else if (e.key==='d'||e.key==='D') pickChar(types[3]);
  }
  if (state.screen==='story' && (e.key==='Enter'||e.key===' ')) advanceStory();
});

window.addEventListener('keyup', e=>{
  if (S.keys) S.keys[e.key]=false;
});

// ── TITLE DECORATION ──────────────────────────────────
function buildTitleBg() {
  const bg=document.getElementById('title-bg');
  const emojis=['🐰','🌿','🌱','☘️','🐇'];
  for (let i=0;i<8;i++) {
    const el=document.createElement('div');
    el.className='title-runner';
    el.textContent=emojis[i%emojis.length];
    el.style.top=`${10+i*11}%`;
    el.style.animationDuration=`${5+i*1.5}s`;
    el.style.animationDelay=`${-i*2}s`;
    if (i%2===1) {
      el.style.animationName='none';
      el.style.right='-60px'; el.style.left='auto';
      el.style.animation=`runBack ${5+i*1.5}s linear ${-i*2}s infinite`;
    }
    bg.appendChild(el);
  }
}

// ── BOOT ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', ()=>{
  // Add reverse runner animation
  const style=document.createElement('style');
  style.textContent=`@keyframes runBack{from{right:-60px}to{right:calc(100% + 60px)}}`;
  document.head.appendChild(style);

  buildTitleBg();

  // Title save info
  const sv=loadSave();
  if (sv.lastChar) {
    const d=CHAR_DEFS[sv.lastChar];
    document.getElementById('title-save-info').textContent=`마지막 플레이: ${d?.name||sv.lastChar}`;
  }

  // Button wiring
  document.getElementById('btn-title-start').onclick=()=>{ showScreen('charselect'); buildCharSelect(); };
  document.getElementById('btn-charselect-back').onclick=()=>showScreen('title');
  document.getElementById('btn-story-skip').onclick=()=>{ state.storyIdx=STORY_SCENES.length-1; advanceStory(); };
  document.getElementById('btn-story-next').onclick=()=>advanceStory();
  document.getElementById('btn-rules-start').onclick=()=>startCountdown();

  document.getElementById('btn-win-replay').onclick=()=>{ initGame(); startCountdown(); };
  document.getElementById('btn-win-reselect').onclick=()=>{ showScreen('charselect'); buildCharSelect(); };
  document.getElementById('btn-win-title').onclick=()=>showScreen('title');

  document.getElementById('btn-lose-continue').onclick=()=>showScreen('gameover');
  document.getElementById('btn-gameover-replay').onclick=()=>{ initGame(); startCountdown(); };
  document.getElementById('btn-gameover-reselect').onclick=()=>{ showScreen('charselect'); buildCharSelect(); };
  document.getElementById('btn-gameover-title').onclick=()=>showScreen('title');

  showScreen('title');
});
