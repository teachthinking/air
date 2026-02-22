// server.js - 直升機空戰伺服器【Server 端物理計算版】
// 新增：高度系統 (3階段)、飛彈系統、制空權機制
// 所有物理運算在此執行，老師端只做地圖編輯與控制，學生端只做渲染
//    Powered by Google Blockly (Apache 2.0) | Educational platform and extensions © 2026 Justin Chang
//    本平台使用 Google Blockly（Apache License 2.0）開發｜教學平台與延伸功能 保留所有權利｜ © 2026 張世杰 (teachthinking@gmail.com)
const express = require('express');
const app = express();
const http = require('http').createServer(app);

const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(__dirname + '/public'));

// ============================================================
//  常數（與前端保持一致）
// ============================================================
const CANVAS_W = 800;
const CANVAS_H = 600;
const BULLET_SPEED = 10;       // 飛彈速度較快
const BULLET_RANGE = 220;      // 飛彈射程
const HELI_RADIUS = 14;        // 直升機碰撞半徑
const BULLET_RADIUS = 5;
const HIT_RADIUS = 16;
const COOLDOWN_TICKS = 20;     // 飛彈冷卻 tick 數
const RESPAWN_MS = 3000;
const TICK_MS = 50;

// ✈️ 高度系統常數
const ALT_LOW   = 1;   // 低空：受地面障礙物影響，速度較慢
const ALT_MID   = 2;   // 中空：正常速度，可飛越低矮障礙物
const ALT_HIGH  = 3;   // 高空：速度快，可飛越高塔，只有高空對高空才能命中
const ALT_ULTRA = 4;   // 超高空：速度最快，可飛越高塔，但無法飛越高山

// 障礙物有高度屬性
// altitude: 1 = 樹木   (只擋低空 alt=1)
// altitude: 2 = 高樓   (擋低空+中空 alt<=2)
// altitude: 3 = 高塔   (擋低空+中空+高空 alt<=3，超高空 alt=4 可越過)
// altitude: 4 = 高山   (擋所有高度，連超高空都不行)
// 預設地圖裡的 emoji 對應高度:
//   🌲 = altitude 1  (樹木)
//   🏢 = altitude 2  (高樓)
//   🗼 = altitude 3  (高塔，超高空可越過)
//   🪨 = altitude 4  (高山，無法飛越)

// ============================================================
//  高度相關速度與命中規則
// ============================================================
function getAltSpeed(alt) {
    if (alt === ALT_LOW)   return 2.5;
    if (alt === ALT_MID)   return 3.5;
    if (alt === ALT_HIGH)  return 4.5;
    if (alt === ALT_ULTRA) return 5.5;
    return 3.5;
}

function canBulletHit(shooterAlt, targetAlt) {
    // 只有完全相同高度才能命中
    return shooterAlt === targetAlt;
}

function obstacleBlocksAlt(obstacleAlt, heliAlt) {
    // 障礙物高度 >= 直升機高度 才會擋住
    return (obstacleAlt || 1) >= heliAlt;
}

