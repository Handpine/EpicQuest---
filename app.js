// ==========================================
// 1. 全域狀態與初始化
// ==========================================
let state = {
    hero: {
        level: 1, exp: 0, nextExp: 100, gold: 0,
        hp: 100, maxHp: 100,
        vitalityDifficulty: 24,
        stats: { questsToday: 0, questsWeek: 0, hpHealedToday: 0 }
    },
    quests: [], // type: 'active', 'tomorrow', 'prophecy', 'backlog'
    bosses: [], // {id, name, currentHp, maxHp, subtasks: [{id, title, gold, dmg, date, active}]}
    shop: [
        { id: 'item1', name: 'Bubble Tea', cost: 50, desc: 'Buy a cup of bubble tea' }
    ],
    potions: [
        { id: 'p1', name: 'Drink Water', hp: 5 }
    ],
    lastTick: Date.now(),
    lastResetDate: new Date().toLocaleDateString(),
    lastWeekResetDate: getWeekIdentifier(),
    isAdminMode: false
};

const CACHE_KEY = 'epic-quest-v3';

function loadFromStorage() {
    const saved = localStorage.getItem(CACHE_KEY);
    if (saved) state = JSON.parse(saved);
}
function saveToStorage() { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); }
function getWeekIdentifier() {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + 4 - (d.getDay()||7));
    return Math.ceil((((d - new Date(d.getFullYear(),0,1))/8.64e7)+1)/7);
}

// ==========================================
// 2. 核心迴圈 & HUD
// ==========================================
function gameTick() {
    const now = Date.now();
    const hpDecay = (state.hero.vitalityDifficulty / (24 * 60 * 60 * 1000)) * (now - state.lastTick);
    state.hero.hp = Math.max(0, state.hero.hp - hpDecay);
    state.lastTick = now;

    // 跨日/跨週檢查
    const today = new Date().toLocaleDateString();
    if (state.lastResetDate !== today) {
        state.hero.stats.questsToday = 0;
        state.hero.stats.hpHealedToday = 0;
        // Tomorrow 轉 Active
        state.quests.forEach(q => { if (q.type === 'tomorrow') q.type = 'active'; });
        // 預言與 Boss 子任務轉移邏輯
        checkDateTransfers();
        state.lastResetDate = today;
        showToast("A new day dawns...");
        renderAllQuests();
    }
    const currentWeek = getWeekIdentifier();
    if (state.lastWeekResetDate !== currentWeek) {
        state.hero.stats.questsWeek = 0;
        state.lastWeekResetDate = currentWeek;
    }

    updateHUD(); updateTimer(); saveToStorage();
}

function checkDateTransfers() {
    const todayMs = new Date().setHours(0,0,0,0);
    // Prophecies
    state.quests.forEach(q => {
        if (q.type === 'prophecy' && q.deadline !== 'eternal' && q.deadline !== 'custom') {
            const dlMs = new Date(q.deadlineDate).getTime();
            if (todayMs >= dlMs) q.type = 'active';
        }
    });
    // Boss subtasks
    state.bosses.forEach(b => {
        b.subtasks.forEach(st => {
            if (st.date && new Date(st.date).setHours(0,0,0,0) <= todayMs) st.active = true;
        });
    });
}

function updateHUD() {
    document.getElementById('hero-gold').innerText = Math.floor(state.hero.gold);
    document.getElementById('hero-level').innerText = state.hero.level;
    
    const hpPct = (state.hero.hp / state.hero.maxHp) * 100;
    const hpBar = document.getElementById('hp-bar'); hpBar.style.width = `${hpPct}%`;
    document.getElementById('hp-text').innerText = `${Math.ceil(state.hero.hp)}/${state.hero.maxHp}`;
    
    const debuffOverlay = document.getElementById('debuff-overlay');
    if (hpPct > 20) { hpBar.style.backgroundColor = 'var(--hp-color)'; debuffOverlay.classList.add('hidden'); }
    else { hpBar.style.backgroundColor = 'var(--hp-low)'; debuffOverlay.classList.remove('hidden'); }

    const expPct = (state.hero.exp / state.hero.nextExp) * 100;
    document.getElementById('exp-bar').style.width = `${expPct}%`;
    document.getElementById('exp-text').innerText = `${state.hero.exp}/${state.hero.nextExp}`;

    // Profile Stats
    document.getElementById('stat-level').innerText = state.hero.level;
    document.getElementById('stat-exp').innerText = state.hero.exp;
    document.getElementById('stat-hp').innerText = `${Math.ceil(state.hero.hp)}/${state.hero.maxHp}`;
    document.getElementById('stat-gold').innerText = Math.floor(state.hero.gold);
    document.getElementById('stress-level-text').innerText = `-${state.hero.vitalityDifficulty}`;
    document.getElementById('stat-today').innerText = state.hero.stats.questsToday;
    document.getElementById('stat-week').innerText = state.hero.stats.questsWeek;
    document.getElementById('stat-healed').innerText = state.hero.stats.hpHealedToday;
}

