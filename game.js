'use strict';
// ════════════════════════════════════════════════════════
//  PIKA-PIKA  |  쥐토끼의 겨울나기
// ════════════════════════════════════════════════════════

// ── CONSTANTS ─────────────────────────────────────────
const CELL        = 24;
const COLS        = 30;
const ROWS        = 30;
const CW          = COLS * CELL;   // 600
const CH          = ROWS * CELL;   // 600
const WIN_COUNT   = 30;
const RIPEN_MS    = 10000;
const HP_DRAIN_S  = 1;
const INTERACT_PX = CELL * 2;
const GRASS_SAFE  = 4;   // cell radius
const OBS_SAFE    = 3;   // cell radius around burrows
const OBSTACLE_RATIO = 0.08;

// tile
const T_EMPTY = 0, T_ROCK = 1, T_WATER = 2, T_BURROW = 3;

// ── CHARACTER DEFS ────────────────────────────────────
const CHAR_DEFS = {
  pika:  { name:'Pika',  startHp:150, maxHp:200, speed:6,  carry:2, color:'#c4945a', earColor:'#b07840', desc:'그냥 쥐토끼',          behavior:'balanced' },
  rpika: { name:'Rpika', startHp:200, maxHp:250, speed:4,  carry:4, color:'#e8dfc8', earColor:'#d0c0a0', desc:'털이 복슬복슬한 쥐토끼', behavior:'defensive' },
  pyka:  { name:'Pyka',  startHp:90,  maxHp:200, speed:8,  carry:1, color:'#6a6a8a', earColor:'#5a5a7a', desc:'매끈매끈한 쥐토끼',    behavior:'fast' },
  hika:  { name:'Hika',  startHp:100, maxHp:200, speed:5,  carry:3, color:'#8a6040', earColor:'#7a5030', desc:'카우보이 쥐토끼',      behavior:'thief' },
};

const BURROW_CORNERS = [
  { cx:1,  cy:1  },
  { cx:28, cy:1  },
  { cx:1,  cy:28 },
  { cx:28, cy:28 },
];

// ── STORY ─────────────────────────────────────────────
const STORY_SCENES = [
  { img:'assets/story-1-sunny-day.png', text:'아 대충 등 따숩고 햇볕 들고 좋다~ 평생 이러고 살고 싶다' },
  { img:'assets/story-2-winter-is-coming.png', text:'❄️ 어...? 갑자기 웬 겨울 폭풍이여...? ❄️' },
  { img:'assets/story-3-empty-home.png', text:'아... 겨울나기 준비 안 했다....! 😱😱😱' },
  { img:'assets/story-4-harvest-time.png', text:'🌿 빨리 풀더미를 모으자! 🏃' },
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
  countdownTick: () => tone(660, 'sine', 0.15),
  countdownGo:   () => { tone(880,'sine',0.12); setTimeout(()=>tone(1100,'sine',0.12),80); setTimeout(()=>tone(1320,'sine',0.18),160); },
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
// Returns true if (cx,cy) is adjacent (8-dir) to any obstacle
function adjToObs(map, cx, cy) {
  for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
    if (!dx&&!dy) continue;
    const nx=cx+dx, ny=cy+dy;
    if (nx<0||ny<0||nx>=COLS||ny>=ROWS) continue;
    if (map[ny][nx]!==T_EMPTY && map[ny][nx]!==T_BURROW) return true;
  }
  return false;
}
// Returns true if placing at (cx,cy) keeps cluster-to-cluster distance >= 2
function clusterSafe(map, cx, cy) {
  // Check that no obstacle exists within chebyshev distance 2
  // (except direct neighbours which form the same cluster)
  for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++) {
    if (Math.abs(dx)<=1&&Math.abs(dy)<=1) continue; // same cluster OK
    const nx=cx+dx, ny=cy+dy;
    if (nx<0||ny<0||nx>=COLS||ny>=ROWS) continue;
    if (map[ny][nx]!==T_EMPTY && map[ny][nx]!==T_BURROW) return false;
  }
  return true;
}

