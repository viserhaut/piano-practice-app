// app.js
// アプリケーション全体の状態管理とイベント調停

// ============================================================
// アプリ状態
// ============================================================
const AppState = {
  mode: 'freeplay',        // 'freeplay' | 'quiz' | 'practice'
  noteNameStyle: 'doremi', // 'doremi' | 'cdefg'
  activeNotes: new Set(),
  midiConnected: false,
  deviceName: null
};

// ============================================================
// Wake Lock
// ============================================================
let _wakeLock = null;

async function _acquireWakeLock() {
  if (!('wakeLock' in navigator) || _wakeLock) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch (e) { /* 未対応ブラウザは無視 */ }
}

function _releaseWakeLock() {
  if (_wakeLock) { _wakeLock.release(); _wakeLock = null; }
}

// ページ復帰時に再取得（スリープから復帰後など）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && AppState.midiConnected) {
    _acquireWakeLock();
  }
});

// ============================================================
// DOM 要素
// ============================================================
let el = {};

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
  el = {
    // ヘッダー
    btnConnect:    document.getElementById('btn-connect'),
    btnNoteName:   document.getElementById('btn-notename'),
    btnHelp:       document.getElementById('btn-help'),
    btnModalClose: document.getElementById('btn-modal-close'),
    midiStatus:    document.getElementById('midi-status'),
    modalHelp:     document.getElementById('modal-help'),
    // キーボード
    keyboardCanvas: document.getElementById('keyboard-canvas'),
    // モード切り替え
    btnModeFreeplay: document.getElementById('btn-mode-freeplay'),
    btnModeQuiz:     document.getElementById('btn-mode-quiz'),
    btnModePractice: document.getElementById('btn-mode-practice'),
    // フリープレイ
    freeplayArea: document.getElementById('freeplay-area'),
    noteDisplay:  document.getElementById('note-display'),
    // クイズ
    quizArea:     document.getElementById('quiz-area'),
    quizStart:    document.getElementById('quiz-start'),
    quizPlaying:  document.getElementById('quiz-playing'),
    quizSummary:  document.getElementById('quiz-summary'),
    btnQuizStart:  document.getElementById('btn-quiz-start'),
    btnQuizRetry:  document.getElementById('btn-quiz-retry'),
    btnQuizReset:  document.getElementById('btn-quiz-reset'),
    statCount:    document.getElementById('stat-count'),
    statCorrect:  document.getElementById('stat-correct'),
    statWrong:    document.getElementById('stat-wrong'),
    statTime:     document.getElementById('stat-time'),
    quizFeedback: document.getElementById('quiz-feedback'),
    quizCanvas:   document.getElementById('quiz-canvas'),
    summaryStats: document.getElementById('summary-stats'),
    summaryWeak:  document.getElementById('summary-weak'),
    clefDesc:     document.getElementById('clef-desc'),
    // 楽譜練習
    practiceArea:       document.getElementById('practice-area'),
    practiceSelect:     document.getElementById('practice-select'),
    practicePlaying:    document.getElementById('practice-playing'),
    practiceSongTitle:  document.getElementById('practice-song-title'),
    practiceCanvas:     document.getElementById('practice-canvas'),
    practiceFeedback:   document.getElementById('practice-feedback'),
    practiceProgress:   document.getElementById('practice-progress'),
    btnPracticeBack:    document.getElementById('btn-practice-back'),
    btnPracticeRestart: document.getElementById('btn-practice-restart'),
    midiFileInput:      document.getElementById('midi-file-input'),
  };

  // バーチャルキーボード
  Renderer.init(el.keyboardCanvas);

  // クイズモード初期化
  QuizMode.init(el.quizCanvas);
  QuizMode.setOnAnswer(_handleQuizAnswer);
  QuizMode.setOnSessionEnd(_handleQuizSessionEnd);

  // 楽譜練習初期化
  SongPractice.init(el.practiceCanvas);
  SongPractice.setOnAnswer(_handlePracticeAnswer);
  SongPractice.setOnFinish(_handlePracticeFinish);

  // MIDI コールバック
  MidiHandler.setOnNoteOn(_handleNoteOn);
  MidiHandler.setOnNoteOff(_handleNoteOff);
  MidiHandler.setOnDeviceChange(_handleDeviceChange);

  // ヘッダーボタン
  el.btnConnect.addEventListener('click', _handleConnect);
  el.btnNoteName.addEventListener('click', _handleNoteNameToggle);
  el.btnHelp.addEventListener('click', _openModal);
  el.btnModalClose.addEventListener('click', _closeModal);
  el.modalHelp.addEventListener('click', e => { if (e.target === el.modalHelp) _closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _closeModal(); });

  // モード切り替え
  el.btnModeFreeplay.addEventListener('click',  () => _switchMode('freeplay'));
  el.btnModeQuiz.addEventListener('click',      () => _switchMode('quiz'));
  el.btnModePractice.addEventListener('click',  () => _switchMode('practice'));

  // クイズ スタート / リトライ / リセット
  el.btnQuizStart.addEventListener('click', _startQuiz);
  el.btnQuizRetry.addEventListener('click', _startQuiz);
  el.btnQuizReset.addEventListener('click', _resetQuizWeights);

  // 記号選択ボタン
  document.querySelectorAll('.clef-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.clef-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const clef = btn.dataset.clef;
      QuizMode.setClefMode(clef);
      _updateClefDesc(clef);
    });
  });

  // 楽譜練習: 曲ボタン
  document.querySelectorAll('.song-btn[data-song]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.song;
      _startPracticeSong(id);
    });
  });

  // 楽譜練習: MIDIファイル読み込み
  el.midiFileInput.addEventListener('change', _handleMidiFileLoad);

  // 楽譜練習: 戻る / 最初から
  el.btnPracticeBack.addEventListener('click', () => _showPracticePanel('select'));
  el.btnPracticeRestart.addEventListener('click', () => {
    SongPractice.restart();
    _updatePracticeProgress();
    _clearPracticeFeedback();
  });
});

