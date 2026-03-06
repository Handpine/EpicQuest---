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
    bosses: [], // {id, name, currentHp, maxHp, subtasks: [{id, title, gold, dmg, active}]}
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

// 升級 Cache 版本，確保結構更新
const CACHE_KEY = 'epic-quest-v12';

// 月曆專用全域變數
let currentCalDate = new Date();
let pendingCustomDateStr = null; 

function loadFromStorage() {
    const saved = localStorage.getItem(CACHE_KEY);
    if (saved) state = JSON.parse(saved);
}

function getWeekIdentifier() {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + 4 - (d.getDay()||7));
    return Math.ceil((((d - new Date(d.getFullYear(),0,1))/8.64e7)+1)/7);
}


// ==========================================
// 🌟 雲端同步與 Life Progress 聯動核心 🌟
// ==========================================

// 取得今天的 date_key (對齊 Life Progress 格式 YYYY-MM-DD)
function getTodayDateKey() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ✨ 魔法：將動作寫入 Life Progress 的 Plan 欄位
async function appendToLifeProgressPlan(itemName) {
    const todayKey = getTodayDateKey();
    console.log(`🔮 嘗試將 [${itemName}] 寫入 Life Progress (${todayKey})...`);

    try {
        const { data: { session } } = await supabase.auth.getSession();
        // 如果需要登入才能寫入，確保有 session (視你的 Life Progress 權限設定而定)
        // 如果報權限錯誤，通常是因為這邊抓不到 Auth

        const { data: entry, error: fetchError } = await supabase
            .from('entries')
            .select('id, plan')
            .eq('date_key', todayKey)
            .maybeSingle(); 

        if (fetchError) throw fetchError;

        let newPlan = `- ${itemName}`;
        
        if (entry) {
            // 原本有內容的話，確保乾淨地換行再加入新列點
            const currentPlan = entry.plan || "";
            newPlan = currentPlan.trim() ? `${currentPlan}\n- ${itemName}` : `- ${itemName}`;
            
            await supabase
                .from('entries')
                .update({ plan: newPlan, updated_at: Date.now() })
                .eq('id', entry.id);
        } else {
            // 今天還沒寫日記，建立一筆新的 (預設 type 為 daily)
            await supabase
                .from('entries')
                .insert([{
                    date_key: todayKey,
                    type: 'daily',
                    plan: newPlan,
                    updated_at: Date.now()
                }]);
        }
        console.log("✅ Life Progress 寫入成功！");
    } catch (err) {
        console.warn("❌ 聯動 Life Progress 失敗 (請確認是否已登入 Supabase 或網路異常):", err);
    }
}

// 極簡儲存原則：將狀態儲存至雲端，覆蓋舊檔
async function saveToCloud() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return; // 沒登入則跳過，僅依靠本地 LocalStorage

        await supabase
            .from('epic_quest_save')
            .upsert({ 
                user_id: session.user.id, 
                state_data: state, 
                updated_at: new Date() 
            });
    } catch (err) {
        console.warn("☁️ 雲端存檔失敗:", err);
    }
}

// 啟動時從雲端讀取最新狀態
async function loadFromCloud() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return false;

        const { data, error } = await supabase
            .from('epic_quest_save')
            .select('state_data')
            .eq('user_id', session.user.id)
            .maybeSingle();

        if (data && data.state_data) {
            state = data.state_data;
            return true; // 成功從雲端載入
        }
    } catch (err) {
        console.log("從雲端載入失敗，準備使用本地進度...");
    }
    return false;
}

// 攔截儲存動作：本機存一份，雲端也非同步推一份
function saveToStorage() {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    saveToCloud(); // 背景靜默上傳，不卡頓 UI
}