function makeMap() {
  const map = Array.from({length:ROWS}, ()=>new Uint8Array(COLS));
  const n = Math.floor(COLS*ROWS*OBSTACLE_RATIO);
  let placed=0, tries=0;
  while (placed<n && tries<20000) {
    tries++;
    const cx=ri(0,COLS-1), cy=ri(0,ROWS-1);
    if (map[cy][cx]!==T_EMPTY) continue;
    if (BURROW_CORNERS.some(b=>cdist(cx,cy,b.cx,b.cy)<=OBS_SAFE)) continue;
    // Allow adjacent to existing obstacle (same cluster), but clusters must be 2 apart
    if (!adjToObs(map,cx,cy) && !clusterSafe(map,cx,cy)) continue;
    if (adjToObs(map,cx,cy)) {
      // Extending existing cluster — just check no other cluster too close
      if (!clusterSafe(map,cx,cy)) continue;
    }
    map[cy][cx] = bern(0.5) ? T_ROCK : T_WATER;
    placed++;
  }
  return map;
}

// Mark burrow cells as T_BURROW (impassable), leave entrance walkable
function markBurrows(map, burrows) {
  for (const bw of burrows) {
    const entryCx=bw.cx, entryCy=bw.cy <= ROWS/2 ? bw.cy+1 : bw.cy-1; // entrance faces map center
    bw.entryCx=entryCx; bw.entryCy=entryCy;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
      const nx=bw.cx+dx, ny=bw.cy+dy;
      if (nx<0||ny<0||nx>=COLS||ny>=ROWS) continue;
      if (nx===entryCx && ny===entryCy) continue; // entrance stays walkable
      map[ny][nx]=T_BURROW;
    }
  }
}

