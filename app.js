// ==========================================
// 1. 全域狀態與初始化
// ==========================================
let state = {
    hero: {
        level: 1, exp: 0, nextExp: 100, gold: 0,
        hp: 100, maxHp: 100,
        vitalityDifficulty: 24,
        stats: { battlesWon: 0, longestStreak: 0, hpHealed: 0, questsCompleted: 0 }
    },
    quests: [], // type: 'active', 'tomorrow', 'prophecy', 'backlog'
    bosses: [],
    shop: [
        { id: 'item1', name: 'Bubble Tea', cost: 50, desc: 'Buy a cup of bubble tea' },
        { id: 'item2', name: 'Video Games', cost: 200, desc: 'Play for 2 hours' },
        { id: 'item3', name: 'New Clothes', cost: 2000, desc: 'Buy something nice' }
    ],
    lastTick: Date.now(),
    lastResetDate: new Date().toLocaleDateString()
};

const CACHE_KEY = 'epic-quest-v2';

function loadFromStorage() {
    const saved = localStorage.getItem(CACHE_KEY);
    if (saved) state = JSON.parse(saved);
}
function saveToStorage() { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); }

// ==========================================
// 2. 核心迴圈 & HUD
// ==========================================
function gameTick() {
    const now = Date.now();
    const deltaMs = now - state.lastTick;
    const hpDecay = (state.hero.vitalityDifficulty / (24 * 60 * 60 * 1000)) * deltaMs;
    
    state.hero.hp = Math.max(0, state.hero.hp - hpDecay);
    state.lastTick = now;

    // 跨日檢查
    const today = new Date().toLocaleDateString();
    if (state.lastResetDate !== today) {
        state.quests.forEach(q => { if (q.type === 'tomorrow') q.type = 'active'; });
        state.lastResetDate = today;
        showToast("A new day dawns...");
        renderAllQuests();
    }

    updateHUD();
    updateTimer();
    saveToStorage();
}

