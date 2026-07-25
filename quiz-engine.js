/* 共通クイズ採点エンジン
   各クイズページは questions 配列 (num, hyoka, check, answer, hint) を定義し、
   initQuiz(questions) を呼び出すだけで採点・進捗・結果パネルが動作する。 */

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

function initQuiz(questions) {
  const total = questions.length;

  function el(prefix, num) { return document.getElementById(prefix + num); }

  function updateProgress() {
    let answered = 0;
    questions.forEach(q => { if (el('q', q.num).value.trim() !== '') answered++; });
    const label = document.getElementById('prog-label');
    const inner = document.getElementById('prog-inner');
    if (label) label.textContent = answered === total ? '全問回答済み' : `未回答: ${total - answered}問`;
    if (inner) inner.style.width = (answered / total * 100) + '%';
  }

  questions.forEach((q, i) => {
    const input = el('q', q.num);
    input.addEventListener('input', updateProgress);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = questions[i + 1];
        if (next) el('q', next.num).focus();
        else checkAll();
      }
    });
  });
  updateProgress();

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
    updateProgress();
    el('q', questions[0].num).focus();
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