// ==========================================
// 2. 核心迴圈 & HUD
// ==========================================
function gameTick() {
    const now = Date.now();
    const hpDecay = (state.hero.vitalityDifficulty / (24 * 60 * 60 * 1000)) * (now - state.lastTick);
    state.hero.hp = Math.max(0, state.hero.hp - hpDecay);
    state.lastTick = now;

    const today = new Date().toLocaleDateString();
    if (state.lastResetDate !== today) {
        state.hero.stats.questsToday = 0;
        state.hero.stats.hpHealedToday = 0;
        state.quests.forEach(q => { if (q.type === 'tomorrow') q.type = 'active'; });
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
    state.quests.forEach(q => {
        if (q.type === 'prophecy' && q.deadline !== 'eternal' && q.deadlineDate) {
            const dlMs = new Date(q.deadlineDate).getTime();
            if (todayMs >= dlMs) q.type = 'active';
        }
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
// 3. 任務、史詩下拉選單與月曆系統 
// ==========================================
function toggleActiveQuestEdit() {
    const list = document.getElementById('active-quest-list');
    const btn = document.getElementById('toggle-edit-btn');
    list.classList.toggle('edit-mode-on'); btn.classList.toggle('active');
}
function toggleFutureEdit() {
    const lists = document.querySelectorAll('.future-list-group');
    const btn = document.getElementById('toggle-future-edit-btn');
    lists.forEach(list => list.classList.toggle('edit-mode-on'));
    if(btn) btn.classList.toggle('active');
}

function toggleCustomSelect() { document.getElementById('prophecy-options-menu').classList.toggle('hidden'); }

function selectProphecyOption(value, text) {
    const hiddenInput = document.getElementById('prophecy-deadline');
    const display = document.getElementById('prophecy-deadline-display');
    const menu = document.getElementById('prophecy-options-menu');

    if (value !== 'custom') {
        hiddenInput.value = value; display.innerText = text; menu.classList.add('hidden'); pendingCustomDateStr = null; 
    } else {
        hiddenInput.value = 'custom'; menu.classList.add('hidden'); checkCustomDate('custom'); 
    }
}

document.addEventListener('click', function(event) {
    const container = document.querySelector('.custom-select-container');
    const menu = document.getElementById('prophecy-options-menu');
    if (container && !container.contains(event.target) && menu && !menu.classList.contains('hidden')) {
        menu.classList.add('hidden');
    }
});

function checkCustomDate(val) {
    if(val === 'custom') { currentCalDate = new Date(); renderCalendar(); openModal('calendar-modal'); } 
    else { pendingCustomDateStr = null; }
}

function renderCalendar() {
    const year = currentCalDate.getFullYear(); const month = currentCalDate.getMonth();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    document.getElementById('cal-month-year').innerText = `${monthNames[month]} ${year}`;
    
    const firstDay = new Date(year, month, 1).getDay(); const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date(); let html = '';
    
    for(let i=0; i<firstDay; i++) html += `<div class="cal-day empty"></div>`;
    for(let d=1; d<=daysInMonth; d++) {
        const iterDateStr = `${year}-${String(month+1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        let classes = 'cal-day';
        if (year === today.getFullYear() && month === today.getMonth() && d === today.getDate()) classes += ' today';
        if (pendingCustomDateStr === iterDateStr) classes += ' selected';
        html += `<div class="${classes}" onclick="selectCalDate(${year}, ${month}, ${d})">${d}</div>`;
    }
    document.getElementById('cal-days-container').innerHTML = html;
}

function changeMonth(offset) { currentCalDate.setMonth(currentCalDate.getMonth() + offset); renderCalendar(); }

function selectCalDate(year, month, day) {
    pendingCustomDateStr = `${year}-${String(month+1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    renderCalendar(); 
    const display = document.getElementById('prophecy-deadline-display');
    if (display) display.innerText = `✨ Sealed: ${pendingCustomDateStr}`;
    setTimeout(() => { closeModal('calendar-modal', true); showToast(`Date Sealed!`); }, 350);
}

function addQuest(type) {
    let titleInput, goldInput; let deadline = 'eternal', deadlineDate = null;
    if(type === 'active') { titleInput = 'quest-title'; goldInput = 'quest-gold'; }
    else if(type === 'tomorrow') { titleInput = 'tomorrow-title'; goldInput = 'tomorrow-gold'; }
    else if(type === 'backlog') { titleInput = 'backlog-title'; }
    else if(type === 'prophecy') { 
        titleInput = 'prophecy-title'; goldInput = 'prophecy-gold'; 
        deadline = document.getElementById('prophecy-deadline').value;
        const d = new Date();
        if (deadline === '7') { d.setDate(d.getDate() + 7); deadlineDate = d.toISOString().split('T')[0]; }
        else if (deadline === '14') { d.setDate(d.getDate() + 14); deadlineDate = d.toISOString().split('T')[0]; }
        else if (deadline === '30') { d.setDate(d.getDate() + 30); deadlineDate = d.toISOString().split('T')[0]; }
        else if (deadline === 'custom') {
            if(!pendingCustomDateStr) { 
                showToast("⚠️ Please select a date from the calendar!"); 
                document.getElementById('prophecy-deadline').value = 'eternal';
                document.getElementById('prophecy-deadline-display').innerText = '∞ Eternal';
                return; 
            }
            deadlineDate = pendingCustomDateStr;
        }
    }

    const title = document.getElementById(titleInput).value;
    const gold = goldInput && document.getElementById(goldInput).value ? parseInt(document.getElementById(goldInput).value) : 10;
    if (!title) return;

    state.quests.push({ id: Date.now(), title, gold, type, deadline, deadlineDate });
    document.getElementById(titleInput).value = ''; if(goldInput) document.getElementById(goldInput).value = '';
    
    if(type === 'prophecy') {
        document.getElementById('prophecy-deadline').value = 'eternal';
        document.getElementById('prophecy-deadline-display').innerText = '∞ Eternal';
        pendingCustomDateStr = null;
    }
    saveToStorage(); renderAllQuests();
}

function renderAllQuests() {
    renderQuestList('active', 'active-quest-list', 'empty-active');
    renderQuestList('tomorrow', 'tomorrow-list', 'empty-tomorrow');
    renderQuestList('prophecy', 'prophecy-list', 'empty-prophecy');
    renderQuestList('backlog', 'backlog-list', 'empty-backlog');
}

function renderQuestList(type, containerId, emptyId) {
    const list = document.getElementById(containerId); list.innerHTML = '';
    let itemsToRender = state.quests.filter(q => q.type === type).map(q => ({...q, isBoss: false}));
    
    if (type === 'active') {
        state.bosses.forEach(b => {
            b.subtasks.filter(st => st.active).forEach(st => { itemsToRender.push({ ...st, isBoss: true, bossId: b.id, bossName: b.name }); });
        });
    }

    document.getElementById(emptyId).classList.toggle('hidden', itemsToRender.length > 0);

    itemsToRender.forEach(q => {
        const div = document.createElement('div'); div.className = `quest-card ${q.isBoss ? 'boss-quest' : ''}`; div.id = q.isBoss ? `boss-st-${q.id}` : `quest-${q.id}`;
        let headerHtml = q.isBoss ? `<div class="boss-tag">🐉 ${q.bossName}</div><br>` : ''; let extraInfo = '';
        
        if(q.type === 'prophecy' && q.deadlineDate) {
            const daysLeft = Math.ceil((new Date(q.deadlineDate) - new Date()) / 8.64e7);
            if(daysLeft <= 3) div.classList.add('prophecy-danger'); else div.classList.add('prophecy-safe');
            extraInfo = `<br><span class="text-gray text-sm">⏳ ${daysLeft} days left</span>`;
        }

        div.innerHTML = `
            <div class="quest-content-row">
                <div>${headerHtml}${q.title} ${extraInfo}</div>
                ${q.type !== 'backlog' ? `<div>💰 ${q.gold}</div>` : ''}
            </div>
            <div class="quest-actions action-area">
                ${!q.isBoss ? `<span class="action-icon edit-action" onclick="openEditModal(${q.id}, 'quest')">📜</span>` : ''}
                ${!q.isBoss ? `<span class="action-icon delete-action" onclick="deleteQuest(${q.id})">🪓</span>` : ''}
                ${(type !== 'active' && !q.isBoss) ? `<span class="action-icon transfer-action" onclick="transferToActive(${q.id}, 'quest')">📯</span>` : ''}
                ${q.isBoss && type !== 'active' ? `<span class="action-icon transfer-action" onclick="transferToActive(${q.id}, 'boss-sub', ${q.bossId})">📯</span>` : ''}
            </div>
        `;
        list.appendChild(div); bindGestures(div, () => executeSlash(div, q));
    });
}

// ---------------- 極致打擊感 ----------------
function bindGestures(element, onComplete) {
    let startX = 0, timer, isCompleted = false;
    const start = (e) => {
        if(e.target.closest('.action-area')) return; 
        isCompleted = false; startX = e.touches ? e.touches[0].clientX : e.clientX;
        timer = setTimeout(() => { if(!isCompleted) { isCompleted=true; onComplete(e); } }, 600); 
    };
    const move = (e) => {
        if(isCompleted || startX === 0) return; const currentX = e.touches ? e.touches[0].clientX : e.clientX;
        if(currentX - startX > 100) { isCompleted=true; clearTimeout(timer); onComplete(e); } 
    };
    const end = () => { clearTimeout(timer); startX = 0; };

    element.addEventListener('touchstart', start, {passive: true}); element.addEventListener('touchmove', move, {passive: true});
    element.addEventListener('touchend', end); element.addEventListener('mousedown', start);
    element.addEventListener('mousemove', move); element.addEventListener('mouseup', end); element.addEventListener('mouseleave', end);
}

function executeSlash(cardEl, q) {
    const slash = document.createElement('div'); slash.className = 'slash-line';
    cardEl.appendChild(slash); cardEl.classList.add('burning');

    const expGain = 10; const goldGain = q.gold || 0; const rect = cardEl.getBoundingClientRect();
    
    showFloatingText(rect.left + rect.width/2, rect.top, `+${expGain} EXP`, '#4caf50', 'float-up-left');
    if (goldGain > 0) showFloatingText(rect.left + rect.width/2, rect.top, `+${goldGain} G`, 'var(--gold)', 'float-up-right');

    setTimeout(() => {
        // ✨ [聯動觸發點] 斬殺任務成功，將任務名稱靜默傳送至 Life Progress 的本日 Plan
        appendToLifeProgressPlan(q.title);

        if (q.isBoss) {
            const boss = state.bosses.find(b => b.id === q.bossId); boss.currentHp -= q.dmg; boss.subtasks = boss.subtasks.filter(st => st.id !== q.id);
            state.hero.gold += goldGain; 
            if(boss.currentHp <= 0) { showToast(`Defeated ${boss.name}! +${boss.gold}G`); state.hero.gold += boss.gold; state.bosses = state.bosses.filter(b=>b.id!==boss.id); }
        } else {
            state.quests = state.quests.filter(item => item.id !== q.id); state.hero.gold += goldGain;
        }

        state.hero.exp += expGain; state.hero.stats.questsToday++; state.hero.stats.questsWeek++;
        if(state.hero.exp >= state.hero.nextExp) { state.hero.exp -= state.hero.nextExp; state.hero.level++; state.hero.nextExp = Math.floor(state.hero.nextExp * 1.5); showToast("Level Up!"); }
        
        saveToStorage(); renderAllQuests(); renderBosses(); updateHUD();
    }, 800);
}

// 任務管理操作
function openEditModal(id, type) {
    const q = state.quests.find(item => item.id === id); if(!q) return;
    document.getElementById('edit-quest-id').value = id; document.getElementById('edit-quest-type').value = type;
    document.getElementById('edit-quest-title').value = q.title; document.getElementById('edit-quest-gold').value = q.gold;
    openModal('edit-quest-modal');
}
function saveEditedQuest() {
    const id = parseInt(document.getElementById('edit-quest-id').value); const q = state.quests.find(item => item.id === id);
    q.title = document.getElementById('edit-quest-title').value; q.gold = parseInt(document.getElementById('edit-quest-gold').value);
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
    const hp = parseInt(document.getElementById('new-boss-hp').value) || 1000; const gold = parseInt(document.getElementById('new-boss-gold').value) || 500;
    if(!name) return;
    state.bosses.push({ id: Date.now(), name, maxHp: hp, currentHp: hp, gold, subtasks: [] });
    document.getElementById('new-boss-name').value = ''; closeModal('boss-modal'); saveToStorage(); renderBosses();
}

function renderBosses() {
    const list = document.getElementById('boss-list'); list.innerHTML = '';
    document.getElementById('empty-boss').classList.toggle('hidden', state.bosses.length > 0);
    state.bosses.forEach(b => {
        const hpPct = (b.currentHp / b.maxHp) * 100; const div = document.createElement('div'); div.className = 'panel mt-10';
        let subtasksHtml = b.subtasks.filter(st => !st.active).map(st => `
            <div class="quest-card mt-5"><div class="quest-content-row">
                <div>${st.title} <span class="text-gray text-sm">[DMG: ${st.dmg}] [💰: ${st.gold}]</span></div>
                <div class="action-area"><span class="action-icon transfer-action" onclick="transferToActive(${st.id}, 'boss-sub', ${b.id})">📯</span></div>
            </div></div>`).join('');

        div.innerHTML = `
            <h2 class="text-center" style="color:var(--hp-low)">☠️ ${b.name}</h2>
            <div class="bar-container mt-10" style="border-color:var(--hp-low)"><div class="bar-fill" style="background:var(--hp-low); width:${hpPct}%"></div></div>
            <div class="text-center text-sm mt-5">HP: ${b.currentHp}/${b.maxHp}</div>
            <div class="mt-15">${subtasksHtml}</div>
            <div class="input-row flex-wrap mt-10">
                <input type="text" id="bst-title-${b.id}" placeholder="Attack Task" class="flex-grow epic-input">
                <input type="number" id="bst-dmg-${b.id}" placeholder="DMG" value="50" class="w-20 epic-input">
                <input type="number" id="bst-gold-${b.id}" placeholder="Gold" value="10" class="w-20 epic-input">
                <button class="btn-icon" onclick="addBossSubtask(${b.id})">⚔️</button>
            </div>
        `;
        list.appendChild(div);
    });
}
function addBossSubtask(bossId) {
    const title = document.getElementById(`bst-title-${bossId}`).value; const dmg = parseInt(document.getElementById(`bst-dmg-${bossId}`).value) || 50; const gold = parseInt(document.getElementById(`bst-gold-${bossId}`).value) || 10;
    if(!title) return; const boss = state.bosses.find(b => b.id === bossId);
    boss.subtasks.push({ id: Date.now(), title, dmg, gold, active: false }); saveToStorage(); renderBosses();
}

// ==========================================
// 5. Potions & Shop
// ==========================================
function renderPotions() {
    const list = document.getElementById('potion-list');
    // ✨ 傳入 p.name 作為參數，供日記連動使用
    list.innerHTML = state.potions.map(p => {
        const safeName = p.name.replace(/'/g, "\\'");
        return `<div class="potion-item" onclick="consumePotion(${p.hp}, '${safeName}')">${p.name} (+${p.hp})</div>`;
    }).join('');

    const deleteList = document.getElementById('delete-potion-list');
    if (deleteList) {
        deleteList.innerHTML = state.potions.map(p => `
            <div class="delete-potion-item" onclick="deletePotion('${p.id}')">${p.name} (+${p.hp})</div>
        `).join('');
    }
}

function addPotion() {
    const name = document.getElementById('new-potion-name').value; const hp = parseInt(document.getElementById('new-potion-hp').value);
    if(!name || !hp) return;
    state.potions.push({ id: `p${Date.now()}`, name, hp });
    document.getElementById('new-potion-name').value = ''; document.getElementById('new-potion-hp').value = '';
    saveToStorage(); renderPotions(); showToast("Potion Brewed!");
}

function deletePotion(id) { state.potions = state.potions.filter(p => p.id !== id); saveToStorage(); renderPotions(); }

// ✨ 喝藥水時，紀錄藥水名稱並連動 Life Progress
function consumePotion(amount, name) {
    if(state.hero.hp >= state.hero.maxHp) { showToast("HP is full."); return; }
    state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + amount);
    state.hero.stats.hpHealedToday += amount;
    showToast(`Potion Used! +${amount} HP`);
    
    // ✨ [聯動觸發點] 將喝掉的藥水名稱默默寫入日記
    appendToLifeProgressPlan(name);

    saveToStorage(); updateHUD();
}

function toggleAdminMode() { 
    state.isAdminMode = !state.isAdminMode; const form = document.getElementById('shop-admin-top-form'); const btn = document.getElementById('shop-admin-btn');
    if(state.isAdminMode) { form.classList.remove('hidden'); btn.classList.add('text-yellow'); } else { form.classList.add('hidden'); btn.classList.remove('text-yellow'); }
    renderShop(); 
}
function addNewShopItem() {
    const name = document.getElementById('add-item-name').value; const cost = parseInt(document.getElementById('add-item-cost').value); const desc = document.getElementById('add-item-desc').value;
    if(!name || isNaN(cost)) { showToast("Name and Gold are required!"); return; }
    state.shop.push({ id: `item${Date.now()}`, name, cost, desc });
    document.getElementById('add-item-name').value = ''; document.getElementById('add-item-cost').value = ''; document.getElementById('add-item-desc').value = '';
    saveToStorage(); renderShop(); showToast("New item forged!");
}
function renderShop() {
    const grid = document.getElementById('shop-grid');
    grid.innerHTML = state.shop.map(i => `
        <div class="shop-card">
            <h3 class="text-yellow">${i.name}</h3>
            <p class="text-gray text-sm flex-grow">${i.desc}</p>
            <div class="text-yellow mb-5">💰 ${i.cost}</div>
            ${state.isAdminMode ? `
                <div class="flex-row">
                    <button class="btn-primary flex-grow" onclick="openShopEdit('${i.id}')">📜</button>
                    <button class="btn-dashed flex-grow" onclick="deleteShopItem('${i.id}')">🪓</button>
                </div>
            ` : `<button class="btn-primary" onclick="buyItem(${i.cost})">Purchase</button>`}
        </div>
    `).join('');
}
function openShopEdit(id) {
    const item = state.shop.find(i => i.id === id);
    document.getElementById('admin-id').value = item.id; document.getElementById('admin-name').value = item.name;
    document.getElementById('admin-cost').value = item.cost; document.getElementById('admin-desc').value = item.desc;
    openModal('admin-modal');
}
function saveShopItem() {
    const id = document.getElementById('admin-id').value; const name = document.getElementById('admin-name').value;
    const cost = parseInt(document.getElementById('admin-cost').value); const desc = document.getElementById('admin-desc').value;
    if(!id || !name) return; const existingIdx = state.shop.findIndex(i => i.id === id);
    if(existingIdx >= 0) state.shop[existingIdx] = {id, name, cost, desc}; 
    closeModal('admin-modal'); saveToStorage(); renderShop();
}
function deleteShopItem(id) { state.shop = state.shop.filter(i => i.id !== id); saveToStorage(); renderShop(); }
function buyItem(cost) { if (state.hero.gold >= cost) { state.hero.gold -= cost; showToast(`Item Purchased!`); saveToStorage(); updateHUD(); } else { showToast("Not enough gold."); } }

// ==========================================
// 6. UI Helpers & Animators
// ==========================================
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id, isSubmit = false) { 
    document.getElementById(id).classList.add('hidden'); 
    if(id === 'calendar-modal' && !isSubmit) {
        if (!pendingCustomDateStr) {
            document.getElementById('prophecy-deadline').value = 'eternal';
            const display = document.getElementById('prophecy-deadline-display');
            if(display) display.innerText = '∞ Eternal';
        }
    }
}
function toggleAccordion(id) {
    const content = document.getElementById(`${id}-content`); const icon = document.getElementById(`${id}-icon`);
    if(content.classList.contains('hidden')) { content.classList.remove('hidden'); icon.innerText = '▼'; } else { content.classList.add('hidden'); icon.innerText = '▶'; }
}
function showToast(msg) { const toast = document.getElementById('epic-toast'); toast.innerText = msg; toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 3000); }
function showFloatingText(x, y, text, color, animClass = 'floatUp') {
    const el = document.createElement('div'); el.className = `floating-text ${animClass}`;
    el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.color = color; el.innerText = text;
    document.body.appendChild(el); setTimeout(() => el.remove(), 1200);
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


// ✨ 非同步啟動器：遊戲載入時優先嘗試從雲端拿取最新進度
window.onload = async () => {
    const isCloudLoaded = await loadFromCloud();
    if (!isCloudLoaded) {
        // 如果還沒登入、網路斷掉，或是雲端沒存檔，就無痛使用本地快取
        loadFromStorage();
    }

    renderAllQuests(); 
    renderBosses(); 
    renderShop(); 
    renderPotions();
    document.getElementById('diff-slider').value = state.hero.vitalityDifficulty;
    document.getElementById('diff-value').innerText = state.hero.vitalityDifficulty;
    setInterval(gameTick, 1000); 
};