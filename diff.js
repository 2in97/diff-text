/**
 * 文本比对工具 - 核心逻辑
 * 基于 LCS（最长公共子序列）的行级 diff 算法
 */

(function () {
    'use strict';

    // ============ DOM 引用 ============
    const $ = (id) => document.getElementById(id);
    const leftInput = $('leftInput');
    const rightInput = $('rightInput');
    const compareBtn = $('compareBtn');
    const clearBtn = $('clearBtn');
    const swapBtn = $('swapBtn');
    const loadSampleBtn = $('loadSampleBtn');
    const toggleViewBtn = $('toggleViewBtn');
    const diffSection = $('diffSection');
    const leftPaneBody = $('leftPaneBody');
    const rightPaneBody = $('rightPaneBody');
    const mobilePaneBody = $('mobilePaneBody');
    const addCountEl = $('addCount');
    const delCountEl = $('delCount');
    const modCountEl = $('modCount');
    const resultOutput = $('resultOutput');
    const exportBtn = $('exportBtn');
    const copyResultBtn = $('copyResultBtn');
    const acceptAllLeftBtn = $('acceptAllLeftBtn');
    const acceptAllRightBtn = $('acceptAllRightBtn');
    const toastEl = $('toast');

    // ============ 状态 ============
    let pairs = [];        // 比对结果对
    let mobileSide = 'left'; // 手机当前查看的一侧

    // ============ 工具函数 ============
    function splitLines(text) {
        if (text === '') return [];
        // 保留 \r\n 与 \n 处理，统一去掉 \r
        const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = normalized.split('\n');
        // 若文本以换行结尾，最后一个空串无意义，保留即可（与编辑器一致）
        return lines;
    }

    function escapeHtml(s) {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function showToast(msg) {
        toastEl.textContent = msg;
        toastEl.hidden = false;
        clearTimeout(showToast._t);
        showToast._t = setTimeout(() => { toastEl.hidden = true; }, 1800);
    }

    // ============ Diff 算法（LCS）============
    /**
     * 计算两段行数组的 diff 操作序列
     * @returns {Array<{type:'equal'|'del'|'add', value:string}>}
     */
    function diffLines(a, b) {
        const m = a.length, n = b.length;
        // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = m - 1; i >= 0; i--) {
            for (let j = n - 1; j >= 0; j--) {
                if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
                else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const ops = [];
        let i = 0, j = 0;
        while (i < m && j < n) {
            if (a[i] === b[j]) {
                ops.push({ type: 'equal', value: a[i] });
                i++; j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                ops.push({ type: 'del', value: a[i] });
                i++;
            } else {
                ops.push({ type: 'add', value: b[j] });
                j++;
            }
        }
        while (i < m) { ops.push({ type: 'del', value: a[i] }); i++; }
        while (j < n) { ops.push({ type: 'add', value: b[j] }); j++; }
        return ops;
    }

    /**
     * 将操作序列分组成「对」：equal / modify / add / del
     */
    function groupOps(ops) {
        const result = [];
        let i = 0;
        while (i < ops.length) {
            const op = ops[i];
            if (op.type === 'equal') {
                // 合并连续 equal
                const lines = [];
                while (i < ops.length && ops[i].type === 'equal') {
                    lines.push(ops[i].value);
                    i++;
                }
                result.push({ type: 'equal', left: lines, right: lines.slice(), choice: 'equal' });
            } else {
                const dels = [], adds = [];
                while (i < ops.length && ops[i].type !== 'equal') {
                    if (ops[i].type === 'del') dels.push(ops[i].value);
                    else adds.push(ops[i].value);
                    i++;
                }
                if (dels.length && adds.length) {
                    result.push({ type: 'modify', left: dels, right: adds, choice: 'right' });
                } else if (dels.length) {
                    result.push({ type: 'del', left: dels, right: [], choice: 'right' });
                } else {
                    result.push({ type: 'add', left: [], right: adds, choice: 'right' });
                }
            }
        }
        return result;
    }

    // ============ 行号计算 ============
    function computeLineNumbers(pairs) {
        // 为每对中的每一行分配左侧/右侧行号
        let leftNo = 1, rightNo = 1;
        pairs.forEach(p => {
            p.leftNos = [];
            p.rightNos = [];
            if (p.type === 'equal') {
                p.left.forEach(() => { p.leftNos.push(leftNo++); });
                p.right.forEach(() => { p.rightNos.push(rightNo++); });
            } else if (p.type === 'modify') {
                p.left.forEach(() => { p.leftNos.push(leftNo++); });
                p.right.forEach(() => { p.rightNos.push(rightNo++); });
            } else if (p.type === 'del') {
                p.left.forEach(() => { p.leftNos.push(leftNo++); });
                // right 无行
            } else if (p.type === 'add') {
                p.right.forEach(() => { p.rightNos.push(rightNo++); });
            }
        });
    }

    // ============ 渲染：PC 双栏 ============
    function renderPc() {
        leftPaneBody.innerHTML = '';
        rightPaneBody.innerHTML = '';
        pairs.forEach((p, idx) => {
            const rowType = pairRowType(p);
            const maxRows = Math.max(p.left.length, p.right.length, 1);
            const pairEl = document.createElement('div');
            pairEl.className = 'diff-pair';
            pairEl.dataset.idx = idx;

            for (let r = 0; r < maxRows; r++) {
                // 左
                const lRow = makeRow({
                    sign: p.left[r] !== undefined ? leftSign(p) : '',
                    content: p.left[r] !== undefined ? p.left[r] : '',
                    no: p.leftNos[r] || '',
                    rowClass: p.left[r] !== undefined ? rowType : 'row-empty',
                    empty: p.left[r] === undefined
                });
                pairEl.appendChild(lRow);
            }
            leftPaneBody.appendChild(pairEl);

            const pairElR = document.createElement('div');
            pairElR.className = 'diff-pair';
            pairElR.dataset.idx = idx;

            for (let r = 0; r < maxRows; r++) {
                const rRow = makeRow({
                    sign: p.right[r] !== undefined ? rightSign(p) : '',
                    content: p.right[r] !== undefined ? p.right[r] : '',
                    no: p.rightNos[r] || '',
                    rowClass: p.right[r] !== undefined ? rowType : 'row-empty',
                    empty: p.right[r] === undefined
                });
                pairElR.appendChild(rRow);
            }
            rightPaneBody.appendChild(pairElR);

            // 在左右 pair 上都挂控制按钮（视觉对称，事件用委托处理）
            if (p.type !== 'equal') {
                pairElR.appendChild(makePairControl(p, idx));
                pairEl.appendChild(makePairControl(p, idx));
            }
        });
    }

    function leftSign(p) {
        if (p.type === 'equal') return ' ';
        if (p.type === 'modify' || p.type === 'del') return '-';
        return ' ';
    }
    function rightSign(p) {
        if (p.type === 'equal') return ' ';
        if (p.type === 'modify' || p.type === 'add') return '+';
        return ' ';
    }
    function pairRowType(p) {
        if (p.type === 'equal') return 'row-equal';
        if (p.type === 'modify') return 'row-mod';
        if (p.type === 'add') return 'row-add';
        return 'row-del';
    }

    function makeRow({ sign, content, no, rowClass, empty }) {
        const row = document.createElement('div');
        row.className = 'diff-row ' + rowClass;
        const gutter = document.createElement('span');
        gutter.className = 'line-gutter';
        gutter.textContent = no;
        const signEl = document.createElement('span');
        signEl.className = 'line-sign';
        signEl.textContent = sign;
        const contentEl = document.createElement('span');
        contentEl.className = 'line-content';
        contentEl.innerHTML = empty ? '&nbsp;' : escapeHtml(content);
        row.appendChild(gutter);
        row.appendChild(signEl);
        row.appendChild(contentEl);
        return row;
    }

    function makePairControl(p, idx) {
        const ctrl = document.createElement('div');
        ctrl.className = 'pair-control';
        ctrl.dataset.idx = idx;
        const opts = optionsForPair(p);
        opts.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'pair-btn' + (p.choice === opt ? ' active' : '');
            btn.textContent = optLabel(opt);
            btn.dataset.opt = opt;
            // 事件由 pane body 上的委托统一处理（避免 cloneNode 丢监听）
            ctrl.appendChild(btn);
        });
        return ctrl;
    }

    function optionsForPair(p) {
        if (p.type === 'modify') return ['left', 'right', 'both'];
        if (p.type === 'del') return ['left', 'right'];   // left=保留 / right=移除
        if (p.type === 'add') return ['left', 'right'];    // left=跳过 / right=保留
        return [];
    }

    function optLabel(opt) {
        return { left: '左', right: '右', both: '都' }[opt] || opt;
    }

    function updatePairControlState(idx) {
        const p = pairs[idx];
        document.querySelectorAll(`.diff-pair[data-idx="${idx}"] .pair-control`).forEach(ctrl => {
            ctrl.querySelectorAll('.pair-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.opt === p.choice);
            });
        });
        // 同步手机视图
        const mobileBtns = mobilePaneBody.querySelectorAll(`.mobile-pair[data-idx="${idx}"] .pair-btn`);
        mobileBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.opt === p.choice);
        });
    }

    // ============ 渲染：手机单栏（统一视图）============
    function renderMobile() {
        mobilePaneBody.innerHTML = '';
        pairs.forEach((p, idx) => {
            if (p.type === 'equal') {
                p.left.forEach((line, r) => {
                    const row = makeRow({
                        sign: ' ',
                        content: line,
                        no: p.leftNos[r] || '',
                        rowClass: 'row-equal',
                        empty: false
                    });
                    mobilePaneBody.appendChild(row);
                });
                return;
            }
            // diff pair 卡片
            const card = document.createElement('div');
            card.className = 'mobile-pair diff-pair';
            card.dataset.idx = idx;
            card.style.cssText = 'border:1px solid var(--border);border-radius:4px;margin:6px 0;overflow:hidden;';

            const rowType = pairRowType(p);
            p.left.forEach((line, r) => {
                const row = makeRow({
                    sign: '-',
                    content: line,
                    no: p.leftNos[r] || '',
                    rowClass: rowType === 'row-add' ? 'row-del' : rowType,
                    empty: false
                });
                card.appendChild(row);
            });
            p.right.forEach((line, r) => {
                const row = makeRow({
                    sign: '+',
                    content: line,
                    no: p.rightNos[r] || '',
                    rowClass: rowType === 'row-del' ? 'row-add' : rowType,
                    empty: false
                });
                card.appendChild(row);
            });

            // 控制按钮（手机上直接显示在卡片底部）
            const ctrlWrap = document.createElement('div');
            ctrlWrap.style.cssText = 'padding:6px 8px;border-top:1px solid var(--border);background:var(--bg-input);display:flex;gap:6px;align-items:center;';
            const label = document.createElement('span');
            label.style.cssText = 'font-size:11px;color:var(--text-muted);margin-right:auto;';
            label.textContent = '采用：';
            ctrlWrap.appendChild(label);
            const opts = optionsForPair(p);
            opts.forEach(opt => {
                const btn = document.createElement('button');
                btn.className = 'pair-btn' + (p.choice === opt ? ' active' : '');
                btn.textContent = optLabel(opt);
                btn.dataset.opt = opt;
                btn.style.cssText = 'padding:4px 10px;font-size:12px;border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--text);cursor:pointer;';
                ctrlWrap.appendChild(btn);
            });
            card.appendChild(ctrlWrap);
            mobilePaneBody.appendChild(card);
        });
    }

    // ============ 渲染：合并结果 ============
    function renderResult() {
        const out = [];
        pairs.forEach(p => {
            if (p.type === 'equal') {
                out.push(...p.left);
            } else if (p.type === 'modify') {
                if (p.choice === 'left') out.push(...p.left);
                else if (p.choice === 'right') out.push(...p.right);
                else { out.push(...p.left); out.push(...p.right); }
            } else if (p.type === 'add') {
                if (p.choice === 'right' || p.choice === 'both') out.push(...p.right);
                // 'left' = 跳过
            } else if (p.type === 'del') {
                if (p.choice === 'left' || p.choice === 'both') out.push(...p.left);
                // 'right' = 移除
            }
        });
        resultOutput.textContent = out.join('\n');
    }

    // ============ 统计 ============
    function updateStats() {
        let add = 0, del = 0, mod = 0;
        pairs.forEach(p => {
            if (p.type === 'add') add += p.right.length;
            else if (p.type === 'del') del += p.left.length;
            else if (p.type === 'modify') mod += Math.max(p.left.length, p.right.length);
        });
        addCountEl.textContent = add;
        delCountEl.textContent = del;
        modCountEl.textContent = mod;
    }

    // ============ 主流程 ============
    function compare() {
        const leftText = leftInput.value;
        const rightText = rightInput.value;
        const a = splitLines(leftText);
        const b = splitLines(rightText);
        const ops = diffLines(a, b);
        pairs = groupOps(ops);
        computeLineNumbers(pairs);
        renderPc();
        renderMobile();
        renderResult();
        updateStats();
        diffSection.hidden = false;
        // 滚动到结果区
        diffSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function acceptAll(side) {
        pairs.forEach(p => {
            if (p.type === 'equal') return;
            const opts = optionsForPair(p);
            if (side === 'left') {
                // 优先 left，没有则 right
                p.choice = opts.includes('left') ? 'left' : 'right';
            } else {
                p.choice = 'right';
            }
        });
        pairs.forEach((_, idx) => updatePairControlState(idx));
        renderResult();
        showToast(side === 'left' ? '已全部采用左侧' : '已全部采用右侧');
    }

    // ============ 事件绑定 ============
    compareBtn.addEventListener('click', compare);

    // 委托：PC 左右 pane 的 pair-btn 点击
    function handlePairBtnClick(e) {
        const btn = e.target.closest('.pair-btn');
        if (!btn) return;
        const ctrl = btn.closest('.pair-control, .mobile-pair');
        if (!ctrl) return;
        const idx = parseInt(ctrl.dataset.idx, 10);
        if (isNaN(idx) || !pairs[idx]) return;
        pairs[idx].choice = btn.dataset.opt;
        updatePairControlState(idx);
        renderResult();
    }
    leftPaneBody.addEventListener('click', handlePairBtnClick);
    rightPaneBody.addEventListener('click', handlePairBtnClick);
    mobilePaneBody.addEventListener('click', handlePairBtnClick);

    clearBtn.addEventListener('click', () => {
        leftInput.value = '';
        rightInput.value = '';
        pairs = [];
        leftPaneBody.innerHTML = '';
        rightPaneBody.innerHTML = '';
        mobilePaneBody.innerHTML = '';
        resultOutput.textContent = '';
        diffSection.hidden = true;
    });

    swapBtn.addEventListener('click', () => {
        const tmp = leftInput.value;
        leftInput.value = rightInput.value;
        rightInput.value = tmp;
    });

    loadSampleBtn.addEventListener('click', () => {
        leftInput.value = [
            '春风又绿江南岸，',
            '明月何时照我还。',
            '这是第一段文本的第二行，',
            '内容相同，无变化。',
            '这一行将被删除。',
            '这一行将被修改成别的内容。',
            '结尾的相同行。'
        ].join('\n');
        rightInput.value = [
            '春风又绿江南岸，',
            '明月何时照我还。',
            '这是第一段文本的第二行，',
            '内容相同，无变化。',
            '这一行将被修改成全新的内容。',
            '这是新增的一行文本。',
            '结尾的相同行。'
        ].join('\n');
        compare();
    });

    toggleViewBtn.addEventListener('click', () => {
        document.body.classList.toggle('force-mobile');
        toggleViewBtn.classList.toggle('btn-primary');
    });

    // 手机 tab 切换
    document.querySelectorAll('.mobile-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            mobileSide = tab.dataset.side;
        });
    });

    acceptAllLeftBtn.addEventListener('click', () => acceptAll('left'));
    acceptAllRightBtn.addEventListener('click', () => acceptAll('right'));

    exportBtn.addEventListener('click', () => {
        const blob = new Blob([resultOutput.textContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'merged-result.txt';
        a.click();
        URL.revokeObjectURL(url);
        showToast('已导出 merged-result.txt');
    });

    copyResultBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(resultOutput.textContent);
            showToast('已复制到剪贴板');
        } catch (e) {
            // 降级方案
            const ta = document.createElement('textarea');
            ta.value = resultOutput.textContent;
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
                showToast('已复制到剪贴板');
            } catch (_) {
                showToast('复制失败，请手动选择');
            }
            document.body.removeChild(ta);
        }
    });

    // 快捷键：Ctrl+Enter 比对
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            compare();
        }
    });
})();
