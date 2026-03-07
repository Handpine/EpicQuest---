// ==========================================
// 1. 全域狀態與初始化
// ==========================================
let state = {
    hero: {
        name: 'Hero', // ✨ 英雄名稱
        level: 1, exp: 0, nextExp: 100, gold: 0,
        hp: 100, maxHp: 100,
        vitalityDifficulty: 24,
        stats: { questsToday: 0, questsWeek: 0, hpHealedToday: 0 }
    },
    quests: [], // type: 'active', 'tomorrow', 'prophecy', 'backlog'
    bosses: [], // {id, name, currentHp, maxHp, subtasks: [{id, title, gold, dmg, active, type, deadline}]}
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

// ✨ 升級 Cache 版本，確保 Boss 跨時空邏輯與純右滑手勢生效
const CACHE_KEY = 'epic-quest-v17';

// 月曆專用全域變數 (支援多重 Context: 'create', 'edit', 'transfer')
let currentCalDate = new Date();
let pendingCustomDateStr = null; 
let windowCalendarContext = 'create'; 

function loadFromStorage() {
    const saved = localStorage.getItem(CACHE_KEY);
    if (saved) {
        state = JSON.parse(saved);
        if (!state.hero.name) state.hero.name = 'Hero';
    }
}

function getWeekIdentifier() {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + 4 - (d.getDay()||7));
    return Math.ceil((((d - new Date(d.getFullYear(),0,1))/8.64e7)+1)/7);
}


// ==========================================
// 🌟 雲端同步與 Life Progress 聯動核心 🌟
// ==========================================

function getTodayDateKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function appendToLifeProgressPlan(itemName) {
    const todayKey = getTodayDateKey();
    console.log(`🔮 嘗試將 [${itemName}] 寫入 Life Progress (${todayKey})...`);

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();

        const { data: entry, error: fetchError } = await supabaseClient
            .from('entries')
            .select('id, plan')
            .eq('date_key', todayKey)
            .maybeSingle(); 

        if (fetchError) throw fetchError;

        let newPlan = `• ${itemName}`;
        
        if (entry) {
            const currentPlan = entry.plan || "";
            newPlan = currentPlan.trim() ? `${currentPlan}\n• ${itemName}` : `• ${itemName}`;
            
            await supabaseClient
                .from('entries')
                .update({ plan: newPlan, updated_at: Date.now() })
                .eq('id', entry.id);
        } else {
            await supabaseClient
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
        console.warn("❌ 聯動 Life Progress 失敗:", err);
    }
}

async function saveToCloud() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return; 

        await supabaseClient
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

async function loadFromCloud() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return false;

        const { data, error } = await supabaseClient
            .from('epic_quest_save')
            .select('state_data')
            .eq('user_id', session.user.id)
            .maybeSingle();

        if (data && data.state_data) {
            state = data.state_data;
            if (!state.hero.name) state.hero.name = 'Hero'; 
            return true; 
        }
    } catch (err) {
        console.log("從雲端載入失敗...");
    }
    return false;
}

function saveToStorage() {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    saveToCloud();
}

// ==========================================
// 🔐 英雄公會身分驗證 (Supabase Auth)
// ==========================================

async function handleSignUp() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    if (!email || !password) { showToast("⚠️ Email and Password required!"); return; }

    showToast("⏳ Sealing your fate...");
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    
    if (error) showToast(`❌ Error: ${error.message}`);
    else showToast("✨ Guild Contract Signed! You can now login.");
}

async function handleLogin() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    if (!email || !password) { showToast("⚠️ Email and Password required!"); return; }

    showToast("⏳ Channeling magic...");
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    
    if (error) showToast(`❌ Error: ${error.message}`);
    else {
        closeModal('auth-modal'); showToast("🔮 Welcome back, Hero!");
        document.getElementById('auth-password').value = ''; 
        checkAuthAndUpdateUI(); 
        
        const loaded = await loadFromCloud();
        if (loaded) {
            renderAllQuests(); renderBosses(); renderShop(); renderPotions(); updateHUD();
            showToast("☁️ Cloud state synced!");
        }
    }
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    showToast("💨 You have left the guild.");
    checkAuthAndUpdateUI();
}