// ============================================================
// モード切り替え
// ============================================================
function _switchMode(mode) {
  AppState.mode = mode;

  el.btnModeFreeplay.classList.toggle('active',  mode === 'freeplay');
  el.btnModeQuiz.classList.toggle('active',      mode === 'quiz');
  el.btnModePractice.classList.toggle('active',  mode === 'practice');

  el.freeplayArea.style.display  = mode === 'freeplay'  ? '' : 'none';
  el.quizArea.style.display      = mode === 'quiz'      ? '' : 'none';
  el.practiceArea.style.display  = mode === 'practice'  ? '' : 'none';

  if (mode === 'freeplay') {
    _releaseWakeLock();
    el.noteDisplay.textContent = AppState.activeNotes.size > 0
      ? Renderer.getNoteLabel([...AppState.activeNotes].at(-1)) : '—';
  }
  if (mode === 'quiz') {
    _showQuizPanel('start');
  }
  if (mode === 'practice') {
    _showPracticePanel('select');
  }
}

// ============================================================
// クイズ UI
// ============================================================
function _showQuizPanel(panel) {
  el.quizStart.style.display   = panel === 'start'   ? '' : 'none';
  el.quizPlaying.style.display = panel === 'playing' ? '' : 'none';
  el.quizSummary.style.display = panel === 'summary' ? '' : 'none';
}

function _startQuiz() {
  _showQuizPanel('playing');
  el.quizFeedback.textContent = '';
  el.quizFeedback.className   = '';
  _updateStats({ count: 0, correct: 0, wrong: 0, times: [] });
  QuizMode.start();
  _acquireWakeLock();
}

function _resetQuizWeights() {
  if (!confirm('学習履歴（苦手音符の重み）をリセットしますか？')) return;
  QuizMode.resetWeights();
}

function _updateClefDesc(clef) {
  const descs = {
    treble: 'C4〜G5（ト音記号）',
    bass:   'G2〜B3（ヘ音記号）',
    both:   'C4〜G5 + G2〜B3（両方）'
  };
  el.clefDesc.textContent = (descs[clef] || '') + ' · 全20問 · 苦手な音符が多く出題されます';
}

function _updateStats(session) {
  el.statCount.textContent   = `${session.count} / 20`;
  el.statCorrect.textContent = `✓ ${session.correct}`;
  el.statWrong.textContent   = `✗ ${session.wrong}`;
}