function walkable(cx,cy) {
  if (cx<0||cy<0||cx>=COLS||cy>=ROWS) return false;
  const t=S.map[cy][cx];
  if (t===T_EMPTY) return true;
  if (t===T_BURROW) return S.burrows.some(bw=>bw.entryCx===cx && bw.entryCy===cy);
  return false;
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
function makeBundle(cx,cy,type,carrier=null,offset=0,owner=null) {
  const b = {id:_bid++, x:c2px(cx), y:c2px(cy), type, effectType:type,
             createdAt:Date.now(), isRipe:false, carrier, stored:false,
             storedIn:null, stackOff:offset,
             ownedBy:owner, ownedUntil:owner?Date.now()+2000:0};
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
    // Start at entrance if available, otherwise burrow center
    const ex=brow.entryCx!=null?brow.entryCx:brow.cx;
    const ey=brow.entryCy!=null?brow.entryCy:brow.cy;
    this.x=c2px(ex); this.y=c2px(ey);
    this.facing='down';
    this.carrying=[];
    this.isDead=false;
    this.swingCd=0; this.swingAnim=0;
    this.stealCd=0; this.consumeCd=0;
    this.attackHits=0; // hits received from attacker (for counter mechanic)
    this.aiState='SEEK'; this.aiTarget=null; this.aiTimer=0; this.aiStuck=0;
    this.aiPath=null; this.aiPathTarget=null; this.aiPathTimer=0;
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
  const now=Date.now();
  for (const b of S.bundles) {
    if (b.carrier||b.stored) continue;
    if (b.ownedBy && b.ownedBy!==char && now<b.ownedUntil) continue;
    const bx=b.x+CELL/2, by=b.y+CELL/2;
    const d=pdist(char.midX,char.midY,bx,by);
    if (d<=INTERACT_PX && d<bd) { bd=d; best=b; }
  }
  return best;
}

function burrowInRange(char, includeOwn=true) {
  for (const bw of S.burrows) {
    if (!includeOwn && bw===char.burrow) continue;
    const ep=burrowEntryPx(bw);
    const d=pdist(char.midX,char.midY,ep.x,ep.y);
    if (d<=INTERACT_PX*2) return bw;
  }
  return null;
}

// ── PLAYER ACTIONS ────────────────────────────────────
// Check if a character is close enough to hit another
function charInAttackRange(attacker) {
  let best=null, bd=Infinity;
  for (const ch of S.characters) {
    if (ch===attacker||ch.isDead) continue;
    const d=pdist(attacker.midX,attacker.midY,ch.midX,ch.midY);
    if (d<=INTERACT_PX && d<bd) { bd=d; best=ch; }
  }
  return best;
}

function doSwing(char) {
  if (char.swingCd>0) return;
  char.swingCd=380; char.swingAnim=180;
  SFX.swing();

  // Try to hit another character first
  const target=charInAttackRange(char);
  if (target) {
    // Defender can cancel one attack hit if they have pending hits on attacker
    if (target.attackHits>0 && char.attackHits>0) {
      char.attackHits = Math.max(0, char.attackHits-1);
      return;
    }
    target.attackHits = (target.attackHits||0)+1;
    if (target.attackHits>=3) {
      target.attackHits=0;
      // Force target to drop all carried bundles
      for (const b of [...target.carrying]) {
        b.carrier=null; b.x=target.x; b.y=target.y;
        b.ownedBy=null; b.ownedUntil=0;
      }
      target.carrying=[];
    }
    return;
  }

  const g=grassInRange(char);
  if (!g) return;
  g.hits++;
  if (g.hits>=3) {
    const i=S.grasses.indexOf(g);
    if (i>=0) S.grasses.splice(i,1);
    SFX.harvest();
    const b=makeBundle(g.cx,g.cy,g.type,null,0,char);
    if (bern(0.3)) makeBundle(g.cx,g.cy,g.type,null,3,char);
    // auto-pickup
    if (char.carrying.length<char.carryMax) {
      b.carrier=char; char.carrying.push(b);
      b.ownedBy=null;
    }
  }
}

function doPickup(char) {
  if (char.carrying.length>0) {
    const nearby=bundleInRange(char);
    if (nearby) {
      if (char.carrying.length<char.carryMax) {
        // 근처 풀더미 추가 픽업
        nearby.carrier=char; char.carrying.push(nearby);
      } else {
        // 최대치 → 하나 내려놓음
        const b=char.carrying.at(-1);
        b.carrier=null; b.x=char.x; b.y=char.y;
        b.ownedBy=char; b.ownedUntil=Date.now()+1000;
        char.carrying.splice(char.carrying.length-1,1);
      }
    } else {
      // 근처 풀더미 없음 → 하나 내려놓음
      const b=char.carrying.at(-1);
      b.carrier=null; b.x=char.x; b.y=char.y;
      b.ownedBy=char; b.ownedUntil=Date.now()+1000;
      char.carrying.splice(char.carrying.length-1,1);
    }
    return;
  }
  // pickup from ground (priority — dropped bundles should always be reachable)
  const b=bundleInRange(char);
  if (b && char.carrying.length<char.carryMax) {
    b.carrier=char; char.carrying.push(b);
    return;
  }
  // pull from nearby burrow (fallback when no ground bundles nearby)
  const bw=burrowInRange(char,true);
  if (bw && bw.stored.length>0 && char.carrying.length<char.carryMax) {
    const isOther = bw!==char.burrow;
    if (isOther && char.stealCd>0) return;
    const b2=bw.stored.at(-1);
    bw.stored.splice(bw.stored.length-1,1);
    bw.topBundle=bw.stored.at(-1)||null;
    bw.count--;
    b2.stored=false; b2.storedIn=null; b2.carrier=char;
    char.carrying.push(b2);
    if (isOther) char.stealCd=1000;
  }
}

function doConsume(char) {
  // from burrow
  const bw=burrowInRange(char,true);
  if (bw && bw.stored.length>0) {
    const isOther = bw!==char.burrow;
    if (isOther && char.consumeCd>0) return;
    const b=bw.stored.at(-1);
    bw.stored.splice(bw.stored.length-1,1);
    bw.topBundle=bw.stored.at(-1)||null;
    bw.count--;
    b.stored=false; b.storedIn=null;
    consumeBundle(b,char);
    if (isOther) char.consumeCd=1000;
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

function burrowEntryPx(bw) {
  const ex = bw.entryCx!=null ? bw.entryCx : bw.cx;
  const ey = bw.entryCy!=null ? bw.entryCy : bw.cy;
  return { x: c2px(ex)+CELL/2, y: c2px(ey)+CELL/2 };
}

function checkAutoDeposit(char) {
  if (!char.carrying.length) return;
  const bw=char.burrow;
  const ep=burrowEntryPx(bw);
  const d=pdist(char.midX,char.midY,ep.x,ep.y);
  if (d<=INTERACT_PX*2) {
    while (char.carrying.length) depositBundle(char.carrying[0],bw);
  }
}

// ── AI ────────────────────────────────────────────────
function nearestHerbBundle(char) {
  let best=null, bd=Infinity;
  const now=Date.now();
  for (const b of S.bundles) {
    if (b.carrier||b.stored) continue;
    if (b.ownedBy && b.ownedBy!==char && now<b.ownedUntil) continue;
    if (b.effectType!=='herb') continue;
    const d=pdist(char.midX,char.midY,b.x+CELL/2,b.y+CELL/2);
    if (d<bd) { bd=d; best=b; }
  }
  return best;
}

function nearestHerbGrass(char) {
  let best=null, bd=Infinity;
  for (const g of S.grasses) {
    if (g.type!=='herb') continue;
    const d=pdist(char.midX,char.midY,c2px(g.cx)+CELL/2,c2px(g.cy)+CELL/2);
    if (d<bd) { bd=d; best=g; }
  }
  return best;
}

// Find nearest grass that is actually reachable via BFS
function nearestReachableGrass(char) {
  if (!S.grasses.length) return null;
  const sorted=[...S.grasses].sort((a,b)=>
    pdist(char.midX,char.midY,c2px(a.cx)+CELL/2,c2px(a.cy)+CELL/2) -
    pdist(char.midX,char.midY,c2px(b.cx)+CELL/2,c2px(b.cy)+CELL/2)
  );
  for (const g of sorted.slice(0,8)) {
    if (bfsPath(char.cx,char.cy,g.cx,g.cy)!==null) return g;
  }
  return sorted[0]; // fallback: nearest even if unreachable
}

function updateAI(char, dt) {
  if (char.isDead) return;
  char.swingCd  = Math.max(0, char.swingCd-dt);
  char.stealCd  = Math.max(0, (char.stealCd||0)-dt);
  char.consumeCd= Math.max(0, (char.consumeCd||0)-dt);
  char.aiTimer -= dt;

  // ── Stuck detection: reset path if position unchanged for 1.5s ──
  if (!char._lastPos) char._lastPos={x:char.x,y:char.y,t:0};
  if (Math.abs(char.x-char._lastPos.x)>1||Math.abs(char.y-char._lastPos.y)>1) {
    char._lastPos={x:char.x,y:char.y,t:0};
  } else {
    char._lastPos.t+=dt;
    if (char._lastPos.t>1500) {
      // Stuck — clear BFS cache and reset to SEEK
      char.aiPath=null; char.aiPathTarget=null; char.aiPathTimer=0;
      char._lastPos.t=0;
      if (char.aiState!=='IDLE') { char.aiState='SEEK'; char.aiTarget=null; }
    }
  }

  // ── HP survival: eat carried herb if HP < 50% ──
  const hpRatio = char.hp/char.maxHp;
  if (hpRatio < 0.5) {
    const h=char.carrying.find(b=>b.effectType==='herb'||(b.effectType==='poison'&&b.isRipe));
    if (h) {
      const i=char.carrying.indexOf(h); char.carrying.splice(i,1); h.carrier=null;
      consumeBundle(h,char); return;
    }
  }

  // ── HP survival: seek herb bundle/grass if HP < 40% ──
  if (hpRatio < 0.4 && char.aiState!=='EAT_HERB') {
    const hb=nearestHerbBundle(char);
    if (hb) { char.aiState='EAT_HERB'; char.aiTarget=hb; }
    else {
      const hg=nearestHerbGrass(char);
      if (hg) { char.aiState='HARVEST_HERB'; char.aiTarget=hg; }
    }
  }

  const beh=char.behavior;
  switch(char.aiState) {

    case 'EAT_HERB': {
      const hb=char.aiTarget;
      if (!hb||hb.carrier||hb.stored) { char.aiState='SEEK'; break; }
      aiMoveToward(char, hb.x, hb.y, dt);
      if (pdist(char.midX,char.midY,hb.x+CELL/2,hb.y+CELL/2)<=INTERACT_PX) {
        if (char.carrying.length<char.carryMax) {
          hb.carrier=char; char.carrying.push(hb);
        }
        // eat immediately
        const i=char.carrying.indexOf(hb);
        if (i>=0) { char.carrying.splice(i,1); hb.carrier=null; consumeBundle(hb,char); }
        char.aiState='SEEK'; char.aiTarget=null;
      }
      break;
    }

    case 'HARVEST_HERB': {
      const hg=char.aiTarget;
      if (!hg||!S.grasses.includes(hg)) { char.aiState='SEEK'; break; }
      aiMoveToward(char,c2px(hg.cx),c2px(hg.cy),dt);
      if (pdist(char.midX,char.midY,c2px(hg.cx)+CELL/2,c2px(hg.cy)+CELL/2)<=INTERACT_PX) {
        char.facing=char.midX<c2px(hg.cx)+CELL/2?'right':'left';
        doSwing(char);
        // After harvest, bundle auto-picked up → will eat on next tick via carry check
        if (!S.grasses.includes(hg)) { char.aiState='SEEK'; char.aiTarget=null; }
      }
      break;
    }

    case 'SEEK': {
      // Thief: occasionally steal if opponent burrow has many bundles
      if (beh==='thief' && bern(0.002) && char.carrying.length===0) {
        const rich=S.burrows.filter(b=>b!==char.burrow&&b.count>3).sort((a,b_)=>b_.count-a.count)[0];
        if (rich) { char.aiState='STEAL'; char.aiTarget=rich; break; }
      }
      // Defensive: deposit immediately when carrying
      if (beh==='defensive' && char.carrying.length>0) {
        char.aiState='DEPOSIT'; break;
      }
      // Pick a reachable target only when we don't have one (or it's gone)
      if (!char.aiTarget || !S.grasses.includes(char.aiTarget)) {
        char.aiTarget = nearestReachableGrass(char);
        char.aiPath = null; // reset path for new target
      }
      const g=char.aiTarget;
      if (!g) { char.aiState='IDLE'; break; }
      aiMoveToward(char,c2px(g.cx),c2px(g.cy),dt);
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
      const ep=burrowEntryPx(bw);
      aiMoveToward(char, ep.x-CELL/2, ep.y-CELL/2, dt);
      checkAutoDeposit(char);
      if (!char.carrying.length) char.aiState='SEEK';
      break;
    }

    case 'STEAL': {
      const bw=char.aiTarget;
      if (!bw||bw.count===0) { char.aiState='SEEK'; break; }
      const ep=burrowEntryPx(bw);
      aiMoveToward(char, ep.x-CELL/2, ep.y-CELL/2, dt);
      if (pdist(char.midX,char.midY,ep.x,ep.y)<=INTERACT_PX*2) {
        if (bw.stored.length>0 && char.carrying.length<char.carryMax && char.stealCd<=0) {
          const b=bw.stored.at(-1);
          bw.stored.splice(bw.stored.length-1,1);
          bw.topBundle=bw.stored.at(-1)||null;
          bw.count--;
          b.stored=false; b.storedIn=null; b.carrier=char;
          char.carrying.push(b);
          char.stealCd=1000;
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

// ── BFS PATHFINDING ───────────────────────────────────
function bfsPath(startCx, startCy, goalCx, goalCy) {
  if (startCx===goalCx && startCy===goalCy) return [];
  const parent = new Int16Array(COLS*ROWS).fill(-1);
  const startIdx = startCy*COLS+startCx;
  const goalIdx  = goalCy*COLS+goalCx;
  parent[startIdx] = startIdx;
  const queue = [startIdx];
  const dirs = [-COLS, COLS, -1, 1];
  const borderCheck = [
    idx=>((idx/COLS)|0)>0,
    idx=>((idx/COLS)|0)<ROWS-1,
    idx=>(idx%COLS)>0,
    idx=>(idx%COLS)<COLS-1,
  ];
  let found = false;
  outer: while (queue.length) {
    const idx = queue.shift();
    for (let d=0;d<4;d++) {
      if (!borderCheck[d](idx)) continue;
      const nIdx = idx+dirs[d];
      if (parent[nIdx]>=0) continue;
      const ny=(nIdx/COLS)|0, nx=nIdx%COLS;
      if (!walkable(nx,ny)) continue;
      parent[nIdx]=idx;
      if (nIdx===goalIdx) { found=true; break outer; }
      queue.push(nIdx);
    }
  }
  if (!found) return null;
  const path=[];
  let cur=goalIdx;
  while (cur!==startIdx) {
    path.unshift([cur%COLS,(cur/COLS)|0]);
    cur=parent[cur];
  }
  return path;
}

function aiMoveToward(char, tx, ty, dt) {
  const goalCx=px2c(tx), goalCy=px2c(ty);
  // Recalculate BFS path when target changes or timer expires
  const targetChanged = !char.aiPathTarget ||
    char.aiPathTarget[0]!==goalCx || char.aiPathTarget[1]!==goalCy;
  if (targetChanged || !char.aiPath || char.aiPathTimer<=0) {
    char.aiPath = bfsPath(char.cx, char.cy, goalCx, goalCy);
    char.aiPathTarget = [goalCx, goalCy];
    char.aiPathTimer = 800;
  }
  char.aiPathTimer -= dt;

  // Advance path: pop nodes already reached
  while (char.aiPath && char.aiPath.length>0) {
    const [ncx,ncy]=char.aiPath[0];
    const ndx=c2px(ncx)+CELL/2-char.midX, ndy=c2px(ncy)+CELL/2-char.midY;
    if (Math.sqrt(ndx*ndx+ndy*ndy)<CELL*0.6) char.aiPath.shift();
    else break;
  }

  let dx, dy;
  if (char.aiPath && char.aiPath.length>0) {
    const [ncx,ncy]=char.aiPath[0];
    dx=c2px(ncx)+CELL/2-char.midX; dy=c2px(ncy)+CELL/2-char.midY;
  } else {
    dx=tx-char.x; dy=ty-char.y;
  }
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
  markBurrows(S.map, S.burrows);

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
    p.stealCd=Math.max(0,(p.stealCd||0)-dt);
    p.consumeCd=Math.max(0,(p.consumeCd||0)-dt);

    if (S.justPressed['a']||S.justPressed['A']||S.justPressed['ㅁ']) doSwing(p);
    if (S.justPressed['s']||S.justPressed['S']||S.justPressed['ㄴ']) doPickup(p);
    if (S.justPressed['d']||S.justPressed['D']||S.justPressed['ㅇ']) doConsume(p);

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
    } else if (tot<45) {
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
  ['#3a2a1a','#4a3a2a'],  // burrow
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
    if (t===T_ROCK||t===T_WATER) {
      ctx.font=`${CELL-4}px serif`;
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.fillText(t===T_ROCK?'🪨':'💧', cx*CELL+CELL/2, cy*CELL+CELL/2);
    }
  }
  ctx.textBaseline='alphabetic';
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
    // Entrance (black cell at bottom-center)
    if (bw.entryCx!=null) {
      ctx.fillStyle='#000';
      ctx.fillRect(c2px(bw.entryCx), c2px(bw.entryCy), CELL, CELL);
    }
    // Top bundle indicator — large colored square in top-right of burrow
    if (bw.topBundle) {
      const bc=bundleColor(bw.topBundle);
      const bsz=10;
      ctx.fillStyle='rgba(0,0,0,0.5)';
      ctx.fillRect(px+sz-bsz-3, py+3, bsz+2, bsz+2);
      ctx.fillStyle=bc;
      ctx.fillRect(px+sz-bsz-2, py+4, bsz, bsz);
      // Ripe special flash
      if (bw.topBundle.isRipe && bw.topBundle.type==='special' && Math.sin(Date.now()/200)>0) {
        ctx.strokeStyle='#ff2020'; ctx.lineWidth=1.5;
        ctx.strokeRect(px+sz-bsz-2, py+4, bsz, bsz);
        ctx.lineWidth=1;
      }
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

const GRASS_EMOJI = { herb:'🌿', poison:'🍄', special:'🌸' };

function drawGrasses() {
  ctx.font=`${CELL-2}px serif`;
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  for (const g of S.grasses) {
    const px=c2px(g.cx), py=c2px(g.cy);
    ctx.fillText(GRASS_EMOJI[g.type]||'🌿', px+CELL/2, py+CELL/2);
    // harvest bar
    if (g.hits>0) {
      ctx.fillStyle='rgba(255,255,255,0.85)';
      ctx.fillRect(px+2,py+CELL-3,(CELL-4)*(g.hits/3),2);
    }
  }
  ctx.textBaseline='alphabetic';
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
  ctx.globalAlpha=0.45;
  ctx.font=`${CELL}px serif`;
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.fillText('💀', ch.x+CELL/2, ch.y+CELL/2);
  ctx.globalAlpha=1;
  ctx.textBaseline='alphabetic';
}

const CHAR_EMOJI = { pika:'🐰', rpika:'🐑', pyka:'🐇', hika:'🤠' };

function drawChar(ch) {
  const {x,y,facing,swingAnim,isPlayer,type} = ch;

  // Emoji body
  ctx.font=`${CELL+2}px serif`;
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.fillText(CHAR_EMOJI[type]||'🐰', x+CELL/2, y+CELL/2);
  ctx.textBaseline='alphabetic';

  // Player indicator: white outline around cell
  if (isPlayer) {
    ctx.strokeStyle='rgba(255,255,255,0.85)';
    ctx.lineWidth=2;
    ctx.strokeRect(x,y,CELL,CELL);
    ctx.lineWidth=1;
  }

  // Swing effect
  if (swingAnim>0) {
    ctx.globalAlpha=swingAnim/180*0.7;
    ctx.fillStyle='#ffe060';
    let ax=x+CELL/2, ay=y+CELL/2;
    if (facing==='right')      ax+=CELL;
    else if (facing==='left')  ax-=CELL;
    else if (facing==='down')  ay+=CELL;
    else                        ay-=CELL;
    ctx.beginPath(); ctx.arc(ax,ay,5,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
  }

  // HP bar
  const hpR=ch.hp/ch.maxHp;
  ctx.fillStyle='#111';
  ctx.fillRect(x,y+CELL+1,CELL,3);
  ctx.fillStyle=hpR>0.5?'#2ecc40':hpR>0.25?'#f39c12':'#e74c3c';
  ctx.fillRect(x,y+CELL+1,CELL*hpR,3);

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

  const carryHtml=p.carrying.length?[...p.carrying].reverse().map((b,revIdx)=>{
    const num=p.carrying.length-revIdx;
    const clr=bundleColor(b);
    const pct=Math.min(100,(now-b.createdAt)/RIPEN_MS*100|0);
    return `<div style="display:flex;align-items:center;gap:5px">
      <span style="color:#555;font-size:10px;min-width:10px;text-align:right">${num}</span>
      <span style="color:${clr};font-size:12px">■ ${b.type[0].toUpperCase()} ${b.isRipe?'✓':pct+'%'}</span>
    </div>`;
  }).join(''):'<span style="color:#555;font-size:11px">없음</span>';
  document.getElementById('hud-carrying').innerHTML=`
    <div class="hud-label">운반 중 (${p.carrying.length}/${p.carryMax})</div>${carryHtml}`;

  const ripenHtml=p.carrying.length?[...p.carrying].reverse().map((b,revIdx)=>{
    const num=p.carrying.length-revIdx;
    const clr=bundleColor(b);
    const pct=Math.min(100,(now-b.createdAt)/RIPEN_MS*100|0);
    return `<div class="hud-ripen">
      <span style="color:#555;font-size:10px;min-width:10px;text-align:right">${num}</span>
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
const state = { screen:'title', selectedChar:null, storyIdx:0, charSelectIdx:0 };

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
function showStoryScreen(idx=0) {
  state.storyIdx=idx; showScreen('story'); renderStory();
}
function retreatStory() {
  if (state.storyIdx>0) { state.storyIdx--; renderStory(); }
  else { showScreen('charselect'); buildCharSelect(); }
}
function renderStory() {
  const s=STORY_SCENES[state.storyIdx];
  const scene=document.getElementById('story-scene');
  if (s.img) {
    scene.innerHTML=`<img src="${s.img}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">`;
  } else {
    scene.innerHTML='';
    scene.textContent=s.emoji;
  }
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
  SFX.countdownTick();
  const tick=()=>{
    n--;
    if (n<=0) {
      el.textContent='GO!';
      SFX.countdownGo();
      setTimeout(()=>showScreen('game'),600);
    } else {
      el.textContent=n;
      SFX.countdownTick();
      setTimeout(tick,1000);
    }
  };
  setTimeout(tick,1000);
}

// ── CHAR SELECT ───────────────────────────────────────
function highlightCharCard(idx) {
  document.querySelectorAll('.char-card').forEach((c,i)=>{
    c.classList.toggle('focused', i===idx);
  });
}

function buildCharSelect() {
  state.charSelectIdx=0;
  const save=loadSave();
  const grid=document.getElementById('charselect-grid');
  grid.innerHTML='';
  Object.entries(CHAR_DEFS).forEach(([type,def],i)=>{
    const card=document.createElement('div');
    card.className='char-card'+(save.lastChar===type?' last-played':'')+(i===0?' focused':'');
    card.innerHTML=`
      <div class="char-key">${i===0?'← →':''}</div>
      <div class="char-emoji-icon">${CHAR_EMOJI[type]}</div>
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
    if (e.key==='ArrowLeft') {
      state.charSelectIdx=(state.charSelectIdx-1+types.length)%types.length;
      highlightCharCard(state.charSelectIdx);
    } else if (e.key==='ArrowRight') {
      state.charSelectIdx=(state.charSelectIdx+1)%types.length;
      highlightCharCard(state.charSelectIdx);
    } else if (e.key==='Enter') {
      e.preventDefault();
      pickChar(types[state.charSelectIdx]);
      return; // prevent fall-through to story handler
    }
  } else if (e.key==='Enter'||e.key===' ') {
    if (state.screen==='title') document.getElementById('btn-title-start').click();
    else if (state.screen==='rules') document.getElementById('btn-rules-start').click();
    else if (state.screen==='story') { e.preventDefault(); advanceStory(); }
  }
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
  document.getElementById('btn-story-back').onclick=()=>retreatStory();
  document.getElementById('btn-story-skip').onclick=()=>{ state.storyIdx=STORY_SCENES.length-1; advanceStory(); };
  document.getElementById('btn-story-next').onclick=()=>advanceStory();
  document.getElementById('btn-rules-back').onclick=()=>showStoryScreen(STORY_SCENES.length-1);
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