async function checkAuthAndUpdateUI() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const statusText = document.getElementById('auth-status-text');
    const btnLogin = document.getElementById('btn-show-login');
    const btnLogout = document.getElementById('btn-logout');

    if (session) {
        statusText.innerText = `Hero Soul Bound: ${session.user.email}`;
        statusText.style.color = "var(--magic-blue)";
        if(btnLogin) btnLogin.classList.add('hidden');
        if(btnLogout) btnLogout.classList.remove('hidden');
    } else {
        statusText.innerText = "Not logged in (Local Save Only)";
        statusText.style.color = "var(--text-gray)";
        if(btnLogin) btnLogin.classList.remove('hidden');
        if(btnLogout) btnLogout.classList.add('hidden');
    }
}


// ==========================================
// 2. 核心迴圈 & HUD & 英雄名稱管理
// ==========================================

function saveHeroName() {
    const input = document.getElementById('new-hero-name-input').value.trim();
    if (input) {
        state.hero.name = input; saveToStorage(); updateHUD();
        closeModal('name-modal'); showToast("Hero renamed!");
    } else showToast("⚠️ Name cannot be empty!");
}

function gameTick() {
    const now = Date.now();
    const hpDecay = (state.hero.vitalityDifficulty / (24 * 60 * 60 * 1000)) * (now - state.lastTick);
    state.hero.hp = Math.max(0, state.hero.hp - hpDecay);
    state.lastTick = now;

    const today = new Date().toLocaleDateString();
    if (state.lastResetDate !== today) {
        state.hero.stats.questsToday = 0; state.hero.stats.hpHealedToday = 0;
        state.quests.forEach(q => { if (q.type === 'tomorrow') q.type = 'active'; });
        
        // ✨ 新增：Boss 子任務跨日自動回歸 Active
        state.bosses.forEach(b => b.subtasks.forEach(st => {
            if (st.type === 'tomorrow') { st.type = 'active'; st.active = true; }
        }));
        
        checkDateTransfers(); state.lastResetDate = today;
        showToast("A new day dawns..."); renderAllQuests();
    }
    const currentWeek = getWeekIdentifier();
    if (state.lastWeekResetDate !== currentWeek) {
        state.hero.stats.questsWeek = 0; state.lastWeekResetDate = currentWeek;
    }

    updateHUD(); updateTimer(); saveToStorage();
}

function checkDateTransfers() {
    const todayMs = new Date().setHours(0,0,0,0);
    // 普通預言檢查
    state.quests.forEach(q => {
        if (q.type === 'prophecy' && q.deadline !== 'eternal' && q.deadlineDate) {
            if (todayMs >= new Date(q.deadlineDate).getTime()) q.type = 'active';
        }
    });
    // ✨ Boss 預言檢查：到期自動回歸 Active
    state.bosses.forEach(b => {
        b.subtasks.forEach(st => {
            const effectiveType = st.type || (st.active ? 'active' : 'boss-pool');
            if (effectiveType === 'prophecy' && st.deadline !== 'eternal' && st.deadlineDate) {
                if (todayMs >= new Date(st.deadlineDate).getTime()) {
                    st.type = 'active'; st.active = true;
                }
            }
        });
    });
}

function updateHUD() {
    const heroNameDisplay = state.hero.name || 'Hero';
    document.getElementById('hud-hero-name').innerText = heroNameDisplay;
    document.getElementById('profile-hero-name').innerText = heroNameDisplay;

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
    const now = new Date(); const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
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
    document.getElementById('active-quest-list').classList.toggle('edit-mode-on'); 
    document.getElementById('toggle-edit-btn').classList.toggle('active');
}
function toggleFutureEdit() {
    document.querySelectorAll('.future-list-group').forEach(list => list.classList.toggle('edit-mode-on'));
    document.getElementById('toggle-future-edit-btn').classList.toggle('active');
}
function toggleBossEdit() {
    document.querySelectorAll('.boss-list-group').forEach(list => list.classList.toggle('edit-mode-on'));
    document.getElementById('toggle-boss-edit-btn').classList.toggle('active');
}


function toggleCustomSelect(context) { 
    const menuId = context === 'create' ? 'prophecy-options-menu' : `${context}-prophecy-options-menu`;
    document.getElementById(menuId).classList.toggle('hidden'); 
}

