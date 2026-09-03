/* 共通クイズ採点エンジン

   各クイズページは questions 配列を定義し、initQuiz(questions, sections) を
   呼び出すだけで、描画・採点・進捗・結果パネル・成績の保存・印刷が動作する。

   questions の各要素:
     num      … 通し番号（要素IDと保存キーに使う安定した識別子）
     sec      … 所属セクションのラベル（'A' など）※データ描画方式のときのみ
     pri      … 優先度 1=必修 / 2=標準 / 3=発展（省略時は1）
     hyoka    … 'chi' | 'shi' | 'tai'
     diff     … 'B' | 'A' | 'S'（★の数）※データ描画方式のときのみ
     text     … 問題文のHTML ※データ描画方式のときのみ
     answer   … 正答例（画面と解答用紙に表示する）
     hint     … 解説
     trivia   … 雑学
     check    … 入力を受け取り正誤を返す関数

   sections を渡すと <main id="quiz-main"> に問題カードを描画する。
   sections を渡さない場合は、HTMLに直接書かれた .q-card をそのまま使う。

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
const HYOKA_SHORT = { chi: '知', shi: '思', tai: '態' };
const DIFF_STARS = { B: '★☆☆', A: '★★☆', S: '★★★' };

/* 問題量の3段階。優先度が maxPri 以下の問題だけを出題する */
const VOLUMES = [
  { key: 'normal', label: 'ふつう',   maxPri: 1, note: '必修だけ' },
  { key: 'solid',  label: 'しっかり', maxPri: 2, note: '必修＋標準' },
  { key: 'hard',   label: 'ガリ勉',   maxPri: 3, note: '発展まで全部' },
];
const DEFAULT_VOLUME = 'normal';

function volumeByKey(key) {
  return VOLUMES.find(v => v.key === key) || VOLUMES[0];
}

/* ===================== 成績の保存 ===================== */

