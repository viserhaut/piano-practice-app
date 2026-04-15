// app.js
// アプリケーション全体の状態管理とイベント調停

// ============================================================
// アプリ状態
// ============================================================
const AppState = {
  mode: 'freeplay',           // 'freeplay' | 'lesson' | 'waiting'（将来のフェーズで拡張）
  noteNameStyle: 'doremi',    // 'doremi' | 'cdefg'
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
    btnConnect:    document.getElementById('btn-connect'),
    btnNoteName:   document.getElementById('btn-notename'),
    btnHelp:       document.getElementById('btn-help'),
    btnModalClose: document.getElementById('btn-modal-close'),
    midiStatus:    document.getElementById('midi-status'),
    modalHelp:     document.getElementById('modal-help'),
    noteDisplay:   document.getElementById('note-display'),
    keyboardCanvas: document.getElementById('keyboard-canvas')
  };

  // Canvas 初期化
  Renderer.init(el.keyboardCanvas);

  // MIDI コールバック設定
  MidiHandler.setOnNoteOn(_handleNoteOn);
  MidiHandler.setOnNoteOff(_handleNoteOff);
  MidiHandler.setOnDeviceChange(_handleDeviceChange);

  // ボタンイベント
  el.btnConnect.addEventListener('click', _handleConnect);
  el.btnNoteName.addEventListener('click', _handleNoteNameToggle);
  el.btnHelp.addEventListener('click', _openModal);
  el.btnModalClose.addEventListener('click', _closeModal);
  el.modalHelp.addEventListener('click', function (e) {
    if (e.target === el.modalHelp) _closeModal();
  });

  // ESC でモーダルを閉じる
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') _closeModal();
  });
});

// ============================================================
// MIDI 接続処理
// ============================================================
async function _handleConnect() {
  _setStatus('接続中…', 'connecting');
  el.btnConnect.disabled = true;

  const success = await MidiHandler.connect();

  el.btnConnect.disabled = false;

  if (!success) {
    _setStatus('未接続', 'disconnected');
    el.btnConnect.textContent = 'MIDI接続';
  }
  // 接続成功時は _handleDeviceChange() が呼ばれて状態が更新される
}

/** デバイスの接続状態が変化したときに呼ばれる */
function _handleDeviceChange(deviceName, connected) {
  AppState.midiConnected = connected;
  AppState.deviceName = deviceName;

  if (connected) {
    const displayName = deviceName || '接続済み';
    _setStatus(displayName, 'connected');
    el.btnConnect.textContent = '再接続';
  } else {
    _setStatus('未接続', 'disconnected');
    el.btnConnect.textContent = 'MIDI接続';

    // 全ての押鍵をリセット
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
    const label = Renderer.getNoteLabel(note);
    el.noteDisplay.textContent = label || '?';
    el.noteDisplay.classList.remove('miss');
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
}

// ============================================================
// モーダル
// ============================================================
function _openModal()  { el.modalHelp.style.display = 'flex'; }
function _closeModal() { el.modalHelp.style.display = 'none'; }

// ============================================================
// ステータスバッジ更新
// ============================================================
function _setStatus(text, cssClass) {
  el.midiStatus.textContent  = text;
  el.midiStatus.className    = `status ${cssClass}`;
}