function selectProphecyOption(context, value, text) {
    const hiddenInputId = context === 'create' ? 'prophecy-deadline' : `${context}-prophecy-deadline`;
    const displayId = context === 'create' ? 'prophecy-deadline-display' : `${context}-prophecy-deadline-display`;
    const menuId = context === 'create' ? 'prophecy-options-menu' : `${context}-prophecy-options-menu`;

    document.getElementById(hiddenInputId).value = value; 
    document.getElementById(displayId).innerText = text; 
    document.getElementById(menuId).classList.add('hidden'); 

    if (value === 'custom') {
        pendingCustomDateStr = null; 
        checkCustomDate(context); 
    } else {
        pendingCustomDateStr = null;
    }
}

// 點擊外部關閉所有下拉選單
document.addEventListener('click', function(event) {
    ['prophecy-options-menu', 'edit-prophecy-options-menu', 'transfer-prophecy-options-menu'].forEach(menuId => {
        const menu = document.getElementById(menuId);
        if (menu && !menu.classList.contains('hidden')) {
            const container = menu.closest('.custom-select-container');
            if (container && !container.contains(event.target)) menu.classList.add('hidden');
        }
    });
});

function checkCustomDate(context) {
    windowCalendarContext = context; // 記錄是哪個視窗召喚了月曆
    currentCalDate = new Date(); renderCalendar(); openModal('calendar-modal'); 
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
    
    // 根據召喚來源更新文字
    const displayId = windowCalendarContext === 'create' ? 'prophecy-deadline-display' : `${windowCalendarContext}-prophecy-deadline-display`;
    const display = document.getElementById(displayId);
    if (display) display.innerText = `✨ Sealed: ${pendingCustomDateStr}`;
    setTimeout(() => { closeModal('calendar-modal', true); showToast(`Date Sealed!`); }, 350);
}


// ==========================================
// 4. 任務管理、轉移與極致打擊感
// ==========================================
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
    
    // ✨ 核心修正：讓 Boss 任務能順利散佈在對應的清單中
    state.bosses.forEach(b => {
        b.subtasks.forEach(st => {
            const effectiveType = st.type || (st.active ? 'active' : 'boss-pool');
            if (effectiveType === type) {
                // 保留 Boss 的所有危險屬性與關聯
                itemsToRender.push({ ...st, isBoss: true, bossId: b.id, bossName: b.name });
            }
        });
    });

    document.getElementById(emptyId).classList.toggle('hidden', itemsToRender.length > 0);

    itemsToRender.forEach(q => {
        const div = document.createElement('div'); div.className = `quest-card ${q.isBoss ? 'boss-quest' : ''}`; div.id = q.isBoss ? `boss-st-${q.id}` : `quest-${q.id}`;
        let headerHtml = q.isBoss ? `<div class="boss-tag">🐉 ${q.bossName}</div><br>` : ''; let extraInfo = '';
        
        if(type === 'prophecy' && q.deadlineDate) {
            const daysLeft = Math.ceil((new Date(q.deadlineDate) - new Date()) / 8.64e7);
            if(daysLeft <= 3) div.classList.add('prophecy-danger'); else div.classList.add('prophecy-safe');
            extraInfo = `<br><span class="text-gray text-sm">⏳ ${daysLeft} days left</span>`;
        }

        // 用來判定呼叫函數時要傳什麼參數
        const questTypeArg = q.isBoss ? 'boss-sub' : 'quest';
        const bossIdArg = q.isBoss ? q.bossId : 'null';

        div.innerHTML = `
            <div class="quest-content-row">
                <div>${headerHtml}${q.title} ${extraInfo}</div>
                ${type !== 'backlog' ? `<div>💰 ${q.gold}</div>` : ''}
            </div>
            <div class="quest-actions action-area">
                <span class="action-icon edit-action" onclick="openEditModal(${q.id}, '${questTypeArg}', ${bossIdArg})">📜</span>
                <span class="action-icon delete-action" onclick="deleteQuest(${q.id}, '${questTypeArg}', ${bossIdArg})">🪓</span>
                
                ${type === 'active' ? `<span class="action-icon time-action" onclick="openTransferTimeModal(${q.id}, '${questTypeArg}', ${bossIdArg})">⏱️</span>` : ''}
                
                ${type !== 'active' ? `<span class="action-icon transfer-action" onclick="transferToActive(${q.id}, '${questTypeArg}', ${bossIdArg})">📯</span>` : ''}
            </div>
        `;
        list.appendChild(div); 
        bindGestures(div, () => executeSlash(div, q));
    });
}