// ============================================================
//  預設地圖資料
// ============================================================
let PRESET_MAPS = {
    'map1': [
        // 中央山丘 (高塔)
        { x: 380, y: 260, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        { x: 420, y: 260, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        { x: 380, y: 300, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        { x: 420, y: 300, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        // 低樹叢
        { x: 160, y: 80,  w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 200, y: 80,  w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 160, y: 120, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 200, y: 120, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 560, y: 80,  w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 600, y: 80,  w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 560, y: 120, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 600, y: 120, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 160, y: 480, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 200, y: 480, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 160, y: 440, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 200, y: 440, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 560, y: 480, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 600, y: 480, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 560, y: 440, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 600, y: 440, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        // 中層建築
        { x: 320, y: 160, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 360, y: 160, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 440, y: 160, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 480, y: 160, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 320, y: 440, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 360, y: 440, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 440, y: 440, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 480, y: 440, w: 40, h: 40, emoji: "🏢", altitude: 2 },
    ],
    'map2': [
        // 迷宮式高牆 (全部高塔)
        { x: 240, y: 160, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        { x: 280, y: 160, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        { x: 320, y: 160, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        { x: 440, y: 160, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        { x: 480, y: 160, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        { x: 520, y: 160, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        { x: 520, y: 200, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        { x: 520, y: 240, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        { x: 240, y: 200, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        { x: 240, y: 240, w: 40, h: 40, emoji: "🗼", altitude: 3 },
        { x: 360, y: 280, w: 40, h: 40, emoji: "🪨", altitude: 4 },
        { x: 400, y: 280, w: 40, h: 40, emoji: "🪨", altitude: 4 },
        { x: 400, y: 320, w: 40, h: 40, emoji: "🪨", altitude: 4 },
        { x: 360, y: 320, w: 40, h: 40, emoji: "🪨", altitude: 4 },
        { x: 120, y: 200, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 120, y: 240, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 120, y: 280, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 120, y: 320, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 120, y: 360, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 640, y: 200, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 640, y: 240, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 640, y: 280, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 640, y: 320, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 640, y: 360, w: 40, h: 40, emoji: "🏢", altitude: 2 },
        { x: 240, y: 360, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 240, y: 400, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 240, y: 440, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 520, y: 360, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 520, y: 400, w: 40, h: 40, emoji: "🌲", altitude: 1 },
        { x: 520, y: 440, w: 40, h: 40, emoji: "🌲", altitude: 1 },
    ]
};

// ============================================================
//  從 GitHub 載入外部地圖
// ============================================================
async function loadExternalMaps() {
    try {
        const url = 'https://raw.githubusercontent.com/teachthinking/tank_maps/refs/heads/main/airmaps.json?t=' + Date.now();
        console.log('⏳ 正在從 GitHub 載入外部地圖...');
        const response = await fetch(url);
        if (response.ok) {
            const externalMaps = await response.json();
            // 為外部地圖補上預設高度
            for (const mapId in externalMaps) {
                externalMaps[mapId].forEach(tile => {
                    if (!tile.altitude) {
                        tile.altitude = (tile.emoji === '🪨') ? 4
                                      : (tile.emoji === '🗼') ? 3
                                      : (tile.emoji === '🏢') ? 2 : 1;
                    }
                });
            }
            PRESET_MAPS = { ...PRESET_MAPS, ...externalMaps };
            console.log(`✅ 成功載入外部地圖！目前共有 ${Object.keys(PRESET_MAPS).length} 張地圖。`);
        }
    } catch (error) {
        console.error('🚨 載入外部地圖時發生網路錯誤:', error.message);
    }
}
loadExternalMaps();

// ============================================================
//  房間管理
// ============================================================
const rooms = {};

function getRoom(roomId) {
    if (!rooms[roomId]) {
        rooms[roomId] = {
            players: {},
            bullets: [],
            walls: [],
            scores: { red: 0, blue: 0 },
            timeLeft: 180,
            active: false,
            tickCount: 0,
            loopHandle: null
        };
    }
    return rooms[roomId];
}

// ============================================================
//  碰撞偵測 (考量高度)
// ============================================================
function checkCol(walls, x, y, r, heliAlt) {
    if (x < r || x > CANVAS_W - r || y < r || y > CANVAS_H - r) return true;
    for (const w of walls) {
        // 只有障礙物高度 >= 直升機高度才會阻擋
        if (!obstacleBlocksAlt(w.altitude || 1, heliAlt || 1)) continue;
        if (x > w.x - r && x < w.x + w.w + r &&
            y > w.y - r && y < w.y + w.h + r) return true;
    }
    return false;
}

// ============================================================
//  出生點
// ============================================================
function getSpawn(team, slot) {
    let y = 300;
    if (slot == 1) y = 100;
    else if (slot == 2) y = 300;
    else if (slot == 3) y = 500;
    else if (slot == 4) y = 200;
    else if (slot == 5) y = 400;
    return team === 'red'
        ? { x: 50,  y, a: 0,   alt: ALT_MID }
        : { x: 750, y, a: 180, alt: ALT_MID };
}

function getSafeRandomSpawn(walls) {
    let rx, ry;
    let isSafe = false;
    let attempts = 0;
    while (!isSafe && attempts < 50) {
        rx = 50 + Math.random() * (CANVAS_W - 100);
        ry = 50 + Math.random() * (CANVAS_H - 100);
        if (!checkCol(walls, rx, ry, 20, ALT_MID)) {
            isSafe = true;
        }
        attempts++;
    }
    if (!isSafe) { rx = 100; ry = 100; }
    return { x: rx, y: ry, a: Math.random() * 360, alt: ALT_MID };
}

// ============================================================
//  重生專用：在己方半場挑選遠離敵人的安全出生點
// ============================================================
const RESPAWN_MIN_ENEMY_DIST = 220;
const RESPAWN_MIN_ALLY_DIST  = 60;

function getSafeRespawnPoint(team, players, walls) {
    const xMin = team === 'red' ? 40  : Math.floor(CANVAS_W * 0.55);
    const xMax = team === 'red' ? Math.floor(CANVAS_W * 0.45) : CANVAS_W - 40;

    let best = null;
    let bestScore = -Infinity;

    // 第一輪：硬性要求距敵 >= RESPAWN_MIN_ENEMY_DIST
    for (let attempt = 0; attempt < 80; attempt++) {
        const rx = xMin + Math.random() * (xMax - xMin);
        const ry = 40 + Math.random() * (CANVAS_H - 80);
        if (checkCol(walls, rx, ry, 20, ALT_MID)) continue;

        let minEnemyDist = Infinity;
        let minAllyDist  = Infinity;
        for (const pid in players) {
            const p = players[pid];
            if (p.hp <= 0) continue;
            const d = Math.hypot(p.x - rx, p.y - ry);
            if (p.team !== team) { if (d < minEnemyDist) minEnemyDist = d; }
            else                  { if (d < minAllyDist)  minAllyDist  = d; }
        }
        if (minEnemyDist < RESPAWN_MIN_ENEMY_DIST) continue;

        const score = minEnemyDist - Math.max(0, RESPAWN_MIN_ALLY_DIST - minAllyDist) * 2;
        if (score > bestScore) { bestScore = score; best = { x: rx, y: ry }; }
    }

    // 第二輪（放寬）：取距敵最遠的點
    if (!best) {
        bestScore = -Infinity;
        for (let attempt = 0; attempt < 40; attempt++) {
            const rx = xMin + Math.random() * (xMax - xMin);
            const ry = 40 + Math.random() * (CANVAS_H - 80);
            if (checkCol(walls, rx, ry, 20, ALT_MID)) continue;
            let minEnemyDist = Infinity;
            for (const pid in players) {
                const p = players[pid];
                if (p.hp <= 0 || p.team === team) continue;
                const d = Math.hypot(p.x - rx, p.y - ry);
                if (d < minEnemyDist) minEnemyDist = d;
            }
            if (minEnemyDist > bestScore) { bestScore = minEnemyDist; best = { x: rx, y: ry }; }
        }
    }

    // 最後備案：固定出生點
    if (!best) {
        const fb = getSpawn(team, 2);
        best = { x: fb.x, y: fb.y };
    }

    const angle = team === 'red' ? 0 : 180;
    return { x: best.x, y: best.y, a: angle, alt: ALT_HIGH }; // 重生時先在高空，提供緩衝
}

// ============================================================
//  指令處理
// ============================================================
function applyCmd(room, data) {
    const p = room.players[data.id];
    if (!p || p.hp <= 0) return;

    if (data.action === 'move') {
        p.targetMove = (p.targetMove || 0) + data.val;
    } else if (data.action === 'turn') {
        p.targetAngle = (p.targetAngle !== undefined ? p.targetAngle : p.angle) + data.val;
    } else if (data.action === 'setAngle') {
        // 直接設定絕對朝向角度，一次到位不逐格轉
        p.angle = data.val;
        p.targetAngle = undefined;
    } else if (data.action === 'climb') {
        // 爬升：高度+1 (最高4)
        p.alt = Math.min(ALT_ULTRA, (p.alt || ALT_MID) + 1);
    } else if (data.action === 'descend') {
        // 下降：高度-1 (最低1)
        p.alt = Math.max(ALT_LOW, (p.alt || ALT_MID) - 1);
    } else if (data.action === 'setAlt') {
        // 直接設定高度 1/2/3/4
        let val = parseInt(data.val);
        if (val >= 1 && val <= 4) p.alt = val;
    } else if (data.action === 'fire') {
        if (!room.active) return;
        if (p.cooldown > 0) return;
        room.bullets.push({
            x: p.x, y: p.y,
            angle: p.angle,
            owner: p.id,
            team: p.team,
            alt: p.alt || ALT_MID,   // 🌟 飛彈繼承發射者高度
            distance: 0,
            maxRange: BULLET_RANGE
        });
        p.cooldown = COOLDOWN_TICKS;
    }
}

// ============================================================
//  AI 邏輯 (新增高度策略)
// ============================================================
function updateBots(room) {
    for (let id in room.players) {
        let bot = room.players[id];
        if (!bot.isBot || bot.hp <= 0) continue;

        let target = null;
        let minDist = Infinity;
        for (let eid in room.players) {
            let enemy = room.players[eid];
            if (enemy.team !== bot.team && enemy.hp > 0) {
                let dist = Math.hypot(enemy.x - bot.x, enemy.y - bot.y);
                if (dist < minDist) { minDist = dist; target = enemy; }
            }
        }

        if (target) {
            let level = bot.level || 2;

            // ============================================================
            // ✈️ AI 高度策略系統（三階段動態決策）
            // ============================================================
            if (!bot.altTimer || bot.altTimer <= 0) {
                const targetAlt = target.alt || ALT_MID;
                const myAlt = bot.alt || ALT_MID;
                const altDiff = Math.abs(myAlt - targetAlt);

                if (level === 1) {
                    // Lv1: 隨機偶爾改高度
                    if (Math.random() < 0.15) {
                        const dir = Math.random() < 0.5 ? 'climb' : 'descend';
                        applyCmd(room, { id: bot.id, action: dir });
                    }
                    bot.altTimer = 30;

                } else if (level === 2) {
                    // Lv2: 主動追蹤玩家高度，低HP時嘗試爬升逃脫
                    if (bot.hp < 40 && myAlt < ALT_HIGH && Math.random() < 0.4) {
                        // 受傷了！爬升躲避
                        applyCmd(room, { id: bot.id, action: 'climb' });
                        bot.altEscapeMode = 8; // 持續8tick維持高空逃跑狀態
                    } else if (bot.altEscapeMode > 0) {
                        bot.altEscapeMode--;
                    } else {
                        // 往目標高度靠近以求命中
                        if (myAlt < targetAlt) applyCmd(room, { id: bot.id, action: 'climb' });
                        else if (myAlt > targetAlt) applyCmd(room, { id: bot.id, action: 'descend' });
                    }
                    bot.altTimer = 15;

                } else if (level === 3) {
                    // Lv3: 高智能 - 利用高度差製造無敵窗口 + 精準追蹤
                    if (bot.altEscapeMode > 0) {
                        // 正在執行高度奇兵策略
                        bot.altEscapeMode--;
                        if (bot.altEscapeMode === 4) {
                            // 奇兵：突然切到和目標同高度，立刻攻擊
                            applyCmd(room, { id: bot.id, action: 'setAlt', val: targetAlt });
                        }
                    } else if (bot.hp < 30 && Math.random() < 0.5) {
                        // 瀕死：爬到安全高度拉開距離
                        applyCmd(room, { id: bot.id, action: myAlt < ALT_HIGH ? 'climb' : 'descend' });
                        bot.altEscapeMode = 12;
                    } else if (altDiff === 0 && Math.random() < 0.2) {
                        // 已同高度時，偶爾先跳離一個高度製造「高度差無敵」，再切回攻擊
                        const disengage = myAlt < ALT_HIGH ? 'climb' : 'descend';
                        applyCmd(room, { id: bot.id, action: disengage });
                        bot.altEscapeMode = 8; // 8tick後在第4tick切回去
                    } else {
                        // 精準對準目標高度
                        if (myAlt < targetAlt) applyCmd(room, { id: bot.id, action: 'climb' });
                        else if (myAlt > targetAlt) applyCmd(room, { id: bot.id, action: 'descend' });
                    }
                    bot.altTimer = 8; // 反應更快
                }
            } else {
                bot.altTimer--;
            }

            // 瞄準系統
            if (bot.evadeTimer > 0) {
                bot.evadeTimer--;
                bot.angle += 5;
            } else {
                let dx = target.x - bot.x;
                let dy = target.y - bot.y;
                let targetAngle = Math.atan2(dy, dx) * 180 / Math.PI;
                let diff = ((targetAngle - bot.angle + 540) % 360) - 180;
                let turnSpeed = level === 1 ? 2 : (level === 2 ? 5 : 10);
                if (Math.abs(diff) > turnSpeed) {
                    bot.angle += Math.sign(diff) * turnSpeed;
                } else {
                    bot.angle = targetAngle;
                }
            }

            // 移動決策
            if (!bot.targetMove || Math.abs(bot.targetMove) < 2) {
                if (level === 1) {
                    if (Math.random() < 0.05) bot.targetMove = 10;
                } else if (level === 2) {
                    if (minDist > 120) bot.targetMove = 15;
                } else if (level === 3) {
                    if (minDist > 200) bot.targetMove = 20;
                    else if (minDist < 120) bot.targetMove = -15;
                }
            }

            // 移動執行
            if (bot.targetMove && Math.abs(bot.targetMove) > 0) {
                let speed = getAltSpeed(bot.alt || ALT_MID);
                let step = Math.sign(bot.targetMove) * Math.min(speed, Math.abs(bot.targetMove));
                let rad = bot.angle * (Math.PI / 180);
                let oldX = bot.x, oldY = bot.y;
                bot.x += Math.cos(rad) * step;
                bot.y += Math.sin(rad) * step;

                let hitWall = checkCol(room.walls, bot.x, bot.y, HELI_RADIUS, bot.alt || ALT_MID);
                if (hitWall) {
                    bot.x = oldX; bot.y = oldY;
                    bot.targetMove = bot.targetMove > 0 ? -40 : 40;
                    bot.evadeTimer = 20;
                } else {
                    bot.targetMove -= step;
                }
            }

            // 開火
            let aimTolerance = level === 1 ? 30 : (level === 2 ? 15 : 5);
            let diffForFire = target ? (((Math.atan2(target.y - bot.y, target.x - bot.x) * 180 / Math.PI) - bot.angle + 540) % 360) - 180 : 999;
            // 🌟 只在高度相近時才開火
            const canHit = canBulletHit(bot.alt || ALT_MID, target.alt || ALT_MID);
            if (Math.abs(diffForFire) < aimTolerance && bot.cooldown <= 0 && canHit && (!bot.evadeTimer || bot.evadeTimer <= 0)) {
                applyCmd(room, { id: bot.id, action: 'fire' });
                bot.cooldown = level === 1 ? 50 : (level === 2 ? 30 : 15);
            }
        }
    }
}

// ============================================================
//  物理迴圈
// ============================================================
function tickRoom(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    room.tickCount++;

    if (room.active) updateBots(room);

    for (const id in room.players) {
        let p = room.players[id];
        if (p.hp <= 0) continue;
        if (p.cooldown > 0) p.cooldown--;
        // 無敵計時遞減
        if (p.invincible && p.invincible > 0) p.invincible--;
        if (p.isBot) continue;

        // 前進/後退
        if (p.targetMove && Math.abs(p.targetMove) > 0) {
            const speed = getAltSpeed(p.alt || ALT_MID);
            const dir = p.targetMove > 0 ? 1 : -1;
            const step = Math.min(speed, Math.abs(p.targetMove));
            const rad = p.angle * Math.PI / 180;
            const dx = Math.cos(rad) * step * dir;
            const dy = Math.sin(rad) * step * dir;
            if (!checkCol(room.walls, p.x + dx, p.y + dy, HELI_RADIUS, p.alt || ALT_MID)) {
                p.x += dx; p.y += dy;
                p.targetMove -= step * dir;
            } else {
                p.targetMove = 0;
            }
        }

        // 轉向
        if (p.targetAngle !== undefined) {
            let diff = p.targetAngle - p.angle;
            if (Math.abs(diff) > 0.5) {
                const turnSpeed = 5;
                p.angle += Math.min(turnSpeed, Math.abs(diff)) * Math.sign(diff);
            } else {
                p.angle = p.targetAngle;
                p.targetAngle = undefined;
            }
        }
    }

    if (!room.active) {
        // 遊戲未開始或已結束，不繼續廣播（避免蓋掉前端勝負畫面）
        return;
    }

    room.timeLeft -= TICK_MS / 1000;
    if (room.timeLeft < 0) room.timeLeft = 0;

    // 飛彈更新
    for (let i = room.bullets.length - 1; i >= 0; i--) {
        const b = room.bullets[i];
        const rad = b.angle * Math.PI / 180;
        b.x += Math.cos(rad) * BULLET_SPEED;
        b.y += Math.sin(rad) * BULLET_SPEED;
        b.distance += BULLET_SPEED;

        // 飛彈只被同高度或更高的障礙物阻擋
        let destroy = (b.distance >= b.maxRange || checkCol(room.walls, b.x, b.y, BULLET_RADIUS, b.alt || ALT_MID));

        if (!destroy) {
            for (const pid in room.players) {
                const p = room.players[pid];
                if (p.team === b.team || p.hp <= 0) continue;
                // 無敵中不可被擊中
                if (p.invincible && p.invincible > 0) continue;
                // 🌟 高度差超過1則無法命中
                if (!canBulletHit(b.alt || ALT_MID, p.alt || ALT_MID)) continue;

                const dx = p.x - b.x, dy = p.y - b.y;
                if (Math.sqrt(dx * dx + dy * dy) < HIT_RADIUS) {
                    if (b.team === 'red') room.scores.red++;
                    else room.scores.blue++;
                    p.hp -= 20;
                    destroy = true;
                    if (p.hp <= 0) {
                        const savedPid = pid;
                        const savedTeam = p.team;
                        setTimeout(() => {
                            const r2 = rooms[roomId];
                            if (!r2 || !r2.players[savedPid]) return;
                            const pp = r2.players[savedPid];
                            // 真人與 Bot 都用「遠離敵人」的安全重生點
                            let s = getSafeRespawnPoint(savedTeam, r2.players, r2.walls);
                            pp.x = s.x; pp.y = s.y; pp.angle = s.a;
                            pp.alt = s.alt || ALT_HIGH; // 重生時高空，飛彈打不到
                            pp.hp = 100;
                            pp.cooldown = 0;
                            pp.targetMove = 0;
                            if (pp.isBot) pp.targetAngle = s.a;
                            // 無敵時間：60 tick = 3 秒
                            pp.invincible = 60;
                        }, RESPAWN_MS);
                    }
                    break;
                }
            }
        }
        if (destroy) room.bullets.splice(i, 1);
    }

    if (room.timeLeft <= 0) {
        room.active = false;
        let winner = 'draw';
        if (room.scores.red > room.scores.blue) winner = 'red';
        else if (room.scores.blue > room.scores.red) winner = 'blue';
        io.to(roomId).emit('state', buildState(room, true, winner));
        console.log(`🏁 房間 ${roomId} 結束，勝者: ${winner}`);
        return;
    }

    io.to(roomId).emit('state', buildState(room));
}

function buildState(room, gameOver = false, winner = null) {
    return {
        players: room.players,
        bullets: room.bullets,
        scores: room.scores,
        time: room.timeLeft,
        gameOver,
        winner
    };
}

function startLoop(roomId) {
    const room = getRoom(roomId);
    if (room.loopHandle) return;
    room.loopHandle = setInterval(() => tickRoom(roomId), TICK_MS);
    console.log(`▶️  房間 ${roomId} 物理迴圈啟動`);
}

// ============================================================
//  Socket.io 事件
// ============================================================
io.on('connection', (socket) => {
    console.log('連線:', socket.id);

    socket.on('joinRoom', (roomId) => {
        socket.join(roomId);
        socket.roomId = roomId;
        const room = getRoom(roomId);
        startLoop(roomId);
        socket.emit('map', { walls: room.walls });
        socket.emit('state', buildState(room));
    });

    socket.on('setMap', (data) => {
        const room = getRoom(data.roomId);
        // 補上高度屬性
        (data.walls || []).forEach(tile => {
            if (!tile.altitude) {
                tile.altitude = (tile.emoji === '🪨') ? 4
                              : (tile.emoji === '🗼') ? 3
                              : (tile.emoji === '🏢') ? 2 : 1;
            }
        });
        room.walls = data.walls;
        // 🌟 標記地圖已由老師設定，鎖定地圖！
        room.mapLocked = true;
        io.to(data.roomId).emit('map', { walls: room.walls });
        console.log(`🗺️  房間 ${data.roomId} 地圖更新`);
    });

    socket.on('startGame', (data) => {
        const room = getRoom(data.roomId);
        room.active = true;
        room.timeLeft = data.timeLimit || 180;
        room.scores = { red: 0, blue: 0 };
        room.bullets = [];
        io.to(data.roomId).emit('state', buildState(room));
        console.log(`🔔 房間 ${data.roomId} 比賽開始`);
    });

    socket.on('resetGame', (data) => {
        const room = getRoom(data.roomId);
        room.active = false;
        room.bullets = [];
        room.scores = { red: 0, blue: 0 };
        room.timeLeft = data.timeLimit || 180;
        for (const id in room.players) {
            const p = room.players[id];
            if (!p.isBot) {
                const s = getSpawn(p.team, p.slot);
                p.x = s.x; p.y = s.y; p.angle = s.a; p.alt = ALT_MID;
            }
            p.hp = 100; p.cooldown = 0; p.targetMove = 0;
        }
        io.to(data.roomId).emit('state', buildState(room));
        io.to(data.roomId).emit('map', { walls: room.walls });
        console.log(`♻️  房間 ${data.roomId} 重置`);
    });

    socket.on('playerJoin', (data) => {
        const room = getRoom(data.roomId);
        const s = getSpawn(data.team, data.slot);
        room.players[data.id] = {
            id: data.id, name: data.name,
            team: data.team, slot: data.slot,
            x: s.x, y: s.y, angle: s.a,
            alt: ALT_MID,
            hp: 100, cooldown: 0, isBot: false
        };
        socket.playerId = data.id;
        io.to(data.roomId).emit('state', buildState(room));
        socket.emit('map', { walls: room.walls });
    });

    socket.on('cmd', (data) => {
        const roomId = socket.roomId;
        const playerId = socket.playerId;
        if (!roomId || !playerId) return;
        const room = rooms[roomId];
        if (!room || !room.active) return;
        const player = room.players[playerId];
        if (!player || player.hp <= 0) return;

        const now = Date.now();
        const lastKey = 'lastCmd_' + data.action;
        if (now - (player[lastKey] || 0) < 10) return;
        player[lastKey] = now;

        let val = Number(data.val);
        if (isNaN(val)) val = 0;
        if (data.action === 'move')     val = Math.max(-1000, Math.min(1000, val));
        if (data.action === 'turn')     val = Math.max(-360,  Math.min(360,  val));
        if (data.action === 'setAngle') val = ((val % 360) + 360) % 360; // 正規化到 0~360
        if (data.action === 'setAlt')   val = Math.max(1, Math.min(4, Math.round(val)));

        data.id  = playerId;
        data.val = val;
        applyCmd(room, data);
    });

    socket.on('disconnect', () => {
        console.log('斷線:', socket.id);
        const roomId = socket.roomId;
        const pid = socket.playerId;
        if (roomId && pid && rooms[roomId]) {
            delete rooms[roomId].players[pid];
            let hasRealPlayer = Object.values(rooms[roomId].players).some(p => !p.isBot);
            if (!hasRealPlayer) {
                clearInterval(rooms[roomId].loopHandle);
                delete rooms[roomId];
                console.log(`🗑️ 房間 ${roomId} 已無玩家，關閉`);
            } else {
                io.to(roomId).emit('state', buildState(rooms[roomId]));
            }
        }
    });

    // 練習模式
    socket.on('joinPractice', (data) => {
        const PR_ID = "practice_" + data.id;
        const room = getRoom(PR_ID);
        room.players = {};
        room.bullets = [];
        room.active = true;
        room.walls = JSON.parse(JSON.stringify(PRESET_MAPS[data.mapId] || []));
        room.timeLeft = 999;

        let aiLevel = data.botCount === 1 ? 1 : (data.botCount === 3 ? 2 : 3);
        for (let i = 1; i <= data.botCount; i++) {
            let botId = 'bot_' + Math.random().toString(36).substr(2, 6);
            const s = getSafeRandomSpawn(room.walls);
            room.players[botId] = {
                id: botId, name: '電腦_' + Math.floor(Math.random() * 1000),
                team: 'red', slot: i,
                x: s.x, y: s.y, angle: s.a, targetAngle: s.a,
                alt: ALT_MID,
                hp: 100, cooldown: 0, isBot: true, level: aiLevel, targetMove: 0
            };
        }
        startLoop(PR_ID);
        const playerSpawn = getSafeRandomSpawn(room.walls);
        room.players[data.id] = {
            id: data.id, name: data.name,
            team: 'blue', slot: Object.keys(room.players).length,
            x: playerSpawn.x, y: playerSpawn.y, angle: playerSpawn.a,
            alt: ALT_MID, hp: 100, cooldown: 0, isBot: false
        };
        socket.playerId = data.id;
        socket.roomId = PR_ID;
        socket.join(PR_ID);
        socket.emit('map', { walls: room.walls });
        io.to(PR_ID).emit('state', buildState(room));
        console.log(`👤 ${data.name} 加入練習房`);
    });

    // 學生對戰
    socket.on('joinStudentPvP', (data) => {
        const room = getRoom(data.roomId);
        if (!room.active) {
            room.active = true;
            room.players = {};
            if (!room.walls || room.walls.length === 0)
                room.walls = JSON.parse(JSON.stringify(PRESET_MAPS[data.mapId] || []));
            room.timeLeft = 300;
            room.scores = { red: 0, blue: 0 };
            room.bullets = [];
            startLoop(data.roomId);
        }
        const s = getSpawn(data.team, data.slot);
        room.players[data.id] = {
            id: data.id, name: data.name,
            team: data.team, slot: data.slot,
            x: s.x, y: s.y, angle: s.a,
            alt: ALT_MID, hp: 100, cooldown: 0, isBot: false
        };
        socket.playerId = data.id;
        socket.roomId = data.roomId;
        socket.join(data.roomId);
        socket.emit('map', { walls: room.walls });
        io.to(data.roomId).emit('state', buildState(room));
        console.log(`👤 ${data.name} 加入 PvP 房 [${data.roomId}]`);
    });

    // 合作模式
    // 合作模式 (修正版)
    socket.on('joinCoop', (data) => {
        const room = getRoom(data.roomId);
        
        // 如果房間未啟用，進行初始化
        if (!room.active) {
            room.active = true;
           // 保留已經在房間裡的真人隊友 (防清除 Bug)
            for (const pid in room.players) {
                if (room.players[pid].isBot) {
                    delete room.players[pid];
                } else {
                    room.players[pid].hp = 100;
                }
            }
            
            // 🌟 核心修正：如果老師沒設定地圖，才讀取預設的 mapId
            if (!room.walls || room.walls.length === 0) {
                room.walls = JSON.parse(JSON.stringify(PRESET_MAPS[data.mapId] || []));
            }
            room.timeLeft = 300;
            room.scores = { red: 0, blue: 0 };
            room.bullets = [];
            
            // 重新生成新的 AI 敵人
            let botCount = data.botCount || 5;
            for (let i = 1; i <= botCount; i++) {
                let botId = 'bot_' + Math.random().toString(36).substr(2, 6);
                const s = getSafeRandomSpawn(room.walls);
                room.players[botId] = {
                    id: botId, name: '電腦_' + Math.floor(Math.random() * 1000),
                    team: 'red', slot: i,
                    x: s.x, y: s.y, angle: s.a, targetAngle: s.a,
                    alt: ALT_MID,
                    hp: 100, cooldown: 0, isBot: true, level: 2, targetMove: 0
                };
            }
            startLoop(data.roomId);
        }

        // 🌟 真人玩家加入邏輯維持不變
        const s = getSafeRandomSpawn(room.walls);
        room.players[data.id] = {
            id: data.id, name: data.name,
            team: 'blue', slot: Object.keys(room.players).length,
            x: s.x, y: s.y, angle: s.a, targetAngle: s.a,
            alt: ALT_MID, hp: 100, cooldown: 0, isBot: false
        };
        
        socket.playerId = data.id;
        socket.roomId = data.roomId;
        socket.join(data.roomId);
        socket.emit('map', { walls: room.walls });
        io.to(data.roomId).emit('state', buildState(room));
        console.log(`👤 ${data.name} 加入合作房 [${data.roomId}]`);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`✅ 直升機空戰伺服器啟動，Port: ${PORT}`);
});
