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
    const fmtApplyBtn = $('fmtApplyBtn');
    const fmtCopyBtn = $('fmtCopyBtn');
    const fmtPreview = $('fmtPreview');

    // ============ 状态 ============
    let pairs = [];        // 比对结果对

    // ============ 工具函数 ============

    /**
     * 把文本切分为「句子」单元（用于中文作文级 diff）
     * 规则：以中文句末标点（。！？）及换行作为切分点，保留标点与缩进。
     * 空行保留为独立的段落分隔单元。
     */
    function splitSentences(text) {
        if (text === '') return [];
        const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (normalized === '') return [];
        // 用正则切分：保留分隔符。分隔符 = 句末标点（含多个）或 换行
        // 例：'你好。世界！' -> ['你好', '。', '世界', '！', '']
        const parts = normalized.split(/([。！？\n]+)/);
        const tokens = [];
        let buf = '';
        for (let k = 0; k < parts.length; k++) {
            const part = parts[k];
            if (part === '') continue;
            if (/^[。！？\n]+$/.test(part)) {
                // 分隔符：合并到当前 buffer 末尾作为一个句子
                buf += part;
                tokens.push(buf);
                buf = '';
            } else {
                buf += part;
            }
        }
        if (buf !== '') tokens.push(buf);
        // 合并纯换行的 token：连续换行保留为段落分隔（一个 '\n' token）
        // 但为了行号与对齐，单独的换行 token 也参与 diff
        return tokens;
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

    // ============ 通用 LCS diff（对任意 token 数组）============
    /**
     * 通用 LCS diff，a、b 为任意字符串数组（行/句子/词）。
     * @returns {Array<{type:'equal'|'del'|'add', value:string}>}
     */
    function diffTokens(a, b) {
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

    // ============ 字符级 inline diff（用于修改句子的精细高亮）============
    /**
     * 对两个字符串做字符级 LCS，返回左右两侧的 HTML：
     *   - 左侧：a 中与 b 不匹配的字符包 <span class="cd-del">
     *   - 右侧：b 中与 a 不匹配的字符包 <span class="cd-ins">
     * 这样在 VSCode 风格下能看到具体改了哪几个字。
     * @returns {{leftHtml:string, rightHtml:string}}
     */
    function charDiff(a, b) {
        const A = Array.from(a);   // 支持 Unicode（含中文）按码点切分
        const B = Array.from(b);
        const m = A.length, n = B.length;
        // 性能：超长串降级为整体着色
        if (m > 400 || n > 400) {
            return { leftHtml: '<span class="cd-del">' + escapeHtml(a) + '</span>',
                     rightHtml: '<span class="cd-ins">' + escapeHtml(b) + '</span>' };
        }
        const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
        for (let i = m - 1; i >= 0; i--) {
            for (let j = n - 1; j >= 0; j--) {
                if (A[i] === B[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
                else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        // 回溯：标记 a 中字符是 eq/del，b 中字符是 eq/ins
        const aMarks = new Array(m).fill('eq');
        const bMarks = new Array(n).fill('eq');
        let i = 0, j = 0;
        while (i < m && j < n) {
            if (A[i] === B[j]) { i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) { aMarks[i] = 'del'; i++; }
            else { bMarks[j] = 'ins'; j++; }
        }
        while (i < m) { aMarks[i] = 'del'; i++; }
        while (j < n) { bMarks[j] = 'ins'; j++; }

        // 生成 HTML，合并连续同类标记减少标签数
        function build(str, marks, cls) {
            let html = '', cur = null, buf = '';
            const flush = () => {
                if (buf === '') return;
                if (cur === 'eq') html += escapeHtml(buf);
                else html += '<span class="' + cls + '">' + escapeHtml(buf) + '</span>';
                buf = '';
            };
            for (let k = 0; k < str.length; k++) {
                if (marks[k] !== cur) { flush(); cur = marks[k]; }
                buf += str[k];
            }
            flush();
            return html;
        }
        return { leftHtml: build(a, aMarks, 'cd-del'), rightHtml: build(b, bMarks, 'cd-ins') };
    }

    // 为 modify 句子对生成整句高亮 HTML（修订模式）
    // 左侧整句删除线，右侧整句下划线
    function pairInlineHtml(leftArr, rightArr) {
        const max = Math.max(leftArr.length, rightArr.length);
        const leftHtmls = [], rightHtmls = [];
        for (let k = 0; k < max; k++) {
            const l = leftArr[k], r = rightArr[k];
            if (l !== undefined && r !== undefined) {
                // 整句标记为不同版本
                leftHtmls.push('<span class="cd-del">' + escapeHtml(l) + '</span>');
                rightHtmls.push('<span class="cd-ins">' + escapeHtml(r) + '</span>');
            } else if (l !== undefined) {
                leftHtmls.push('<span class="cd-del">' + escapeHtml(l) + '</span>');
            } else {
                rightHtmls.push('<span class="cd-ins">' + escapeHtml(r) + '</span>');
            }
        }
        return { leftHtmls, rightHtmls };
    }

    // 旧名兼容
    function diffLines(a, b) { return diffTokens(a, b); }

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
            const maxRows = Math.max(p.left.length, p.right.length, 1);
            const pairEl = document.createElement('div');
            pairEl.className = 'diff-pair';
            pairEl.dataset.idx = idx;

            for (let r = 0; r < maxRows; r++) {
                const lRow = makeRow({
                    sign: p.left[r] !== undefined ? leftSign(p) : '',
                    content: p.left[r] !== undefined ? p.left[r] : '',
                    html: (p.type === 'modify' && p.leftHtmls) ? p.leftHtmls[r] : undefined,
                    no: p.leftNos[r] || '',
                    rowClass: p.left[r] !== undefined ? leftRowClass(p) : 'row-empty',
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
                    html: (p.type === 'modify' && p.rightHtmls) ? p.rightHtmls[r] : undefined,
                    no: p.rightNos[r] || '',
                    rowClass: p.right[r] !== undefined ? rightRowClass(p) : 'row-empty',
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
    // 左侧专用行样式：modify 在左侧表现为删除色
    function leftRowClass(p) {
        if (p.type === 'equal') return 'row-equal';
        if (p.type === 'modify' || p.type === 'del') return 'row-del';
        return 'row-equal';
    }
    // 右侧专用行样式：modify 在右侧表现为新增色
    function rightRowClass(p) {
        if (p.type === 'equal') return 'row-equal';
        if (p.type === 'modify' || p.type === 'add') return 'row-add';
        return 'row-equal';
    }

    function makeRow({ sign, content, html, no, rowClass, empty }) {
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
        if (empty) {
            contentEl.innerHTML = '&nbsp;';
        } else if (html !== undefined) {
            // 信任预生成的 inline HTML（已转义）
            contentEl.innerHTML = html;
        } else {
            contentEl.textContent = content;
        }
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

            p.left.forEach((line, r) => {
                const row = makeRow({
                    sign: '-',
                    content: line,
                    html: (p.type === 'modify' && p.leftHtmls) ? p.leftHtmls[r] : undefined,
                    no: p.leftNos[r] || '',
                    rowClass: leftRowClass(p),
                    empty: false
                });
                card.appendChild(row);
            });
            p.right.forEach((line, r) => {
                const row = makeRow({
                    sign: '+',
                    content: line,
                    html: (p.type === 'modify' && p.rightHtmls) ? p.rightHtmls[r] : undefined,
                    no: p.rightNos[r] || '',
                    rowClass: rightRowClass(p),
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
        // 用句子级切分做对齐（中文作文友好）
        const a = splitSentences(leftText);
        const b = splitSentences(rightText);
        const ops = diffTokens(a, b);
        pairs = groupOps(ops);
        computeLineNumbers(pairs);
        // 为 modify 对预计算字符级 inline 高亮 HTML
        pairs.forEach(p => {
            if (p.type === 'modify') {
                const h = pairInlineHtml(p.left, p.right);
                p.leftHtmls = h.leftHtmls;
                p.rightHtmls = h.rightHtmls;
            }
        });
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

    // ============ 作文排版 ============
    /**
     * 将文本按段落整理为作文格式
     * 规则：
     *   - 段落由空行分隔；若无空行，则每行视为独立段落
     *   - 段首缩进指定字符数
     *   - 可选：合并多余空行、中文标点修正
     */
    function formatEssay(text, opts) {
        if (!text) return [];
        // 规范换行
        let lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

        // 中文标点修正：英文标点 -> 中文全角标点（仅在中文语境）
        if (opts.fullPunct) {
            lines = lines.map(line => fixPunctuation(line));
        }

        // 按空行分段；若无空行，则每非空行作为一段
        let paragraphs = [];
        let buf = [];
        const flush = () => {
            if (buf.length) {
                // 合并同一段内的换行为一句连续文本，去除行首尾空白
                paragraphs.push(buf.join('').trim());
                buf = [];
            }
        };
        let hasBlank = lines.some(l => l.trim() === '');
        if (hasBlank) {
            lines.forEach(l => {
                if (l.trim() === '') flush();
                else buf.push(l.trim());
            });
            flush();
        } else {
            lines.forEach(l => {
                if (l.trim() !== '') paragraphs.push(l.trim());
            });
        }

        // 去除多余空段
        paragraphs = paragraphs.filter(p => p.length > 0);

        // 应用缩进
        if (opts.indent > 0) {
            const indent = '\u3000'.repeat(opts.indent); // 全角空格
            paragraphs = paragraphs.map(p => indent + p);
        }

        return paragraphs;
    }

    // 中文标点修正
    function fixPunctuation(line) {
        // 常见英文标点转中文全角（保留英文片段内的标点不动较复杂，这里做基础替换）
        const map = [
            [/,/g, '，'],
            [/\./g, '。'],
            [/!/g, '！'],
            [/\?/g, '？'],
            [/;/g, '；'],
            [/:/g, '：'],
            [/\(/g, '（'],
            [/\)/g, '）'],
            [/\[/g, '【'],
            [/\]/g, '】'],
        ];
        let result = line;
        // 仅对中文字符相邻的标点做替换，避免误伤英文数字小数点等
        // 简化处理：若该行含中文字符，则做替换；但对小数点（数字.数字）保留
        if (/[\u4e00-\u9fa5]/.test(result)) {
            // 保护数字小数与英文缩写中的点
            const decimals = [];
            result = result.replace(/(\d)\.(\d)/g, (m) => {
                decimals.push(m);
                return `\u0000${decimals.length - 1}\u0000`;
            });
            map.forEach(([re, ch]) => {
                if (ch === '。') {
                    // 句号：仅替换末尾或中文后的点
                    result = result.replace(/([\u4e00-\u9fa5])\./g, '$1。');
                    result = result.replace(/\.$/, '。');
                } else {
                    result = result.replace(re, (m, off) => {
                        // 替换前后是中文/全角则替换，否则保留
                        const before = result[off - 1] || '';
                        const after = result[off + 1] || '';
                        if (/[\u4e00-\u9fa5]/.test(before) || /[\u4e00-\u9fa5]/.test(after)) return ch;
                        return m;
                    });
                }
            });
            // 还原小数点
            result = result.replace(/\u0000(\d+)\u0000/g, (m, i) => decimals[+i]);
        }
        return result;
    }

    function applyFormat() {
        const src = resultOutput.textContent || '';
        if (!src.trim()) {
            showToast('请先进行比对，生成合并结果');
            return;
        }
        const opts = {
            fontSize: parseInt($('fmtFontSize').value, 10) || 16,
            lineHeight: parseFloat($('fmtLineHeight').value) || 1.75,
            paraGap: parseInt($('fmtParaGap').value, 10) || 0,
            indent: parseInt($('fmtIndent').value, 10) || 0,
            trim: $('fmtTrim').checked,
            fullPunct: $('fmtFullPunct').checked,
            align: $('fmtAlign').checked
        };
        let paragraphs = formatEssay(src, opts);
        if (opts.trim) {
            // 已在 formatEssay 中过滤空段
        }

        // 渲染预览
        fmtPreview.innerHTML = '';
        fmtPreview.classList.toggle('fmt-empty', paragraphs.length === 0);
        fmtPreview.style.fontSize = opts.fontSize + 'px';
        fmtPreview.style.lineHeight = String(opts.lineHeight);
        fmtPreview.style.textAlign = opts.align ? 'justify' : 'left';
        paragraphs.forEach(p => {
            const div = document.createElement('p');
            div.className = 'fmt-para';
            div.style.marginBottom = opts.paraGap + 'px';
            div.textContent = p;
            fmtPreview.appendChild(div);
        });
        fmtPreview._paragraphs = paragraphs;
        showToast('已应用排版');
    }

    function copyFormatted() {
        const paras = fmtPreview._paragraphs;
        if (!paras || !paras.length) {
            showToast('请先点击「应用排版」');
            return;
        }
        const text = paras.join('\n\n');
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            showToast('已复制排版文本');
        } catch (_) {
            showToast('复制失败，请手动选择');
        }
        document.body.removeChild(ta);
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

    // 作文格式预设（含段首全角空格缩进、段落空行）
    const SAMPLE_LEFT =
        '　　春天来了，万物复苏。小草从泥土里探出了头，好奇地张望着这个世界。桃花开了，粉红的花瓣在微风中轻轻摇曳。\n' +
        '　　我和小伙伴们来到郊外踏青。我们在草地上放风筝，风筝飞得很高很高。远处传来小鸟的歌声，清脆悦耳。这是一个美好的下午。';

    const SAMPLE_RIGHT =
        '　　春天到了，万物复苏。小草从泥土里钻了出来，好奇地打量着这个世界。桃花开了，粉红色的花瓣在微风中轻轻摇曳。\n' +
        '　　我和小伙伴们来到郊外踏青。我们在草地上放飞风筝，风筝飞得又高又远。远处传来小鸟欢快的歌声，清脆悦耳。真是一个美好的下午！';

    loadSampleBtn.addEventListener('click', () => {
        leftInput.value = SAMPLE_LEFT;
        rightInput.value = SAMPLE_RIGHT;
        compare();
    });

    // 页面载入时预填作文示例，便于直接比对
    leftInput.value = SAMPLE_LEFT;
    rightInput.value = SAMPLE_RIGHT;

    toggleViewBtn.addEventListener('click', () => {
        document.body.classList.toggle('force-mobile');
        toggleViewBtn.classList.toggle('btn-primary');
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

    // 作文排版
    fmtApplyBtn.addEventListener('click', applyFormat);
    fmtCopyBtn.addEventListener('click', copyFormatted);

    // 页面载入后自动比对一次预设作文
    compare();
})();