function updateTimer() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const diff = tomorrow - now;
    const h = String(Math.floor((diff / (1000 * 60 * 60)) % 24)).padStart(2, '0');
    const m = String(Math.floor((diff / 1000 / 60) % 60)).padStart(2, '0');
    const s = String(Math.floor((diff / 1000) % 60)).padStart(2, '0');
    document.getElementById('countdown-timer').innerText = `${h}:${m}:${s}`;
}

// ==========================================
// 3. 任務系統 (Quests & Gestures)
// ==========================================
function checkCustomDate(val) {
    const dateInput = document.getElementById('custom-date-input');
    if(val === 'custom') dateInput.classList.remove('hidden');
    else dateInput.classList.add('hidden');
}

function addQuest(type) {
    let titleInput, goldInput;
    let deadline = 'eternal', deadlineDate = null;

    if(type === 'active') { titleInput = 'quest-title'; goldInput = 'quest-gold'; }
    else if(type === 'tomorrow') { titleInput = 'tomorrow-title'; goldInput = 'tomorrow-gold'; }
    else if(type === 'backlog') { titleInput = 'backlog-title'; }
    else if(type === 'prophecy') { 
        titleInput = 'prophecy-title'; goldInput = 'prophecy-gold'; 
        deadline = document.getElementById('prophecy-deadline').value;
        if (deadline !== 'eternal' && deadline !== 'custom') {
            const d = new Date(); d.setDate(d.getDate() + parseInt(deadline));
            deadlineDate = d.toISOString().split('T')[0];
        } else if (deadline === 'custom') {
            deadlineDate = document.getElementById('custom-date-input').value;
            if(!deadlineDate) { showToast("Please select a date!"); return; }
        }
    }

    const title = document.getElementById(titleInput).value;
    const gold = goldInput && document.getElementById(goldInput).value ? parseInt(document.getElementById(goldInput).value) : 10;
    if (!title) return;

    state.quests.push({ id: Date.now(), title, gold, type, deadline, deadlineDate });
    
    document.getElementById(titleInput).value = '';
    if(goldInput) document.getElementById(goldInput).value = '';
    saveToStorage(); renderAllQuests();
}

function renderAllQuests() {
    renderQuestList('active', 'active-quest-list', 'empty-active');
    renderQuestList('tomorrow', 'tomorrow-list', 'empty-tomorrow');
    renderQuestList('prophecy', 'prophecy-list', 'empty-prophecy');
    renderQuestList('backlog', 'backlog-list', 'empty-backlog');
}

