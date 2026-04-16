// app.js
// アプリケーション全体の状態管理とイベント調停

// ============================================================
// アプリ状態
// ============================================================
const AppState = {
  mode: 'freeplay',        // 'freeplay' | 'quiz'
  noteNameStyle: 'doremi', // 'doremi' | 'cdefg'
  activeNotes: new Set(),
  midiConnected: false,
  deviceName: null
};

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
    btnConnect:     document.getElementById('btn-connect'),
    btnNoteName:    document.getElementById('btn-notename'),
    btnHelp:        document.getElementById('btn-help'),
    btnModalClose:  document.getElementById('btn-modal-close'),
    midiStatus:     document.getElementById('midi-status'),
    modalHelp:      document.getElementById('modal-help'),
    // キーボード
    keyboardCanvas: document.getElementById('keyboard-canvas'),
    // モード切り替え
    btnModeFreeplay: document.getElementById('btn-mode-freeplay'),
    btnModeQuiz:     document.getElementById('btn-mode-quiz'),
    modeContent:     document.getElementById('mode-content'),
    // フリープレイ
    freeplayArea:   document.getElementById('freeplay-area'),
    noteDisplay:    document.getElementById('note-display'),
    // クイズ
    quizArea:        document.getElementById('quiz-area'),
    quizStart:       document.getElementById('quiz-start'),
    quizPlaying:     document.getElementById('quiz-playing'),
    quizSummary:     document.getElementById('quiz-summary'),
    btnQuizStart:    document.getElementById('btn-quiz-start'),
    btnQuizRetry:    document.getElementById('btn-quiz-retry'),
    statCount:       document.getElementById('stat-count'),
    statCorrect:     document.getElementById('stat-correct'),
    statWrong:       document.getElementById('stat-wrong'),
    statTime:        document.getElementById('stat-time'),
    quizFeedback:    document.getElementById('quiz-feedback'),
    quizCanvas:      document.getElementById('quiz-canvas'),
    summaryStats:    document.getElementById('summary-stats'),
    summaryWeak:     document.getElementById('summary-weak')
  };

  // バーチャルキーボード初期化
  Renderer.init(el.keyboardCanvas);

  // クイズモード初期化
  QuizMode.init(el.quizCanvas);
  QuizMode.setOnAnswer(_handleQuizAnswer);
  QuizMode.setOnSessionEnd(_handleQuizSessionEnd);

  // MIDI コールバック
  MidiHandler.setOnNoteOn(_handleNoteOn);
  MidiHandler.setOnNoteOff(_handleNoteOff);
  MidiHandler.setOnDeviceChange(_handleDeviceChange);

  // ヘッダーボタン
  el.btnConnect.addEventListener('click', _handleConnect);
  el.btnNoteName.addEventListener('click', _handleNoteNameToggle);
  el.btnHelp.addEventListener('click', _openModal);
  el.btnModalClose.addEventListener('click', _closeModal);
  el.modalHelp.addEventListener('click', function (e) {
    if (e.target === el.modalHelp) _closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') _closeModal();
  });

  // モード切り替えボタン
  el.btnModeFreeplay.addEventListener('click', function () { _switchMode('freeplay'); });
  el.btnModeQuiz.addEventListener('click',     function () { _switchMode('quiz'); });

  // クイズ スタート / リトライ
  el.btnQuizStart.addEventListener('click', _startQuiz);
  el.btnQuizRetry.addEventListener('click', _startQuiz);
});

// ============================================================
// モード切り替え
// ============================================================
function _switchMode(mode) {
  AppState.mode = mode;

  // タブのアクティブ状態
  el.btnModeFreeplay.classList.toggle('active', mode === 'freeplay');
  el.btnModeQuiz.classList.toggle('active',     mode === 'quiz');

  // コンテンツ表示
  el.freeplayArea.style.display = mode === 'freeplay' ? '' : 'none';
  el.quizArea.style.display     = mode === 'quiz'     ? '' : 'none';

  // フリープレイに戻したらリセット
  if (mode === 'freeplay') {
    el.noteDisplay.textContent = AppState.activeNotes.size > 0
      ? Renderer.getNoteLabel([...AppState.activeNotes].at(-1))
      : '—';
  }

  // クイズタブに切り替えたら Start 画面を表示
  if (mode === 'quiz') {
    _showQuizPanel('start');
  }
}

// ============================================================
// クイズ UI 管理
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
}

/** クイズ統計バーを更新する */
function _updateStats(session) {
  el.statCount.textContent   = `${session.count} / 20`;
  el.statCorrect.textContent = `✓ ${session.correct}`;
  el.statWrong.textContent   = `✗ ${session.wrong}`;
}

// ============================================================
// クイズ コールバック
// ============================================================

/** 1 問の答えが確定したときに呼ばれる */
function _handleQuizAnswer(correct, responseMs, pressed, answered) {
  const session = QuizMode.getSession();
  _updateStats(session);

  const style  = AppState.noteNameStyle;
  const label  = QuizMode.getNoteLabel(answered, style);
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

/** セッション終了時に呼ばれる */
function _handleQuizSessionEnd(session) {
  _showQuizPanel('summary');

  const accuracy = session.count > 0
    ? Math.round((session.correct / session.count) * 100)
    : 0;

  const avgTime = session.times.length > 0
    ? (session.times.reduce((a, b) => a + b, 0) / session.times.length / 1000).toFixed(1)
    : '—';

  el.summaryStats.innerHTML = `
    <div>正解率: <strong>${accuracy}%</strong>（${session.correct} / ${session.count}）</div>
    <div>平均応答時間: <strong>${avgTime}秒</strong></div>
  `;

  // 苦手な音符 (重みが 1.5 以上のもの) を表示
  const weights  = QuizMode.getWeights();
  const style    = AppState.noteNameStyle;
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
// MIDI 接続処理
// ============================================================
async function _handleConnect() {
  _setStatus('接続中…', 'connecting');
  el.btnConnect.disabled = true;

  const success = await MidiHandler.connect();

  el.btnConnect.disabled = false;

  if (!success) {
    // requestMIDIAccess 自体が失敗（拒否 or 非対応）
    _setStatus('未接続', 'disconnected');
    el.btnConnect.textContent = 'MIDI接続';
  } else if (!AppState.midiConnected) {
    // 許可は得られたがデバイスが見つからない
    _setStatus('デバイスが見つかりません', 'disconnected');
    el.btnConnect.textContent = 'MIDI接続';
    // 接続ガイドを自動表示して次のステップを案内
    _openModal();
  }
}

function _handleDeviceChange(deviceName, connected) {
  AppState.midiConnected = connected;
  AppState.deviceName    = deviceName;

  if (connected) {
    _setStatus(deviceName || '接続済み', 'connected');
    el.btnConnect.textContent = '再接続';
  } else {
    _setStatus('未接続', 'disconnected');
    el.btnConnect.textContent = 'MIDI接続';
    AppState.activeNotes.clear();
    Renderer.setActiveNotes(AppState.activeNotes);
    el.noteDisplay.textContent = '—';
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