// ============================================================
// クイズ コールバック
// ============================================================
function _handleQuizAnswer(correct, responseMs, pressed, answered) {
  const session = QuizMode.getSession();
  _updateStats(session);

  const style   = AppState.noteNameStyle;
  const label   = QuizMode.getNoteLabel(answered, style);
  const timeStr = (responseMs / 1000).toFixed(1) + '秒';

  if (correct) {
    el.quizFeedback.textContent = `✓ ${label} — ${timeStr}`;
    el.quizFeedback.className   = 'correct';
    el.statTime.textContent     = timeStr;
  } else {
    const pressedLabel = QuizMode.getNoteLabel(pressed, style);
    el.quizFeedback.textContent = `✗ ${pressedLabel} → 正解は ${label}`;
    el.quizFeedback.className   = 'wrong';
    el.statTime.textContent     = '—';
  }
}

function _handleQuizSessionEnd(session) {
  _showQuizPanel('summary');
  _releaseWakeLock();

  const accuracy = session.count > 0
    ? Math.round((session.correct / session.count) * 100) : 0;
  const avgTime = session.times.length > 0
    ? (session.times.reduce((a, b) => a + b, 0) / session.times.length / 1000).toFixed(1) : '—';

  el.summaryStats.innerHTML = `
    <div>正解率: <strong>${accuracy}%</strong>（${session.correct} / ${session.count}）</div>
    <div>平均応答時間: <strong>${avgTime}秒</strong></div>
  `;

  const weights   = QuizMode.getWeights();
  const style     = AppState.noteNameStyle;
  const weakNotes = Object.entries(weights)
    .filter(([, w]) => w >= 1.5)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([note]) => `<span>${QuizMode.getNoteLabel(Number(note), style)}</span>`)
    .join('');

  el.summaryWeak.innerHTML = weakNotes
    ? `<strong style="display:block;margin-bottom:8px;font-size:12px;">苦手な音符（重点的に練習しましょう）</strong>${weakNotes}`
    : '<em style="font-size:13px;">苦手な音符はありません 🎉</em>';
}

// ============================================================
// 楽譜練習 UI
// ============================================================
function _showPracticePanel(panel) {
  el.practiceSelect.style.display  = panel === 'select'  ? '' : 'none';
  el.practicePlaying.style.display = panel === 'playing' ? '' : 'none';
}

function _startPracticeSong(id) {
  SongPractice.loadSong(id);
  const song = SongPractice.getCurrentSong();
  if (!song) return;
  el.practiceSongTitle.textContent = song.title;
  _showPracticePanel('playing');
  _updatePracticeProgress();
  _clearPracticeFeedback();
  _acquireWakeLock();
  // Canvasが表示された後にサイズ再計算して再描画
  requestAnimationFrame(() => {
    const c = el.practiceCanvas;
    if (c.offsetWidth > 0) {
      c.width  = c.offsetWidth;
      c.height = c.offsetHeight;
    }
    SongPractice.drawPractice();
  });
}