function renderQuestList(type, containerId, emptyId) {
    const list = document.getElementById(containerId);
    list.innerHTML = '';
    
    let itemsToRender = state.quests.filter(q => q.type === type).map(q => ({...q, isBoss: false}));
    
    // 將 Active Boss Subtasks 混入 Active Quests
    if (type === 'active') {
        state.bosses.forEach(b => {
            b.subtasks.filter(st => st.active).forEach(st => {
                itemsToRender.push({ ...st, isBoss: true, bossId: b.id, bossName: b.name });
            });
        });
    }

    document.getElementById(emptyId).classList.toggle('hidden', itemsToRender.length > 0);

    itemsToRender.forEach(q => {
        const div = document.createElement('div');
        div.className = 'quest-card'; div.id = q.isBoss ? `boss-st-${q.id}` : `quest-${q.id}`;
        
        let headerHtml = q.isBoss ? `<div class="boss-tag">🐉 ${q.bossName}</div><br>` : '';
        let extraInfo = '';
        if(q.type === 'prophecy' && q.deadlineDate) {
            const daysLeft = Math.ceil((new Date(q.deadlineDate) - new Date()) / 8.64e7);
            if(daysLeft <= 3) div.classList.add('prophecy-danger');
            else div.classList.add('prophecy-safe');
            extraInfo = `<br><span class="text-gray text-sm">⏳ ${daysLeft} days left</span>`;
        }

        div.innerHTML = `
            <div class="quest-content-row">
                <div>${headerHtml}${q.title} ${extraInfo}</div>
                ${q.type !== 'backlog' ? `<div>💰 ${q.gold}</div>` : ''}
            </div>
            <div class="quest-actions action-area">
                ${!q.isBoss ? `<span class="action-icon" onclick="openEditModal(${q.id}, 'quest')">🖋️</span>` : ''}
                ${!q.isBoss ? `<span class="action-icon" onclick="deleteQuest(${q.id})">❌</span>` : ''}
                ${(type !== 'active' && !q.isBoss) ? `<span class="action-icon" onclick="transferToActive(${q.id}, 'quest')">⚡</span>` : ''}
                ${q.isBoss && type !== 'active' ? `<span class="action-icon" onclick="transferToActive(${q.id}, 'boss-sub', ${q.bossId})">⚡</span>` : ''}
            </div>
        `;
        list.appendChild(div);
        
        // 綁定極致打擊感手勢
        bindGestures(div, () => executeSlash(div, q));
    });
}

// ==========================================
// 極致打擊感 (Swipe & Long Press)
// ==========================================
function bindGestures(element, onComplete) {
    let startX = 0, timer, isCompleted = false;
    
    const start = (e) => {
        if(e.target.closest('.action-area')) return; // 點擊按鈕區不觸發
        isCompleted = false;
        startX = e.touches ? e.touches[0].clientX : e.clientX;
        timer = setTimeout(() => { if(!isCompleted) { isCompleted=true; onComplete(e); } }, 600); // 600ms 長按
    };
    
    const move = (e) => {
        if(isCompleted || startX === 0) return;
        const currentX = e.touches ? e.touches[0].clientX : e.clientX;
        if(currentX - startX > 100) { isCompleted=true; clearTimeout(timer); onComplete(e); } // 右滑
    };
    
    const end = () => { clearTimeout(timer); startX = 0; };

    element.addEventListener('touchstart', start, {passive: true});
    element.addEventListener('touchmove', move, {passive: true});
    element.addEventListener('touchend', end);
    element.addEventListener('mousedown', start);
    element.addEventListener('mousemove', move);
    element.addEventListener('mouseup', end);
    element.addEventListener('mouseleave', end);
}

function executeSlash(cardEl, q) {
    // 1. 產生白光斬擊特效
    const slash = document.createElement('div');
    slash.className = 'slash-line';
    cardEl.appendChild(slash);

    // 2. 羊皮紙燃燒動畫
    cardEl.classList.add('burning');

    // 3. 綠色浮動 EXP
    const expGain = 10;
    const rect = cardEl.getBoundingClientRect();
    showFloatingText(rect.left + rect.width/2, rect.top, `+${expGain} EXP`, '#4caf50');

    // 4. 等待動畫完畢後清理與結算
    setTimeout(() => {
        if (q.isBoss) {
            const boss = state.bosses.find(b => b.id === q.bossId);
            boss.currentHp -= q.dmg;
            boss.subtasks = boss.subtasks.filter(st => st.id !== q.id);
            if(boss.currentHp <= 0) { showToast(`Defeated ${boss.name}! +${boss.gold}G`); state.hero.gold += boss.gold; state.bosses = state.bosses.filter(b=>b.id!==boss.id); }
        } else {
            state.quests = state.quests.filter(item => item.id !== q.id);
            state.hero.gold += q.gold || 0;
        }

        state.hero.exp += expGain;
        state.hero.stats.questsToday++; state.hero.stats.questsWeek++;
        if(state.hero.exp >= state.hero.nextExp) { state.hero.exp -= state.hero.nextExp; state.hero.level++; state.hero.nextExp = Math.floor(state.hero.nextExp * 1.5); showToast("Level Up!"); }
        
        saveToStorage(); renderAllQuests(); renderBosses(); updateHUD();
    }, 800);
}