const STORE_KEY = 'eikun-study-records';
const COOKIE_KEY = 'eikun_study_records';
const COOKIE_DAYS = 180;
const SETTINGS_KEY = '__settings';

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
  /* 保存されている全記録を { quizId: {score,total,at,best,volume,answers} } の形で返す */
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
      if (id === SETTINGS_KEY) { slim[id] = all[id]; return; }
      const r = all[id] || {};
      slim[id] = { score: r.score, total: r.total, at: r.at, best: r.best, volume: r.volume };
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

  /* 問題量の設定は問題集をまたいで共通で持つ */
  getSetting(key, fallback) {
    const s = this.readAll()[SETTINGS_KEY];
    return (s && s[key] !== undefined) ? s[key] : fallback;
  },

  setSetting(key, value) {
    const all = this.readAll();
    all[SETTINGS_KEY] = Object.assign({}, all[SETTINGS_KEY], { [key]: value });
    this.writeAll(all);
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
    const vol = rec.volume ? `<span class="set-record-vol">${escapeHtml(volumeByKey(rec.volume).label)}</span>` : '';
    box.innerHTML =
      `<span class="set-record-label">前回</span>` +
      `<span class="set-record-score">${rec.score} / ${rec.total}</span>` +
      `<span class="set-record-pct">${pct}%</span>` +
      vol +
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

/* ===================== 問題カードの描画 ===================== */

/* テキストとして安全に埋め込む */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function sectionHtml(sec) {
  const tags = (sec.hyoka || [])
    .map(k => `<span class="${k}-tag">${HYOKA_LABEL[k]}</span>`)
    .join('\n    ');
  return `<div class="sec-head" data-sec="${escapeAttr(sec.label)}">
  <span class="sec-label">${escapeHtml(sec.label)}</span>
  <span class="sec-title">${escapeHtml(sec.title)}</span>
  ${tags ? `<span class="sec-hyoka">${tags}</span>` : ''}
</div>`;
}

function cardHtml(q) {
  const stars = DIFF_STARS[q.diff] || DIFF_STARS.A;
  const diffCls = 'diff-' + (DIFF_STARS[q.diff] ? q.diff : 'A');
  const wide = q.wide ? ' wide' : '';
  const ph = q.placeholder ? ` placeholder="${escapeAttr(q.placeholder)}"` : '';
  return `<div class="q-card" id="qc${q.num}" data-pri="${q.pri || 1}" data-sec="${escapeAttr(q.sec || '')}">
  <div class="q-header">
    <span class="q-num">Q${String(q.num).padStart(2, '0')}</span>
    <div class="q-text">${q.text}</div>
    <span class="diff-tag ${diffCls}">${stars}</span>
    <span class="q-hyoka-badge ${q.hyoka}-tag">${HYOKA_SHORT[q.hyoka] || ''}</span>
  </div>
  <div class="q-input-row"><label>答え：</label><input class="ans-input${wide}" id="q${q.num}" type="text"${ph}></div>
  <div class="q-feedback" id="fb${q.num}"></div>
</div>`;
}

/* sections の順にセクション見出しと問題カードを #quiz-main へ描画する */
function renderQuiz(sections, questions) {
  const main = document.getElementById('quiz-main');
  if (!main || !Array.isArray(sections) || sections.length === 0) return false;

  const bySec = {};
  questions.forEach(q => { (bySec[q.sec] = bySec[q.sec] || []).push(q); });

  const parts = [];
  sections.forEach(sec => {
    parts.push(sectionHtml(sec));
    (bySec[sec.label] || []).forEach(q => parts.push(cardHtml(q)));
  });
  main.insertAdjacentHTML('afterbegin', parts.join('\n'));
  return true;
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

/* 印刷用のシートを組み立てて #print-sheet に流し込む。
   mode: 'questions'（問題用紙）／'answers'（解答・解説）／'both'（問題＋解答解説）
   出題中でない（問題量の設定で隠れている）問題は紙にも出さない。 */
function buildPrintSheet(questions, mode, volumeKey) {
  let sheet = document.getElementById('print-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'print-sheet';
    document.body.appendChild(sheet);
  }

  const byNum = {};
  (questions || []).forEach(q => { byNum[q.num] = q; });
  const head = printHeadInfo();
  const vol = volumeKey ? volumeByKey(volumeKey) : null;

  /* 画面に出ているカードだけを、画面と同じ順番で拾う */
  const visible = [];
  document.querySelectorAll('main .sec-head, main .q-card').forEach(node => {
    if (node.classList.contains('q-card')) {
      if (node.classList.contains('vol-off')) return;
      visible.push(node);
    } else {
      visible.push(node);
    }
  });
  // 問題が1つも残っていないセクション見出しは落とす
  const body = visible.filter((node, i) => {
    if (!node.classList.contains('sec-head')) return true;
    for (let j = i + 1; j < visible.length; j++) {
      if (visible[j].classList.contains('sec-head')) break;
      return true;
    }
    return false;
  });
  const total = body.filter(n => n.classList.contains('q-card')).length;

  const wantQuestions = (mode === 'questions' || mode === 'both');
  const wantAnswers = (mode === 'answers' || mode === 'both');
  const parts = [];

  function pushHeader(label, withNameRow) {
    parts.push('<div class="print-page">');
    parts.push('<div class="print-head">');
    if (head.eyebrow) parts.push(`<div class="print-eyebrow">${escapeHtml(head.eyebrow)}</div>`);
    parts.push(
      `<h1 class="print-title">${escapeHtml(head.title)}` +
      `<span class="print-kind">${escapeHtml(label)}</span>` +
      (vol ? `<span class="print-vol">${escapeHtml(vol.label)}　全${total}問</span>` : '') +
      '</h1>'
    );
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

  function pushBody(showAnswers) {
    let n = 0;
    body.forEach(node => {
      if (node.classList.contains('sec-head')) {
        const label = (node.querySelector('.sec-label') || {}).textContent || '';
        const title = (node.querySelector('.sec-title') || {}).textContent || '';
        parts.push(
          `<div class="print-sec"><span class="print-sec-label">${escapeHtml(label.trim())}</span>` +
          `<span class="print-sec-title">${escapeHtml(title.trim())}</span></div>`
        );
        return;
      }

      n++;
      const num = parseInt(String(node.id).replace(/^qc/, ''), 10);
      const q = byNum[num];
      const diff = (node.querySelector('.diff-tag') || {}).textContent || '';
      const qtext = innerHtmlOf(node, '.q-text');

      parts.push('<div class="print-q">');
      parts.push(
        `<div class="print-q-head"><span class="print-qnum">Q${String(n).padStart(2, '0')}</span>` +
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

/* ===================== 本体 ===================== */

function initQuiz(questions, sections) {
  const id = quizId();
  renderQuiz(sections, questions);

  function el(prefix, num) { return document.getElementById(prefix + num); }

  // 静的HTMLで書かれたページにも、優先度をカードへ写しておく
  questions.forEach(q => {
    const card = el('qc', q.num);
    if (card && !card.hasAttribute('data-pri')) card.setAttribute('data-pri', String(q.pri || 1));
  });

  let volumeKey = StudyRecords.getSetting('volume', DEFAULT_VOLUME);
  if (!VOLUMES.some(v => v.key === volumeKey)) volumeKey = DEFAULT_VOLUME;

  /* 現在の問題量で出題する問題（画面の並び順） */
  function activeQuestions() {
    const max = volumeByKey(volumeKey).maxPri;
    return questions.filter(q => (q.pri || 1) <= max);
  }
  /* その問題量で何問になるか */
  function countFor(key) {
    const max = volumeByKey(key).maxPri;
    return questions.filter(q => (q.pri || 1) <= max).length;
  }

  function updateProgress() {
    const active = activeQuestions();
    const total = active.length;
    let answered = 0;
    active.forEach(q => { if (el('q', q.num).value.trim() !== '') answered++; });
    const label = document.getElementById('prog-label');
    const inner = document.getElementById('prog-inner');
    if (label) label.textContent = answered === total ? '全問回答済み' : `未回答: ${total - answered}問`;
    if (inner) inner.style.width = (total ? answered / total * 100 : 0) + '%';
  }

  /* 現在の入力内容を { 問題番号: 回答 } の形で取り出す（隠れている問題も残す） */
  function collectAnswers() {
    const answers = {};
    questions.forEach(q => {
      const input = el('q', q.num);
      if (input && input.value.trim() !== '') answers[q.num] = input.value;
    });
    return answers;
  }

  /* 入力の途中経過を保存する（採点前でも次回そのまま再開できる） */
  let saveTimer = null;
  function saveDraftSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      StudyRecords.update(id, { answers: collectAnswers() });
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
    const vol = rec.volume ? `<span class="score-record-vol">${escapeHtml(volumeByKey(rec.volume).label)}</span>` : '';
    box.innerHTML =
      `<span><b>前回</b> ${rec.score} / ${rec.total}</span>` +
      (best ? `<span>${best}</span>` : '') +
      vol +
      (rec.at ? `<span class="score-record-at">${formatStamp(rec.at)}</span>` : '');
  }

  /* 保存されている回答を画面に復元する */
  function restoreAnswers() {
    const rec = StudyRecords.get(id);
    if (!rec || !rec.answers) return 0;
    let restored = 0;
    questions.forEach(q => {
      const saved = rec.answers[q.num];
      const input = el('q', q.num);
      if (input && typeof saved === 'string' && saved !== '') {
        input.value = saved;
        restored++;
      }
    });
    return restored;
  }

  /* 採点結果の表示を消す（問題量を切りかえたときに使う） */
  function clearFeedback() {
    questions.forEach(q => {
      const input = el('q', q.num);
      const card = el('qc', q.num);
      const fb = el('fb', q.num);
      if (input) input.classList.remove('ok', 'ng');
      if (card) card.classList.remove('correct', 'wrong');
      if (fb) { fb.classList.remove('show', 'ok-fb', 'ng-fb'); fb.innerHTML = ''; }
    });
    const panel = document.getElementById('result-panel');
    if (panel) panel.classList.remove('show');
  }

  /* 問題量に合わせてカードの表示・非表示と通し番号を更新する */
  function applyVolume(key, opts) {
    const silent = opts && opts.silent;
    volumeKey = volumeByKey(key).key;
    const max = volumeByKey(volumeKey).maxPri;

    let n = 0;
    questions.forEach(q => {
      const card = el('qc', q.num);
      if (!card) return;
      const on = (q.pri || 1) <= max;
      card.classList.toggle('vol-off', !on);
      if (on) {
        n++;
        const numEl = card.querySelector('.q-num');
        if (numEl) numEl.textContent = 'Q' + String(n).padStart(2, '0');
      }
    });

    // 問題が1つも残らないセクション見出しは隠す
    document.querySelectorAll('main .sec-head').forEach(head => {
      const label = head.getAttribute('data-sec');
      let has = false;
      if (label) {
        has = !!document.querySelector(`main .q-card[data-sec="${CSS.escape(label)}"]:not(.vol-off)`);
      } else {
        // 静的HTMLのページは、次の見出しまでのカードを見て判断する
        let node = head.nextElementSibling;
        while (node && !node.classList.contains('sec-head')) {
          if (node.classList.contains('q-card') && !node.classList.contains('vol-off')) { has = true; break; }
          node = node.nextElementSibling;
        }
      }
      head.classList.toggle('vol-off', !has);
    });

    const total = n;
    const scoreDisp = document.getElementById('score-disp');
    if (scoreDisp) scoreDisp.innerHTML = `0 <small>/ ${total}</small>`;
    const resultScore = document.getElementById('result-score');
    if (resultScore) resultScore.innerHTML = `0<em> / ${total}</em>`;

    if (!silent) {
      clearFeedback();
      StudyRecords.setSetting('volume', volumeKey);
    }
    renderVolumeBar();
    updateProgress();
    buildPrintSheet(questions, 'questions', volumeKey);
  }

  /* スコアバーに問題量の切りかえボタンを差し込む */
  function renderVolumeBar() {
    const bar = document.querySelector('.score-bar-inner');
    if (!bar) return;
    let group = document.getElementById('vol-group');
    if (!group) {
      group = document.createElement('span');
      group.id = 'vol-group';
      group.className = 'vol-group';
      const anchor = document.getElementById('score-record');
      if (anchor) bar.insertBefore(group, anchor); else bar.appendChild(group);
    }
    group.innerHTML =
      '<span class="vol-label">問題量</span>' +
      VOLUMES.map(v => {
        const c = countFor(v.key);
        const on = v.key === volumeKey ? ' active' : '';
        return `<button type="button" class="vol-btn${on}" data-vol="${v.key}" title="${escapeAttr(v.note)}">` +
               `${escapeHtml(v.label)}<em>${c}問</em></button>`;
      }).join('');
    group.querySelectorAll('.vol-btn').forEach(btn => {
      btn.addEventListener('click', () => applyVolume(btn.getAttribute('data-vol')));
    });
  }

  questions.forEach(q => {
    const input = el('q', q.num);
    if (!input) return;
    input.addEventListener('input', () => { updateProgress(); saveDraftSoon(); });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const active = activeQuestions();
      const i = active.findIndex(x => x.num === q.num);
      const next = active[i + 1];
      if (next) el('q', next.num).focus();
      else checkAll();
    });
  });

  restoreAnswers();
  renderRecordBar();
  // 初回は保存済みの設定をそのまま適用するだけなので、採点結果は消さない
  applyVolume(volumeKey, { silent: true });

  window.setVolume = key => applyVolume(key);
  window.printQuestions = () => { buildPrintSheet(questions, 'questions', volumeKey); window.print(); };
  window.printAnswers   = () => { buildPrintSheet(questions, 'answers',   volumeKey); window.print(); };
  window.printBoth      = () => { buildPrintSheet(questions, 'both',      volumeKey); window.print(); };

  window.checkAll = function () {
    const active = activeQuestions();
    const total = active.length;
    let correct = 0;
    const hyokaCorrect = { chi: 0, shi: 0, tai: 0 };
    const hyokaTotal = { chi: 0, shi: 0, tai: 0 };

    active.forEach(q => {
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

    // 採点結果を保存する。最高得点は同じ問題量どうしで比べる
    clearTimeout(saveTimer);
    const prev = StudyRecords.get(id);
    const sameVolume = prev && prev.volume === volumeKey;
    const prevBest = (sameVolume && typeof prev.best === 'number') ? prev.best : -1;
    StudyRecords.update(id, {
      score: correct,
      total: total,
      volume: volumeKey,
      best: Math.max(correct, prevBest),
      at: new Date().toISOString(),
      answers: collectAnswers(),
    });
    renderRecordBar();

    showResult(correct, total, hyokaCorrect, hyokaTotal);
  };

  window.resetAll = function () {
    questions.forEach(q => {
      const input = el('q', q.num);
      if (input) input.value = '';
    });
    clearFeedback();

    const total = activeQuestions().length;
    const scoreDisp = document.getElementById('score-disp');
    if (scoreDisp) scoreDisp.innerHTML = `0 <small>/ ${total}</small>`;

    // 画面上の解答は消すが、点数の記録（前回・最高）は残す
    clearTimeout(saveTimer);
    StudyRecords.update(id, { answers: {} });

    updateProgress();
    renderRecordBar();
    const first = activeQuestions()[0];
    if (first) el('q', first.num).focus();
  };

  /* この問題集の記録（回答・点数・最高得点）をすべて消去する */
  window.clearRecord = function () {
    if (!window.confirm('この問題集の成績と解答の記録を消去します。よろしいですか？')) return;
    window.resetAll();          // 先に画面を初期化する（この中で下書きが保存される）
    clearTimeout(saveTimer);
    StudyRecords.remove(id);    // そのうえで記録そのものを削除する
    renderRecordBar();
  };

  function showResult(correct, total, hyokaCorrect, hyokaTotal) {
    const panel = document.getElementById('result-panel');
    if (!panel) return;
    const pct = total > 0 ? Math.round(correct / total * 100) : 0;
    let comment;
    if (pct >= 90) comment = '素晴らしい！この調子で応用問題にも挑戦しよう。';
    else if (pct >= 70) comment = 'よくできました。間違えた問題を復習しよう。';
    else if (pct >= 50) comment = '基礎は身についています。苦手な単元を重点的に復習しよう。';
    else comment = '教科書に戻って、基本からもう一度確認しよう。';
    if (pct >= 90 && volumeKey !== 'hard') {
      comment += `「${volumeByKey(volumeKey === 'normal' ? 'solid' : 'hard').label}」にも挑戦してみよう。`;
    }

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