function updateHUD() {
    document.getElementById('hero-gold').innerText = Math.floor(state.hero.gold);
    document.getElementById('hero-level').innerText = state.hero.level;
    
    const hpPct = (state.hero.hp / state.hero.maxHp) * 100;
    const hpBar = document.getElementById('hp-bar');
    hpBar.style.width = `${hpPct}%`;
    document.getElementById('hp-text').innerText = `${Math.ceil(state.hero.hp)}/${state.hero.maxHp}`;
    
    const debuffOverlay = document.getElementById('debuff-overlay');
    if (hpPct > 20) { hpBar.style.backgroundColor = 'var(--hp-color)'; debuffOverlay.classList.add('hidden'); }
    else { hpBar.style.backgroundColor = 'var(--hp-low)'; debuffOverlay.classList.remove('hidden'); }

    const expPct = (state.hero.exp / state.hero.nextExp) * 100;
    document.getElementById('exp-bar').style.width = `${expPct}%`;
    document.getElementById('exp-text').innerText = `${state.hero.exp}/${state.hero.nextExp}`;

    // Update Profile Page stats
    document.getElementById('stat-level').innerText = state.hero.level;
    document.getElementById('stat-exp').innerText = state.hero.exp;
    document.getElementById('stat-hp').innerText = `${Math.ceil(state.hero.hp)}/${state.hero.maxHp}`;
    document.getElementById('stat-quests').innerText = state.hero.stats.questsCompleted;
    document.getElementById('stat-gold').innerText = Math.floor(state.hero.gold);
    document.getElementById('stress-level-text').innerText = `-${state.hero.vitalityDifficulty}`;
    
    document.getElementById('stat-battles').innerText = state.hero.stats.battlesWon;
    document.getElementById('stat-streak').innerText = state.hero.stats.longestStreak;
    document.getElementById('stat-healed').innerText = state.hero.stats.hpHealed;
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
// 3. 任務系統 (Quests & Future)
// ==========================================
function addQuest(type) {
    let titleInput, goldInput;
    let deadline = 'none';

    if(type === 'active') { titleInput = 'quest-title'; goldInput = 'quest-gold'; }
    else if(type === 'tomorrow') { titleInput = 'tomorrow-title'; goldInput = 'tomorrow-gold'; }
    else if(type === 'prophecy') { 
        titleInput = 'prophecy-title'; goldInput = 'prophecy-gold'; 
        deadline = document.getElementById('prophecy-deadline').value;
    }
    else if(type === 'backlog') { titleInput = 'backlog-title'; }

    const title = document.getElementById(titleInput).value;
    const gold = goldInput && document.getElementById(goldInput).value ? parseInt(document.getElementById(goldInput).value) : 10;
    
    if (!title) return;

    state.quests.push({ id: Date.now(), title, gold, type, deadline });
    
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
    const filtered = state.quests.filter(q => q.type === type);
    
    document.getElementById(emptyId).classList.toggle('hidden', filtered.length > 0);

    filtered.forEach(q => {
        const div = document.createElement('div');
        div.className = 'quest-card pointer'; div.id = `quest-${q.id}`;
        let extraInfo = '';
        if(q.type === 'prophecy' && q.deadline !== 'eternal') extraInfo = `<span class="text-gray text-sm"> (${q.deadline} Days)</span>`;
        
        div.innerHTML = `
            <div>
                <div class="text-primary">${q.title} ${extraInfo}</div>
            </div>
            ${q.type !== 'backlog' ? `<div class="text-yellow">💰 ${q.gold}</div>` : ''}
        `;
        // 點擊卡片完成任務 (取代原本的按鈕與括號提示)
        div.onclick = () => completeQuest(q.id);
        list.appendChild(div);
    });
}

function completeQuest(id) {
    const idx = state.quests.findIndex(q => q.id === id);
    if (idx === -1) return;
    const q = state.quests[idx];
    
    document.getElementById(`quest-${id}`).classList.add('slashed');
    
    setTimeout(() => {
        state.hero.exp += 10;
        state.hero.gold += q.gold || 0;
        state.hero.stats.questsCompleted++;
        
        if(state.hero.exp >= state.hero.nextExp) {
            state.hero.exp -= state.hero.nextExp;
            state.hero.level++;
            state.hero.nextExp = Math.floor(state.hero.nextExp * 1.5);
            showToast("Level Up!");
        }

        state.quests.splice(idx, 1);
        saveToStorage(); renderAllQuests(); updateHUD();
    }, 400);
}

// ==========================================
// 4. Boss 系統
// ==========================================
function summonBoss() {
    const name = document.getElementById('new-boss-name').value;
    const hp = parseInt(document.getElementById('new-boss-hp').value) || 1000;
    const gold = parseInt(document.getElementById('new-boss-gold').value) || 500;
    
    if(!name) return;
    state.bosses.push({ id: Date.now(), name, maxHp: hp, currentHp: hp, gold });
    
    document.getElementById('new-boss-name').value = '';
    closeModal('boss-modal');
    saveToStorage(); renderBosses();
}

function renderBosses() {
    const list = document.getElementById('boss-list');
    list.innerHTML = '';
    document.getElementById('empty-boss').classList.toggle('hidden', state.bosses.length > 0);

    state.bosses.forEach(b => {
        const hpPct = (b.currentHp / b.maxHp) * 100;
        const div = document.createElement('div');
        div.className = 'panel mt-10';
        div.innerHTML = `
            <h2 class="text-center" style="color:var(--hp-low)">☠️ ${b.name}</h2>
            <div class="bar-container mt-10" style="border-color:var(--hp-low)"><div class="bar-fill" style="background:var(--hp-low); width:${hpPct}%"></div></div>
            <div class="text-center text-sm mt-5">HP: ${b.currentHp}/${b.maxHp}</div>
            <div class="input-row mt-10">
                <input type="number" id="dmg-${b.id}" placeholder="DMG" value="50" class="flex-grow">
                <button class="btn-primary" onclick="attackBoss(${b.id})">Attack</button>
            </div>
        `;
        list.appendChild(div);
    });
}

function attackBoss(id) {
    const boss = state.bosses.find(b => b.id === id);
    const dmg = parseInt(document.getElementById(`dmg-${id}`).value) || 50;
    boss.currentHp -= dmg;
    
    if (boss.currentHp <= 0) {
        showToast(`Defeated ${boss.name}! +${boss.gold} G`);
        state.hero.gold += boss.gold;
        state.hero.stats.battlesWon++;
        state.bosses = state.bosses.filter(b => b.id !== id);
    }
    saveToStorage(); renderBosses(); updateHUD();
}

// ==========================================
// 5. Shop & Potions
// ==========================================
function renderShop() {
    const grid = document.getElementById('shop-grid');
    grid.innerHTML = state.shop.map(i => `
        <div class="shop-card">
            <h3 class="text-yellow">${i.name}</h3>
            <p class="text-gray text-sm flex-grow">${i.desc}</p>
            <div class="text-yellow mb-5">💰 ${i.cost}</div>
            <button class="btn-primary" onclick="buyItem(${i.cost})">Purchase</button>
        </div>
    `).join('');
}

function saveShopItem() {
    const id = document.getElementById('admin-id').value;
    const name = document.getElementById('admin-name').value;
    const cost = parseInt(document.getElementById('admin-cost').value);
    const desc = document.getElementById('admin-desc').value;
    if(!id || !name) return;

    const existingIdx = state.shop.findIndex(i => i.id === id);
    if(existingIdx >= 0) state.shop[existingIdx] = {id, name, cost, desc};
    else state.shop.push({id, name, cost, desc});

    closeModal('admin-modal'); saveToStorage(); renderShop();
}

function buyItem(cost) {
    if (state.hero.gold >= cost) {
        state.hero.gold -= cost;
        showToast(`Item Purchased!`);
        saveToStorage(); updateHUD();
    } else { showToast("Not enough gold."); }
}

function usePotion() {
    if(state.hero.hp >= state.hero.maxHp) { showToast("HP is full."); return; }
    const healAmt = 20;
    state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + healAmt);
    state.hero.stats.hpHealed += healAmt;
    showToast("Potion used! +20 HP");
    saveToStorage(); updateHUD();
}

// ==========================================
// 6. UI Helpers (Nav, Modals, Accordion)
// ==========================================
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function toggleAccordion(id) {
    const content = document.getElementById(`${id}-content`);
    const icon = document.getElementById(`${id}-icon`);
    if(content.classList.contains('hidden')) {
        content.classList.remove('hidden'); icon.innerText = '▼';
    } else { content.classList.add('hidden'); icon.innerText = '▶'; }
}

function showToast(msg) {
    const toast = document.getElementById('epic-toast');
    toast.innerText = msg; toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
        
        let target = e.target;
        while(!target.classList.contains('nav-item')) target = target.parentElement;
        
        target.classList.add('active');
        document.getElementById(target.dataset.target).classList.add('active');
    });
});

document.getElementById('diff-slider').addEventListener('input', (e) => {
    state.hero.vitalityDifficulty = parseInt(e.target.value);
    document.getElementById('diff-value').innerText = state.hero.vitalityDifficulty;
    saveToStorage(); updateHUD();
});

window.onload = () => {
    loadFromStorage();
    renderAllQuests(); renderBosses(); renderShop();
    document.getElementById('diff-slider').value = state.hero.vitalityDifficulty;
    document.getElementById('diff-value').innerText = state.hero.vitalityDifficulty;
    setInterval(gameTick, 1000); 
};