// ==========================================
// 任務管理操作
// ==========================================
function openEditModal(id, type) {
    const q = state.quests.find(item => item.id === id);
    if(!q) return;
    document.getElementById('edit-quest-id').value = id;
    document.getElementById('edit-quest-type').value = type;
    document.getElementById('edit-quest-title').value = q.title;
    document.getElementById('edit-quest-gold').value = q.gold;
    openModal('edit-quest-modal');
}
function saveEditedQuest() {
    const id = parseInt(document.getElementById('edit-quest-id').value);
    const q = state.quests.find(item => item.id === id);
    q.title = document.getElementById('edit-quest-title').value;
    q.gold = parseInt(document.getElementById('edit-quest-gold').value);
    closeModal('edit-quest-modal'); saveToStorage(); renderAllQuests();
}
function deleteQuest(id) { state.quests = state.quests.filter(q => q.id !== id); saveToStorage(); renderAllQuests(); }
function transferToActive(id, type, bossId) {
    if(type === 'quest') { const q = state.quests.find(item => item.id === id); q.type = 'active'; }
    else if(type === 'boss-sub') { const boss = state.bosses.find(b=>b.id===bossId); const st = boss.subtasks.find(s=>s.id===id); st.active = true; }
    saveToStorage(); renderAllQuests(); renderBosses();
}

// ==========================================
// 4. Boss 系統
// ==========================================
function summonBoss() {
    const name = document.getElementById('new-boss-name').value;
    const hp = parseInt(document.getElementById('new-boss-hp').value) || 1000;
    const gold = parseInt(document.getElementById('new-boss-gold').value) || 500;
    if(!name) return;
    state.bosses.push({ id: Date.now(), name, maxHp: hp, currentHp: hp, gold, subtasks: [] });
    document.getElementById('new-boss-name').value = ''; closeModal('boss-modal');
    saveToStorage(); renderBosses();
}

function renderBosses() {
    const list = document.getElementById('boss-list'); list.innerHTML = '';
    document.getElementById('empty-boss').classList.toggle('hidden', state.bosses.length > 0);

    state.bosses.forEach(b => {
        const hpPct = (b.currentHp / b.maxHp) * 100;
        const div = document.createElement('div'); div.className = 'panel mt-10';
        
        let subtasksHtml = b.subtasks.filter(st => !st.active).map(st => `
            <div class="quest-card mt-5">
                <div class="quest-content-row">
                    <div>${st.title} <span class="text-gray text-sm">[DMG: ${st.dmg}]</span></div>
                    <div class="action-area">
                        <span class="action-icon" onclick="transferToActive(${st.id}, 'boss-sub', ${b.id})">⚡</span>
                    </div>
                </div>
            </div>
        `).join('');

        div.innerHTML = `
            <h2 class="text-center" style="color:var(--hp-low)">☠️ ${b.name}</h2>
            <div class="bar-container mt-10" style="border-color:var(--hp-low)"><div class="bar-fill" style="background:var(--hp-low); width:${hpPct}%"></div></div>
            <div class="text-center text-sm mt-5">HP: ${b.currentHp}/${b.maxHp}</div>
            
            <div class="mt-15">${subtasksHtml}</div>
            
            <div class="input-row mt-10">
                <input type="text" id="bst-title-${b.id}" placeholder="Attack Task" class="flex-grow">
                <input type="number" id="bst-dmg-${b.id}" placeholder="DMG" value="50" class="w-20">
                <button class="btn-icon" onclick="addBossSubtask(${b.id})">+</button>
            </div>
        `;
        list.appendChild(div);
    });
}

function addBossSubtask(bossId) {
    const title = document.getElementById(`bst-title-${bossId}`).value;
    const dmg = parseInt(document.getElementById(`bst-dmg-${bossId}`).value) || 50;
    if(!title) return;
    const boss = state.bosses.find(b => b.id === bossId);
    boss.subtasks.push({ id: Date.now(), title, dmg, active: false, gold: 0 }); // 戰鬥任務不給碎金幣，打死才給
    saveToStorage(); renderBosses();
}

// ==========================================
// 5. Potions & Shop
// ==========================================
function renderPotions() {
    const list = document.getElementById('potion-list');
    list.innerHTML = state.potions.map(p => `
        <div class="potion-item" onclick="consumePotion(${p.hp})">${p.name} (+${p.hp})</div>
    `).join('');
}

function addPotion() {
    const name = document.getElementById('new-potion-name').value;
    const hp = parseInt(document.getElementById('new-potion-hp').value);
    if(!name || !hp) return;
    state.potions.push({ id: `p${Date.now()}`, name, hp });
    closeModal('potion-modal'); saveToStorage(); renderPotions();
}