function _handleMidiFileLoad(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (ev) {
    try {
      const parsed = MidiParser.parse(new Uint8Array(ev.target.result));
      const notes  = _extractMelodyFromMidi(parsed);
      if (notes.length === 0) { alert('音符が見つかりませんでした。'); return; }
      SongPractice.loadCustomNotes(file.name.replace(/\.(mid|midi)$/i, ''), notes);
      const song = SongPractice.getCurrentSong();
      el.practiceSongTitle.textContent = song ? song.title : file.name;
      _showPracticePanel('playing');
      _updatePracticeProgress();
      _clearPracticeFeedback();
      _acquireWakeLock();
      requestAnimationFrame(() => {
        const c = el.practiceCanvas;
        if (c.offsetWidth > 0) { c.width = c.offsetWidth; c.height = c.offsetHeight; }
        SongPractice.drawPractice();
      });
    } catch(err) {
      alert('MIDIファイルの読み込みに失敗しました。');
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = ''; // 同じファイルを再選択できるようにリセット
}

/** MIDIパース結果から単旋律（最高音トラック）を抽出する */
function _extractMelodyFromMidi(parsed) {
  const notes = [];
  if (!parsed || !parsed.track) return notes;

  for (const track of parsed.track) {
    let time = 0;
    const trackNotes = [];
    for (const event of track.event) {
      time += event.deltaTime || 0;
      if (event.type === 9 && event.data && event.data[1] > 0) {
        trackNotes.push(event.data[0]);
      }
    }
    if (trackNotes.length > notes.length) {
      notes.length = 0;
      notes.push(...trackNotes);
    }
  }
  return notes;
}

function _handlePracticeAnswer(correct, pressed, target) {
  if (correct) {
    el.practiceFeedback.textContent = '✓';
    el.practiceFeedback.className   = 'correct';
  } else {
    const pressedLabel = Renderer.getNoteLabel(pressed) || String(pressed);
    const targetLabel  = Renderer.getNoteLabel(target)  || String(target);
    el.practiceFeedback.textContent = `✗ ${pressedLabel} → ${targetLabel}`;
    el.practiceFeedback.className   = 'wrong';
  }
  _updatePracticeProgress();
}

function _handlePracticeFinish(stats) {
  _releaseWakeLock();
  const acc = stats.total > 0 ? Math.round(stats.correct / stats.total * 100) : 100;
  el.practiceFeedback.textContent = `完奏！ 正解率 ${acc}%`;
  el.practiceFeedback.className   = 'correct';
}

function _updatePracticeProgress() {
  const song = SongPractice.getCurrentSong();
  if (!song) return;
  const idx = SongPractice.getNoteIndex();
  el.practiceProgress.textContent = `${idx} / ${song.notes.length}`;
}

function _clearPracticeFeedback() {
  el.practiceFeedback.textContent = '';
  el.practiceFeedback.className   = '';
}

// ============================================================
// MIDI 接続
// ============================================================
async function _handleConnect() {
  _setStatus('接続中…', 'connecting');
  el.btnConnect.disabled = true;

  const success = await MidiHandler.connect();
  el.btnConnect.disabled = false;

  if (!success) {
    _setStatus('未接続', 'disconnected');
    el.btnConnect.textContent = 'MIDI接続';
  } else if (!AppState.midiConnected) {
    _setStatus('デバイスが見つかりません', 'disconnected');
    el.btnConnect.textContent = 'MIDI接続';
    _openModal();
  }
}

function _handleDeviceChange(deviceName, connected) {
  AppState.midiConnected = connected;
  AppState.deviceName    = deviceName;

  if (connected) {
    _setStatus(deviceName || '接続済み', 'connected');
    el.btnConnect.textContent = '再接続';
    _acquireWakeLock();
  } else {
    _setStatus('未接続', 'disconnected');
    el.btnConnect.textContent = 'MIDI接続';
    AppState.activeNotes.clear();
    Renderer.setActiveNotes(AppState.activeNotes);
    el.noteDisplay.textContent = '—';
    _releaseWakeLock();
  }
}

// ============================================================
// Note On / Note Off
// ============================================================
function _handleNoteOn(note, velocity) {
  AppState.activeNotes.add(note);
  Renderer.addNote(note);

  if (AppState.mode === 'freeplay') {
    el.noteDisplay.textContent = Renderer.getNoteLabel(note) || '?';
    el.noteDisplay.classList.remove('miss');
  } else if (AppState.mode === 'quiz') {
    QuizMode.onNotePressed(note);
  } else if (AppState.mode === 'practice') {
    SongPractice.onNotePressed(note);
  }
}

function _handleNoteOff(note) {
  AppState.activeNotes.delete(note);
  Renderer.removeNote(note);

  if (AppState.mode === 'freeplay' && AppState.activeNotes.size === 0) {
    el.noteDisplay.textContent = '—';
  }
}

// ============================================================
// 音名スタイル切り替え
// ============================================================
function _handleNoteNameToggle() {
  if (AppState.noteNameStyle === 'doremi') {
    AppState.noteNameStyle = 'cdefg';
    el.btnNoteName.textContent = 'CDEFG';
  } else {
    AppState.noteNameStyle = 'doremi';
    el.btnNoteName.textContent = 'ドレミ';
  }
  Renderer.setNoteNameStyle(AppState.noteNameStyle);
  QuizMode.setNoteNameStyle(AppState.noteNameStyle);
  SongPractice.setNoteNameStyle(AppState.noteNameStyle);
}

// ============================================================
// モーダル
// ============================================================
function _openModal()  { el.modalHelp.style.display = 'flex'; }
function _closeModal() { el.modalHelp.style.display = 'none'; }

// ============================================================
// ステータスバッジ
// ============================================================
function _setStatus(text, cssClass) {
  el.midiStatus.textContent = text;
  el.midiStatus.className   = `status ${cssClass}`;
}