// ✨ 核心升級：純粹右滑斬擊 (移除了長按誤觸)
function bindGestures(element, onComplete) {
    let startX = 0, isCompleted = false;
    const start = (e) => {
        if(e.target.closest('.action-area')) return; 
        isCompleted = false; 
        startX = e.touches ? e.touches[0].clientX : e.clientX;
    };
    const move = (e) => {
        if(isCompleted || startX === 0) return; 
        const currentX = e.touches ? e.touches[0].clientX : e.clientX;
        if(currentX - startX > 100) { 
            isCompleted = true; startX = 0; 
            onComplete(e); 
        } 
    };
    const end = () => { startX = 0; };

    element.addEventListener('touchstart', start, {passive: true}); 
    element.addEventListener('touchmove', move, {passive: true});
    element.addEventListener('touchend', end); 
    element.addEventListener('mousedown', start);
    element.addEventListener('mousemove', move); 
    element.addEventListener('mouseup', end); 
    element.addEventListener('mouseleave', end);
}

function executeSlash(cardEl, q) {
    const slash = document.createElement('div'); slash.className = 'slash-line';
    cardEl.appendChild(slash); cardEl.classList.add('burning');

    const expGain = 10; const goldGain = q.gold || 0; const rect = cardEl.getBoundingClientRect();
    showFloatingText(rect.left + rect.width/2, rect.top, `+${expGain} EXP`, '#4caf50', 'float-up-left');
    if (goldGain > 0) showFloatingText(rect.left + rect.width/2, rect.top, `+${goldGain} G`, 'var(--gold)', 'float-up-right');

    setTimeout(() => {
        appendToLifeProgressPlan(q.title);

        if (q.isBoss) {
            // Boss 任務扣血邏輯完美連動
            const boss = state.bosses.find(b => b.id === q.bossId);
            boss.currentHp -= q.dmg;
            boss.subtasks = boss.subtasks.filter(st => st.id !== q.id);
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


// ✨ 強化：編輯功能 (全面支援 Boss Sub 與預言期限)
function openEditModal(id, type, bossId = null) {
    let q;
    if (type === 'boss-sub') {
        const boss = state.bosses.find(b => b.id === bossId);
        q = boss.subtasks.find(s => s.id === id);
    } else { q = state.quests.find(item => item.id === id); }
    if(!q) return;

    document.getElementById('edit-quest-id').value = id; 
    document.getElementById('edit-quest-type').value = type;
    document.getElementById('edit-boss-id').value = bossId || '';
    document.getElementById('edit-quest-title').value = q.title; 
    document.getElementById('edit-quest-gold').value = q.gold;
    
    // 取得真正的 Type，決定是否顯示預言選單
    const effectiveType = q.type || (q.active ? 'active' : 'boss-pool');
    const deadlineWrapper = document.getElementById('edit-deadline-wrapper');
    
    if (effectiveType === 'prophecy') {
        deadlineWrapper.classList.remove('hidden');
        document.getElementById('edit-prophecy-deadline').value = q.deadline || 'eternal';
        let displayTxt = '∞ Eternal';
        if (q.deadline === '7') displayTxt = '1 Week';
        else if (q.deadline === '14') displayTxt = '2 Weeks';
        else if (q.deadline === '30') displayTxt = '1 Month';
        else if (q.deadline === 'custom') displayTxt = `✨ Sealed: ${q.deadlineDate}`;
        document.getElementById('edit-prophecy-deadline-display').innerText = displayTxt;
        pendingCustomDateStr = (q.deadline === 'custom') ? q.deadlineDate : null;
    } else {
        deadlineWrapper.classList.add('hidden');
    }
    openModal('edit-quest-modal');
}

function saveEditedQuest() {
    const id = parseInt(document.getElementById('edit-quest-id').value); 
    const type = document.getElementById('edit-quest-type').value;
    const bossId = parseInt(document.getElementById('edit-boss-id').value);
    let q;

    if (type === 'boss-sub') {
        const boss = state.bosses.find(b => b.id === bossId);
        q = boss.subtasks.find(s => s.id === id);
    } else { q = state.quests.find(item => item.id === id); }
    if (!q) return;

    q.title = document.getElementById('edit-quest-title').value; 
    q.gold = parseInt(document.getElementById('edit-quest-gold').value) || 10;

    const effectiveType = q.type || (q.active ? 'active' : 'boss-pool');
    if (effectiveType === 'prophecy') {
        const deadline = document.getElementById('edit-prophecy-deadline').value;
        q.deadline = deadline; let deadlineDate = null; const d = new Date();
        if (deadline === '7') { d.setDate(d.getDate() + 7); deadlineDate = d.toISOString().split('T')[0]; }
        else if (deadline === '14') { d.setDate(d.getDate() + 14); deadlineDate = d.toISOString().split('T')[0]; }
        else if (deadline === '30') { d.setDate(d.getDate() + 30); deadlineDate = d.toISOString().split('T')[0]; }
        else if (deadline === 'custom') deadlineDate = pendingCustomDateStr;
        q.deadlineDate = deadlineDate;
    }
    
    closeModal('edit-quest-modal'); saveToStorage(); renderAllQuests(); renderBosses();
}

function deleteQuest(id, type = 'quest', bossId = null) { 
    if (type === 'boss-sub') {
        const boss = state.bosses.find(b => b.id === bossId);
        boss.subtasks = boss.subtasks.filter(s => s.id !== id);
        saveToStorage(); renderBosses(); renderAllQuests();
    } else {
        state.quests = state.quests.filter(q => q.id !== id); 
        saveToStorage(); renderAllQuests(); 
    }
}

function transferToActive(id, type, bossId = null) {
    if(type === 'quest') { 
        const q = state.quests.find(item => item.id === id); q.type = 'active'; 
    }
    else if(type === 'boss-sub') { 
        const boss = state.bosses.find(b=>b.id===bossId); 
        const st = boss.subtasks.find(s=>s.id===id); 
        st.type = 'active'; st.active = true; 
    }
    saveToStorage(); renderAllQuests(); renderBosses();
}


// ✨ 新增：時光魔法轉移系統 (Bend Time)
function openTransferTimeModal(id, type, bossId = null) {
    document.getElementById('transfer-quest-id').value = id;
    document.getElementById('transfer-quest-type').value = type;
    document.getElementById('transfer-boss-id').value = bossId || '';
    
    document.getElementById('transfer-prophecy-deadline').value = 'eternal';
    document.getElementById('transfer-prophecy-deadline-display').innerText = '∞ Eternal';
    pendingCustomDateStr = null;

    openModal('transfer-time-modal');
}

function executeTimeTransfer(targetType) {
    const id = parseInt(document.getElementById('transfer-quest-id').value);
    const type = document.getElementById('transfer-quest-type').value;
    const bossId = parseInt(document.getElementById('transfer-boss-id').value);
    let q;

    // 1. 抓取任務 (Boss 任務保留在 Boss 資料結構內)
    if (type === 'boss-sub') {
        const boss = state.bosses.find(b => b.id === bossId);
        q = boss.subtasks.find(s => s.id === id);
        q.type = targetType;
        q.active = (targetType === 'active');
    } else {
        q = state.quests.find(item => item.id === id);
        state.quests = state.quests.filter(item => item.id !== id);
        q.type = targetType;
        state.quests.push(q); // 重新推入更新排序
    }
    if (!q) return;

    // 2. 賦予新時間屬性
    if (targetType === 'prophecy') {
        const deadline = document.getElementById('transfer-prophecy-deadline').value;
        q.deadline = deadline; let deadlineDate = null; const d = new Date();
        if (deadline === '7') { d.setDate(d.getDate() + 7); deadlineDate = d.toISOString().split('T')[0]; }
        else if (deadline === '14') { d.setDate(d.getDate() + 14); deadlineDate = d.toISOString().split('T')[0]; }
        else if (deadline === '30') { d.setDate(d.getDate() + 30); deadlineDate = d.toISOString().split('T')[0]; }
        else if (deadline === 'custom') {
            if (!pendingCustomDateStr) { 
                showToast("⚠️ Select a calendar date first!"); 
                // 如果是普通任務，放回原本的地方避免消失
                if(type !== 'boss-sub') state.quests.push(q); 
                return; 
            }
            deadlineDate = pendingCustomDateStr;
        }
        q.deadlineDate = deadlineDate;
    } else {
        q.deadline = 'eternal'; q.deadlineDate = null;
    }

    closeModal('transfer-time-modal'); saveToStorage(); renderAllQuests(); renderBosses();
    showToast(`Time Bent to ${targetType}!`);
}


// ==========================================
// 5. Boss 系統與管理
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
        
        // ✨ 新增：僅在 boss-pool 中的子任務才會出現在這個頁面
        let subtasksHtml = b.subtasks.filter(st => {
            const effectiveType = st.type || (st.active ? 'active' : 'boss-pool');
            return effectiveType === 'boss-pool';
        }).map(st => `
            <div class="quest-card mt-5" id="boss-st-${st.id}">
                <div class="quest-content-row">
                    <div>${st.title} <span class="text-gray text-sm">[DMG: ${st.dmg}] [💰: ${st.gold}]</span></div>
                    <div class="action-area boss-actions">
                        <span class="action-icon edit-action" onclick="openEditModal(${st.id}, 'boss-sub', ${b.id})">📜</span>
                        <span class="action-icon delete-action" onclick="deleteQuest(${st.id}, 'boss-sub', ${b.id})">🪓</span>
                        <span class="action-icon time-action" onclick="openTransferTimeModal(${st.id}, 'boss-sub', ${b.id})">⏱️</span>
                        <span class="action-icon transfer-action" onclick="transferToActive(${st.id}, 'boss-sub', ${b.id})">📯</span>
                    </div>
                </div>
            </div>`).join('');

        div.innerHTML = `
            <div class="text-center" style="position: relative;">
                <h2 style="color:var(--hp-low)">☠️ ${b.name}</h2>
                <div class="boss-header-actions action-area">
                    <span class="surrender-action" onclick="surrenderBoss(${b.id})" title="Surrender">🏳️ Abandon Battle</span>
                </div>
            </div>
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

// ✨ 新增：放棄討伐
function surrenderBoss(bossId) {
    if(confirm("🏳️ Are you sure you want to abandon this battle? The boss and its tasks will be lost!")) {
        state.bosses = state.bosses.filter(b => b.id !== bossId);
        saveToStorage(); renderBosses(); renderAllQuests(); showToast("🏳️ Battle Abandoned.");
    }
}


// ==========================================
// 6. Potions & Shop
// ==========================================
function renderPotions() {
    const list = document.getElementById('potion-list');
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

function consumePotion(amount, name) {
    if(state.hero.hp >= state.hero.maxHp) { showToast("HP is full."); return; }
    state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + amount);
    state.hero.stats.hpHealedToday += amount;
    showToast(`Potion Used! +${amount} HP`);
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
// 7. UI Helpers & Animators
// ==========================================
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id, isSubmit = false) { 
    document.getElementById(id).classList.add('hidden'); 
    if(id === 'calendar-modal' && !isSubmit) {
        if (!pendingCustomDateStr) {
            const context = windowCalendarContext || 'create';
            document.getElementById(context === 'create' ? 'prophecy-deadline' : `${context}-prophecy-deadline`).value = 'eternal';
            const display = document.getElementById(context === 'create' ? 'prophecy-deadline-display' : `${context}-prophecy-deadline-display`);
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


window.onload = async () => {
    await checkAuthAndUpdateUI();
    const isCloudLoaded = await loadFromCloud();
    if (!isCloudLoaded) loadFromStorage();

    renderAllQuests(); 
    renderBosses(); 
    renderShop(); 
    renderPotions();
    document.getElementById('diff-slider').value = state.hero.vitalityDifficulty;
    document.getElementById('diff-value').innerText = state.hero.vitalityDifficulty;
    setInterval(gameTick, 1000); 
};