function consumePotion(amount) {
    if(state.hero.hp >= state.hero.maxHp) { showToast("HP is full."); return; }
    state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + amount);
    state.hero.stats.hpHealedToday += amount;
    showToast(`Potion Used! +${amount} HP`);
    saveToStorage(); updateHUD();
}

function toggleAdminMode() { state.isAdminMode = !state.isAdminMode; renderShop(); }

function renderShop() {
    const grid = document.getElementById('shop-grid');
    grid.innerHTML = state.shop.map(i => `
        <div class="shop-card">
            <h3 class="text-yellow">${i.name}</h3>
            <p class="text-gray text-sm flex-grow">${i.desc}</p>
            <div class="text-yellow mb-5">💰 ${i.cost}</div>
            ${state.isAdminMode ? `
                <div class="flex-row">
                    <button class="btn-primary flex-grow" onclick="openShopEdit('${i.id}')">Edit</button>
                    <button class="btn-dashed flex-grow" onclick="deleteShopItem('${i.id}')">Del</button>
                </div>
            ` : `<button class="btn-primary" onclick="buyItem(${i.cost})">Purchase</button>`}
        </div>
    `).join('');
    
    if(state.isAdminMode) {
        grid.innerHTML += `<div class="shop-card pointer flex-center" style="justify-content:center; align-items:center;" onclick="openShopEdit('')"><h1 class="text-yellow">+</h1></div>`;
    }
}

function openShopEdit(id) {
    if(id) {
        const item = state.shop.find(i => i.id === id);
        document.getElementById('admin-id').value = item.id;
        document.getElementById('admin-name').value = item.name;
        document.getElementById('admin-cost').value = item.cost;
        document.getElementById('admin-desc').value = item.desc;
    } else { document.querySelectorAll('#admin-modal input').forEach(i=>i.value=''); document.getElementById('admin-id').value = `item${Date.now()}`; }
    openModal('admin-modal');
}
function saveShopItem() {
    const id = document.getElementById('admin-id').value;
    const name = document.getElementById('admin-name').value;
    const cost = parseInt(document.getElementById('admin-cost').value);
    const desc = document.getElementById('admin-desc').value;
    if(!id || !name) return;
    const existingIdx = state.shop.findIndex(i => i.id === id);
    if(existingIdx >= 0) state.shop[existingIdx] = {id, name, cost, desc}; else state.shop.push({id, name, cost, desc});
    closeModal('admin-modal'); saveToStorage(); renderShop();
}
function deleteShopItem(id) { state.shop = state.shop.filter(i => i.id !== id); saveToStorage(); renderShop(); }
function buyItem(cost) { if (state.hero.gold >= cost) { state.hero.gold -= cost; showToast(`Item Purchased!`); saveToStorage(); updateHUD(); } else { showToast("Not enough gold."); } }

// ==========================================
// 6. UI Helpers
// ==========================================
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function toggleAccordion(id) {
    const content = document.getElementById(`${id}-content`); const icon = document.getElementById(`${id}-icon`);
    if(content.classList.contains('hidden')) { content.classList.remove('hidden'); icon.innerText = '▼'; }
    else { content.classList.add('hidden'); icon.innerText = '▶'; }
}
function showToast(msg) { const toast = document.getElementById('epic-toast'); toast.innerText = msg; toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 3000); }
function showFloatingText(x, y, text, color) {
    const el = document.createElement('div'); el.className = 'floating-text';
    el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.color = color; el.innerText = text;
    document.body.appendChild(el); setTimeout(() => el.remove(), 1000);
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
        let target = e.target; while(!target.classList.contains('nav-item')) target = target.parentElement;
        target.classList.add('active'); document.getElementById(target.dataset.target).classList.add('active');
    });
});
document.getElementById('diff-slider').addEventListener('input', (e) => { state.hero.vitalityDifficulty = parseInt(e.target.value); document.getElementById('diff-value').innerText = state.hero.vitalityDifficulty; saveToStorage(); updateHUD(); });

window.onload = () => {
    loadFromStorage(); renderAllQuests(); renderBosses(); renderShop(); renderPotions();
    document.getElementById('diff-slider').value = state.hero.vitalityDifficulty;
    document.getElementById('diff-value').innerText = state.hero.vitalityDifficulty;
    setInterval(gameTick, 1000); 
};