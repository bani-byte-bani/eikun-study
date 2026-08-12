/* 共通クイズ採点エンジン
   各クイズページは questions 配列 (num, hyoka, check, answer, hint, trivia) を定義し、
   initQuiz(questions) を呼び出すだけで採点・進捗・結果パネル・成績の保存が動作する。

   成績は localStorage に保存し、使えない環境では Cookie にフォールバックする。
   Cookie は容量が小さい(約4KB)ため、その場合は点数の要約のみを保存する。 */

function qNormalize(s) {
  if (s == null) return '';
  return String(s)
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[－―ー]/g, '-')
    .replace(/[×]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/[、，]/g, ',')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/* raw が accepted (文字列の配列) のいずれかと一致するか */
function qAccept(raw, accepted) {
  const n = qNormalize(raw);
  if (n === '') return false;
  return accepted.some(a => qNormalize(a) === n);
}

/* raw をカンマ区切りにして「順不同の集合」として accepted (配列の配列) と比較 */
function qAcceptSet(raw, accepted) {
  const n = qNormalize(raw);
  if (n === '') return false;
  const parts = n.split(',').filter(x => x !== '').sort();
  const key = parts.join(',');
  return accepted.some(setArr => {
    const s = setArr.map(x => qNormalize(x)).filter(x => x !== '').sort().join(',');
    return s === key;
  });
}

/* raw をカンマ区切りにして「順序どおりの並び」として accepted (配列の配列) と比較 */
function qAcceptOrdered(raw, accepted) {
  const n = qNormalize(raw);
  if (n === '') return false;
  const parts = n.split(',').filter(x => x !== '');
  const key = parts.join(',');
  return accepted.some(seq => seq.map(x => qNormalize(x)).join(',') === key);
}

const HYOKA_LABEL = { chi: '知識・技能', shi: '思考・判断・表現', tai: '主体的に学習に取り組む態度' };

/* ===================== 成績の保存 ===================== */

const STORE_KEY = 'eikun-study-records';
const COOKIE_KEY = 'eikun_study_records';
const COOKIE_DAYS = 180;

/* このページのクイズを識別するキー（ファイル名） */
function quizId() {
  const name = (location.pathname.split('/').pop() || '').trim();
  return decodeURIComponent(name) || 'quiz';
}

function readCookie(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + escaped + '=([^;]*)'));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (e) { return null; }
}

function writeCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 86400000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
}

/* localStorage が実際に読み書きできるかを確かめる（プライベートモード等で例外になる） */
function localStorageOrNull() {
  try {
    const probe = '__eikun_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch (e) {
    return null;
  }
}

const StudyRecords = {
  /* 保存されている全記録を { quizId: {score,total,at,best,answers} } の形で返す */
  readAll() {
    const ls = localStorageOrNull();
    let raw = ls ? ls.getItem(STORE_KEY) : null;
    if (raw == null) raw = readCookie(COOKIE_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
      return {};
    }
  },

  writeAll(all) {
    const ls = localStorageOrNull();
    if (ls) {
      try {
        ls.setItem(STORE_KEY, JSON.stringify(all));
        return true;
      } catch (e) {
        /* 容量超過などの場合は Cookie へフォールバックする */
      }
    }
    // Cookie は容量が小さいので、回答内容を除いた要約だけを保存する
    const slim = {};
    Object.keys(all).forEach(id => {
      const r = all[id] || {};
      slim[id] = { score: r.score, total: r.total, at: r.at, best: r.best };
    });
    try {
      writeCookie(COOKIE_KEY, JSON.stringify(slim), COOKIE_DAYS);
      return true;
    } catch (e) {
      return false;
    }
  },

  get(id) { return this.readAll()[id] || null; },

  /* 記録の一部を更新する。patch は既存の記録にマージされる */
  update(id, patch) {
    const all = this.readAll();
    all[id] = Object.assign({}, all[id], patch);
    this.writeAll(all);
    return all[id];
  },

  remove(id) {
    const all = this.readAll();
    delete all[id];
    this.writeAll(all);
  },

  clearAll() {
    const ls = localStorageOrNull();
    if (ls) { try { ls.removeItem(STORE_KEY); } catch (e) { /* 無視 */ } }
    writeCookie(COOKIE_KEY, '', -1);
  },
};

/* 2026/07/25 14:03 の形式に整える */
function formatStamp(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ハブページ（index.html）で、各問題集カードに保存済みの成績を表示する */
function renderHubRecords() {
  const all = StudyRecords.readAll();
  let hasAny = false;

  document.querySelectorAll('a.set-card').forEach(card => {
    const id = decodeURIComponent((card.getAttribute('href') || '').split('/').pop() || '');
    const rec = all[id];
    let box = card.querySelector('.set-record');
    if (!rec || typeof rec.score !== 'number') {
      if (box) box.remove();
      return;
    }
    hasAny = true;
    if (!box) {
      box = document.createElement('div');
      box.className = 'set-record';
      const cta = card.querySelector('.set-cta');
      card.insertBefore(box, cta);
    }
    const pct = rec.total ? Math.round(rec.score / rec.total * 100) : 0;
    const best = (typeof rec.best === 'number' && rec.best !== rec.score)
      ? `<span class="set-record-best">最高 ${rec.best} / ${rec.total}</span>` : '';
    box.innerHTML =
      `<span class="set-record-label">前回</span>` +
      `<span class="set-record-score">${rec.score} / ${rec.total}</span>` +
      `<span class="set-record-pct">${pct}%</span>` +
      best +
      (rec.at ? `<span class="set-record-at">${formatStamp(rec.at)}</span>` : '');
  });

  const empty = document.getElementById('hub-record-empty');
  if (empty) empty.style.display = hasAny ? 'none' : '';
  const clearBtn = document.getElementById('hub-clear-btn');
  if (clearBtn) clearBtn.style.display = hasAny ? '' : 'none';
}

/* ハブページの「学習記録をすべて消去」ボタン */
function clearAllRecords() {
  if (!window.confirm('保存されているすべての成績を消去します。よろしいですか？')) return;
  StudyRecords.clearAll();
  renderHubRecords();
}

/* ===================== 印刷（紙のプリント） ===================== */

/* 画面のヘッダーから、印刷用の見出しに使う文字列を取り出す */
function printHeadInfo() {
  const h1 = document.querySelector('header h1');
  let title = '練習問題';
  let sub = '';
  if (h1) {
    const small = h1.querySelector('small');
    sub = small ? small.textContent.trim() : '';
    const clone = h1.cloneNode(true);
    const smallClone = clone.querySelector('small');
    if (smallClone) smallClone.remove();
    title = clone.textContent.trim();
  }
  const eyebrowEl = document.querySelector('.header-eyebrow');
  return {
    title: title,
    sub: sub,
    eyebrow: eyebrowEl ? eyebrowEl.textContent.trim() : '',
  };
}

/* 問題文などに使われている HTML をそのまま印刷面に持っていく */
function innerHtmlOf(scope, selector) {
  const found = scope.querySelector(selector);
  return found ? found.innerHTML : '';
}

/* テキストとして安全に埋め込む */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* 印刷用のシートを組み立てて #print-sheet に流し込む。
   mode: 'questions'（問題用紙）／'answers'（解答・解説）／'both'（問題＋解答解説） */
function buildPrintSheet(questions, mode) {
  let sheet = document.getElementById('print-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'print-sheet';
    document.body.appendChild(sheet);
  }

  const byNum = {};
  (questions || []).forEach(q => { byNum[q.num] = q; });
  const total = (questions || []).length;
  const head = printHeadInfo();

  const wantQuestions = (mode === 'questions' || mode === 'both');
  const wantAnswers = (mode === 'answers' || mode === 'both');

  const parts = [];

  function pushHeader(label, withNameRow) {
    parts.push('<div class="print-page">');
    parts.push('<div class="print-head">');
    if (head.eyebrow) parts.push(`<div class="print-eyebrow">${escapeHtml(head.eyebrow)}</div>`);
    parts.push(`<h1 class="print-title">${escapeHtml(head.title)}<span class="print-kind">${escapeHtml(label)}</span></h1>`);
    if (head.sub) parts.push(`<div class="print-sub">${escapeHtml(head.sub)}</div>`);
    if (withNameRow) {
      parts.push(
        '<div class="print-nameline">' +
        '<span class="print-field print-field-name">名前</span>' +
        '<span class="print-field print-field-date">日付</span>' +
        `<span class="print-field print-field-score">得点<em>／ ${total}</em></span>` +
        '</div>'
      );
    }
    parts.push('</div>');
  }

  /* main の中の見出しと問題カードを、画面と同じ順番でたどる */
  function pushBody(showAnswers) {
    const nodes = document.querySelectorAll('main > .sec-head, main > .q-card');
    nodes.forEach(node => {
      if (node.classList.contains('sec-head')) {
        const label = (node.querySelector('.sec-label') || {}).textContent || '';
        const title = (node.querySelector('.sec-title') || {}).textContent || '';
        parts.push(
          `<div class="print-sec"><span class="print-sec-label">${escapeHtml(label.trim())}</span>` +
          `<span class="print-sec-title">${escapeHtml(title.trim())}</span></div>`
        );
        return;
      }

      const num = parseInt(String(node.id).replace(/^qc/, ''), 10);
      const q = byNum[num];
      const numText = (node.querySelector('.q-num') || {}).textContent || ('Q' + num);
      const diff = (node.querySelector('.diff-tag') || {}).textContent || '';
      const qtext = innerHtmlOf(node, '.q-text');

      parts.push('<div class="print-q">');
      parts.push(
        `<div class="print-q-head"><span class="print-qnum">${escapeHtml(numText.trim())}</span>` +
        `<div class="print-qtext">${qtext}</div>` +
        (diff ? `<span class="print-diff">${escapeHtml(diff.trim())}</span>` : '') +
        '</div>'
      );

      if (showAnswers) {
        if (q) {
          parts.push(`<div class="print-a"><span class="print-a-label">答え</span>${escapeHtml(q.answer)}</div>`);
          if (q.hint) parts.push(`<div class="print-h"><span class="print-h-label">解説</span>${escapeHtml(q.hint)}</div>`);
          if (q.trivia) parts.push(`<div class="print-t"><span class="print-t-label">雑学</span>${escapeHtml(q.trivia)}</div>`);
        }
      } else {
        parts.push('<div class="print-ansline"><span class="print-ansline-label">答え</span><span class="print-rule"></span></div>');
      }
      parts.push('</div>');
    });
  }

  if (wantQuestions) {
    pushHeader('問題', true);
    pushBody(false);
    parts.push('</div>');
  }
  if (wantAnswers) {
    pushHeader('解答と解説', false);
    pushBody(true);
    parts.push('</div>');
  }

  sheet.innerHTML = parts.join('');
  return sheet;
}

/* 印刷モードを切り替えて印刷ダイアログを開く */
function printSheet(questions, mode) {
  buildPrintSheet(questions, mode);
  window.print();
}

function initQuiz(questions) {
  const total = questions.length;
  const id = quizId();

  function el(prefix, num) { return document.getElementById(prefix + num); }

  function updateProgress() {
    let answered = 0;
    questions.forEach(q => { if (el('q', q.num).value.trim() !== '') answered++; });
    const label = document.getElementById('prog-label');
    const inner = document.getElementById('prog-inner');
    if (label) label.textContent = answered === total ? '全問回答済み' : `未回答: ${total - answered}問`;
    if (inner) inner.style.width = (answered / total * 100) + '%';
  }

  /* 現在の入力内容を { 問題番号: 回答 } の形で取り出す */
  function collectAnswers() {
    const answers = {};
    questions.forEach(q => {
      const v = el('q', q.num).value;
      if (v.trim() !== '') answers[q.num] = v;
    });
    return answers;
  }

  /* 入力の途中経過を保存する（採点前でも次回そのまま再開できる） */
  let saveTimer = null;
  function saveDraftSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      StudyRecords.update(id, { answers: collectAnswers(), total: total });
      renderRecordBar();
    }, 600);
  }

  /* スコアバーに前回・最高得点を表示する */
  function renderRecordBar() {
    const box = document.getElementById('score-record');
    if (!box) return;
    const rec = StudyRecords.get(id);
    if (!rec || typeof rec.score !== 'number') {
      box.innerHTML = '<span class="score-record-none">記録なし</span>';
      return;
    }
    const best = (typeof rec.best === 'number') ? `<b>最高</b> ${rec.best} / ${rec.total}` : '';
    box.innerHTML =
      `<span><b>前回</b> ${rec.score} / ${rec.total}</span>` +
      (best ? `<span>${best}</span>` : '') +
      (rec.at ? `<span class="score-record-at">${formatStamp(rec.at)}</span>` : '');
  }

  /* 保存されている回答を画面に復元する */
  function restoreAnswers() {
    const rec = StudyRecords.get(id);
    if (!rec || !rec.answers) return 0;
    let restored = 0;
    questions.forEach(q => {
      const saved = rec.answers[q.num];
      if (typeof saved === 'string' && saved !== '') {
        el('q', q.num).value = saved;
        restored++;
      }
    });
    return restored;
  }

  questions.forEach((q, i) => {
    const input = el('q', q.num);
    input.addEventListener('input', () => { updateProgress(); saveDraftSoon(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = questions[i + 1];
        if (next) el('q', next.num).focus();
        else checkAll();
      }
    });
  });

  restoreAnswers();
  updateProgress();
  renderRecordBar();

  // ブラウザの印刷（Ctrl+P）でも紙向けの問題用紙が出るよう、あらかじめ組んでおく
  buildPrintSheet(questions, 'questions');

  window.printQuestions = () => printSheet(questions, 'questions');
  window.printAnswers   = () => printSheet(questions, 'answers');
  window.printBoth      = () => printSheet(questions, 'both');

  window.checkAll = function () {
    let correct = 0;
    const hyokaCorrect = { chi: 0, shi: 0, tai: 0 };
    const hyokaTotal = { chi: 0, shi: 0, tai: 0 };

    questions.forEach(q => {
      hyokaTotal[q.hyoka]++;
      const input = el('q', q.num);
      const card = el('qc', q.num);
      const fb = el('fb', q.num);
      const ok = q.check(input.value);

      card.classList.remove('correct', 'wrong');
      input.classList.remove('ok', 'ng');
      fb.classList.remove('ok-fb', 'ng-fb');

      const badge = `<div class="fb-eval"><b class="${q.hyoka}-b">${HYOKA_LABEL[q.hyoka]}</b></div>`;
      // 解説と雑学は正解・不正解にかかわらず表示する
      const kaisetsu = q.hint ? `<div class="fb-hint"><span class="fb-hint-label">解説</span>${q.hint}</div>` : '';
      const zatsugaku = q.trivia ? `<div class="fb-trivia"><span class="fb-trivia-label">雑学</span>${q.trivia}</div>` : '';

      if (ok) {
        correct++;
        hyokaCorrect[q.hyoka]++;
        card.classList.add('correct');
        input.classList.add('ok');
        fb.classList.add('ok-fb');
        fb.innerHTML = `<div class="fb-label" style="color:var(--correct)">正解！</div><div class="fb-ans">答え：${q.answer}</div>${kaisetsu}${zatsugaku}${badge}`;
      } else {
        card.classList.add('wrong');
        input.classList.add('ng');
        fb.classList.add('ng-fb');
        fb.innerHTML = `<div class="fb-label" style="color:var(--wrong)">不正解</div><div class="fb-ans">正答例：${q.answer}</div>${kaisetsu}${zatsugaku}${badge}`;
      }
      fb.classList.add('show');
    });

    const scoreDisp = document.getElementById('score-disp');
    if (scoreDisp) scoreDisp.innerHTML = `${correct} <small>/ ${total}</small>`;
    updateProgress();

    // 採点結果を保存する。最高得点はこれまでの記録と比べて更新する
    clearTimeout(saveTimer);
    const prev = StudyRecords.get(id);
    const prevBest = (prev && typeof prev.best === 'number') ? prev.best : -1;
    StudyRecords.update(id, {
      score: correct,
      total: total,
      best: Math.max(correct, prevBest),
      at: new Date().toISOString(),
      answers: collectAnswers(),
    });
    renderRecordBar();

    showResult(correct, hyokaCorrect, hyokaTotal);
  };

  window.resetAll = function () {
    questions.forEach(q => {
      const input = el('q', q.num);
      const card = el('qc', q.num);
      const fb = el('fb', q.num);
      input.value = '';
      input.classList.remove('ok', 'ng');
      card.classList.remove('correct', 'wrong');
      fb.classList.remove('show', 'ok-fb', 'ng-fb');
      fb.innerHTML = '';
    });
    const scoreDisp = document.getElementById('score-disp');
    if (scoreDisp) scoreDisp.innerHTML = `0 <small>/ ${total}</small>`;
    const panel = document.getElementById('result-panel');
    if (panel) panel.classList.remove('show');

    // 画面上の解答は消すが、点数の記録（前回・最高）は残す
    clearTimeout(saveTimer);
    StudyRecords.update(id, { answers: {} });

    updateProgress();
    renderRecordBar();
    el('q', questions[0].num).focus();
  };

  /* この問題集の記録（回答・点数・最高得点）をすべて消去する */
  window.clearRecord = function () {
    if (!window.confirm('この問題集の成績と解答の記録を消去します。よろしいですか？')) return;
    window.resetAll();          // 先に画面を初期化する（この中で下書きが保存される）
    clearTimeout(saveTimer);
    StudyRecords.remove(id);    // そのうえで記録そのものを削除する
    renderRecordBar();
  };

  function showResult(correct, hyokaCorrect, hyokaTotal) {
    const panel = document.getElementById('result-panel');
    if (!panel) return;
    const pct = total > 0 ? Math.round(correct / total * 100) : 0;
    let comment;
    if (pct >= 90) comment = '素晴らしい！この調子で応用問題にも挑戦しよう。';
    else if (pct >= 70) comment = 'よくできました。間違えた問題を復習しよう。';
    else if (pct >= 50) comment = '基礎は身についています。苦手な単元を重点的に復習しよう。';
    else comment = '教科書に戻って、基本からもう一度確認しよう。';

    const scoreEl = document.getElementById('result-score');
    if (scoreEl) scoreEl.innerHTML = `${correct}<em> / ${total}</em>`;
    const commentEl = document.getElementById('result-comment');
    if (commentEl) commentEl.textContent = comment;
    const breakdownEl = document.getElementById('result-breakdown');
    if (breakdownEl) {
      breakdownEl.innerHTML = ['chi', 'shi', 'tai']
        .filter(k => hyokaTotal[k] > 0)
        .map(k => `<span><b>${hyokaCorrect[k]}/${hyokaTotal[k]}</b>${HYOKA_LABEL[k]}</span>`)
        .join('');
    }
    panel.classList.add('show');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
