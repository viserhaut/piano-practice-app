// quiz-mode.js
// 音符クイズモード — 音符 → 鍵盤の瞬間認識を訓練する
//
// 改善点:
//   - ヘ音記号対応 (G2〜B3) + 記号選択 (ト音/ヘ音/両方)
//   - デッキ方式で全音符を網羅的に出題
//   - 隣接音符の連続出題を防止
//   - 重みを localStorage に永続化（セッション跨ぎの個人適応学習）

const QuizMode = (function () {

  // ============================================================
  // 音符セット
  // ============================================================

  // ト音記号: C4〜G5（バイエルレベル）
  const TREBLE_NOTES = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79];
  //                    C4  D4  E4  F4  G4  A4  B4  C5  D5  E5  F5  G5

  // ヘ音記号: G2〜B3（左手の基本音域）
  const BASS_NOTES = [43, 45, 47, 48, 50, 52, 53, 55, 57, 59];
  //                  G2  A2  B2  C3  D3  E3  F3  G3  A3  B3

  // MIDI ノートの全音階絶対値計算用
  // 各 MIDI noteInOctave (0〜11) → 白鍵の順位 (0=C)
  const DIATONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

  // ト音記号: E4 が下第1線 (abs=30)
  const E4_ABS = 30;
  // ヘ音記号: G2 が下第1線 (abs=18)
  const G2_ABS = 18;

  // ============================================================
  // 描画定数
  // ============================================================
  const LINE_SPACING    = 18;
  const NOTE_RX         = LINE_SPACING * 0.50;
  const NOTE_RY         = LINE_SPACING * 0.38;
  const NOTE_TILT       = -0.25;

  // ============================================================
  // 学習パラメータ
  // ============================================================
  const FEEDBACK_CORRECT   = 800;
  const FEEDBACK_WRONG     = 1500;
  const WEIGHT_MIN         = 0.3;
  const WEIGHT_MAX         = 5.0;
  const WEIGHT_FAST_MUL    = 0.8;   // 正解 & 速い (< 2s)
  const WEIGHT_SLOW_MUL    = 1.15;  // 正解 & 遅い (> 4s)
  const WEIGHT_WRONG_MUL   = 1.6;   // 不正解
  const FAST_THRESHOLD_MS  = 2000;
  const SLOW_THRESHOLD_MS  = 4000;
  const SESSION_TOTAL      = 20;

  const LS_KEY = 'piano-quiz-weights'; // localStorage キー

  // ============================================================
  // 状態
  // ============================================================
  let canvas        = null;
  let ctx           = null;
  let styleRef      = 'doremi';
  let clefMode      = 'treble'; // 'treble' | 'bass' | 'both'

  let currentNote   = null;  // 現在表示中の MIDI ノート番号
  let currentClef   = 'treble'; // 現在表示中の記号
  let prevAbsStep   = null;  // 直前の音符の絶対全音階ステップ（隣接防止用）
  let startTime     = null;
  let weights       = {};
  let deck          = [];    // 未出題ノートのデッキ（網羅性保証）
  let session       = null;
  let feedbackTimer = null;

  let onAnswerCb     = null;
  let onSessionEndCb = null;

  // ============================================================
  // localStorage 永続化
  // ============================================================

  function _loadWeights() {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) weights = JSON.parse(saved);
    } catch (e) { /* ignore */ }
    // 全音符に重みを保証
    [...TREBLE_NOTES, ...BASS_NOTES].forEach(n => {
      if (typeof weights[n] !== 'number') weights[n] = 1.0;
    });
  }

  function _saveWeights() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(weights)); } catch (e) { /* ignore */ }
  }

  // ============================================================
  // 全音階絶対値計算（隣接防止に使用）
  // ============================================================

  function _midiToAbs(midiNote) {
    const noteInOct = midiNote % 12;
    const octave    = Math.floor(midiNote / 12) - 1;
    return octave * 7 + DIATONIC[noteInOct];
  }

  // ============================================================
  // 記号別ステップ計算（描画用）
  // ============================================================

  function _midiToStepTreble(midiNote) {
    return _midiToAbs(midiNote) - E4_ABS;
  }

  function _midiToStepBass(midiNote) {
    return _midiToAbs(midiNote) - G2_ABS;
  }

  // ============================================================
  // アクティブ音符セット
  // ============================================================

  function _getActiveNotes() {
    if (clefMode === 'treble') return TREBLE_NOTES;
    if (clefMode === 'bass')   return BASS_NOTES;
    return [...TREBLE_NOTES, ...BASS_NOTES];
  }

  function _clefForNote(midiNote) {
    return BASS_NOTES.includes(midiNote) ? 'bass' : 'treble';
  }

  // ============================================================
  // デッキ管理（網羅性保証）
  // ============================================================

  /**
   * デッキを構築する。
   * 全音符を 1 度ずつ含む基本デッキを重みの比率でシャッフル。
   * 高重み音符は確率的に複数枚追加される。
   */
  function _buildDeck() {
    const notes = _getActiveNotes();
    deck = [];

    notes.forEach(n => {
      deck.push(n); // 全音符 1 回は保証
      // 重みが 2.0 超の場合は追加出題チャンス
      if (weights[n] >= 2.0) deck.push(n);
      if (weights[n] >= 3.5) deck.push(n);
    });

    // Fisher-Yates シャッフル
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }

  /**
   * デッキから次の音符を取り出す。
   * 制約:
   *   1. 直前と同じ音符は不可
   *   2. 直前と全音階上で隣接（±1ステップ）する音符は不可
   */
  function _sampleNote() {
    if (deck.length === 0) _buildDeck();

    // デッキ内で制約を満たす最初の候補を選ぶ
    for (let i = 0; i < deck.length; i++) {
      const candidate = deck[i];
      if (candidate === currentNote) continue;
      if (prevAbsStep !== null && Math.abs(_midiToAbs(candidate) - prevAbsStep) <= 1) continue;
      deck.splice(i, 1);
      return candidate;
    }

    // 全候補が制約違反なら制約を緩和（隣接のみ許可、同一音は禁止）
    for (let i = 0; i < deck.length; i++) {
      if (deck[i] !== currentNote) {
        const note = deck.splice(i, 1)[0];
        return note;
      }
    }

    // 最終フォールバック: デッキを再構築
    _buildDeck();
    return deck.shift() || _getActiveNotes()[0];
  }

  // ============================================================
  // 五線譜描画
  // ============================================================

  function drawStaff() {
    if (!canvas || !ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const clef = (clefMode === 'both') ? (currentClef || 'treble') : clefMode;
    _drawStaffWithClef(clef, W, H);
  }

  function _drawStaffWithClef(clef, W, H) {
    const staffCenterY = H * 0.48;
    const staffTop     = staffCenterY - 2 * LINE_SPACING;
    const staffLeft    = clef === 'treble' ? 68 : 60;
    const staffWidth   = W - staffLeft - 30;

    // 五線
    ctx.strokeStyle = '#c8c8e8';
    ctx.lineWidth   = 1.5;
    for (let i = 0; i < 5; i++) {
      const y = staffTop + i * LINE_SPACING;
      ctx.beginPath();
      ctx.moveTo(staffLeft, y);
      ctx.lineTo(staffLeft + staffWidth, y);
      ctx.stroke();
    }

    // 記号
    if (clef === 'treble') {
      ctx.font         = `${LINE_SPACING * 4.8}px 'Times New Roman', serif`;
      ctx.fillStyle    = '#c8c8e8';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('\uD834\uDD1E', staffLeft + 3, staffTop + LINE_SPACING * 4.8);
    } else {
      // ヘ音記号 𝄢
      ctx.font         = `${LINE_SPACING * 3.0}px 'Times New Roman', serif`;
      ctx.fillStyle    = '#c8c8e8';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('\uD834\uDD22', staffLeft + 3, staffTop + LINE_SPACING * 1.5);
    }

    // 「両方」モード時: 記号ラベル表示
    if (clefMode === 'both' && currentNote !== null) {
      const label = clef === 'treble' ? 'ト音記号' : 'ヘ音記号';
      ctx.font         = `bold 11px sans-serif`;
      ctx.fillStyle    = '#7a7aaa';
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(label, W - 8, 6);
    }

    // 音符
    if (currentNote !== null) {
      const refY  = staffTop + 4 * LINE_SPACING; // 下第1線のY座標
      const step  = clef === 'treble'
        ? _midiToStepTreble(currentNote)
        : _midiToStepBass(currentNote);
      _drawNote(step, refY, staffLeft, staffTop, staffWidth);
    }
  }

  function _drawNote(step, refY, staffLeft, staffTop, staffWidth) {
    const noteY = refY - step * (LINE_SPACING / 2);
    const noteX = staffLeft + staffWidth * 0.58;

    _drawLedgerLines(step, noteX, refY);

    ctx.fillStyle   = '#4A90E2';
    ctx.strokeStyle = '#4A90E2';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.ellipse(noteX, noteY, NOTE_RX, NOTE_RY, NOTE_TILT, 0, Math.PI * 2);
    ctx.fill();

    // 符幹
    const stemLen = LINE_SPACING * 3.5;
    ctx.lineWidth   = 2;
    ctx.strokeStyle = '#4A90E2';
    ctx.beginPath();
    if (step < 4) {
      ctx.moveTo(noteX + NOTE_RX * 0.9, noteY - NOTE_RY * 0.3);
      ctx.lineTo(noteX + NOTE_RX * 0.9, noteY - stemLen);
    } else {
      ctx.moveTo(noteX - NOTE_RX * 0.9, noteY + NOTE_RY * 0.3);
      ctx.lineTo(noteX - NOTE_RX * 0.9, noteY + stemLen);
    }
    ctx.stroke();
  }

  function _drawLedgerLines(step, noteX, refY) {
    const ledgerHalfW = NOTE_RX * 2.6;
    ctx.strokeStyle   = '#c8c8e8';
    ctx.lineWidth     = 1.5;

    if (step <= -2) {
      for (let s = -2; s >= step; s -= 2) {
        const y = refY - s * (LINE_SPACING / 2);
        ctx.beginPath();
        ctx.moveTo(noteX - ledgerHalfW, y);
        ctx.lineTo(noteX + ledgerHalfW, y);
        ctx.stroke();
      }
    }
    if (step >= 10) {
      for (let s = 10; s <= step; s += 2) {
        const y = refY - s * (LINE_SPACING / 2);
        ctx.beginPath();
        ctx.moveTo(noteX - ledgerHalfW, y);
        ctx.lineTo(noteX + ledgerHalfW, y);
        ctx.stroke();
      }
    }
  }

  // ============================================================
  // クイズロジック
  // ============================================================

  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');

    _loadWeights();

    new ResizeObserver(() => {
      if (canvas.offsetWidth === 0) return;
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      drawStaff();
    }).observe(canvas.parentElement);

    canvas.width  = canvas.offsetWidth  || 400;
    canvas.height = canvas.offsetHeight || 200;
    drawStaff();
  }

  function start() {
    if (canvas.offsetWidth > 0) {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    session     = { count: 0, correct: 0, wrong: 0, times: [] };
    prevAbsStep = null;
    _buildDeck();
    _nextNote();
  }

  function _nextNote() {
    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }

    if (session.count >= SESSION_TOTAL) {
      currentNote = null;
      drawStaff();
      if (onSessionEndCb) onSessionEndCb({ ...session });
      return;
    }

    const nextMidi  = _sampleNote();
    prevAbsStep     = currentNote !== null ? _midiToAbs(currentNote) : null;
    currentNote     = nextMidi;
    currentClef     = _clefForNote(nextMidi);
    startTime       = Date.now();
    drawStaff();
  }

  function onNotePressed(midiNote) {
    if (!session || currentNote === null) return;

    const responseMs = Date.now() - startTime;
    const correct    = (midiNote === currentNote);
    const answered   = currentNote;

    session.count++;
    if (correct) {
      session.correct++;
      session.times.push(responseMs);
    } else {
      session.wrong++;
    }

    _updateWeight(answered, correct, responseMs);
    if (onAnswerCb) onAnswerCb(correct, responseMs, midiNote, answered);

    currentNote = null;
    feedbackTimer = setTimeout(_nextNote, correct ? FEEDBACK_CORRECT : FEEDBACK_WRONG);
  }

  function _updateWeight(note, correct, responseMs) {
    if (!correct) {
      weights[note] = Math.min(WEIGHT_MAX, weights[note] * WEIGHT_WRONG_MUL);
    } else if (responseMs < FAST_THRESHOLD_MS) {
      weights[note] = Math.max(WEIGHT_MIN, weights[note] * WEIGHT_FAST_MUL);
    } else if (responseMs > SLOW_THRESHOLD_MS) {
      weights[note] = Math.min(WEIGHT_MAX, weights[note] * WEIGHT_SLOW_MUL);
    }
    _saveWeights();
  }

  // ============================================================
  // ユーティリティ
  // ============================================================

  function getNoteLabel(midiNote, style) {
    const s      = style || styleRef;
    const DOREMI = ['ド','','レ','','ミ','ファ','','ソ','','ラ','','シ'];
    const CDEFG  = ['C', '', 'D', '', 'E', 'F',  '', 'G', '', 'A', '', 'B'];
    const name   = (s === 'doremi' ? DOREMI : CDEFG)[midiNote % 12];
    const octave = Math.floor(midiNote / 12) - 1;
    return name ? `${name}${octave}` : '';
  }

  function resetWeights() {
    [...TREBLE_NOTES, ...BASS_NOTES].forEach(n => { weights[n] = 1.0; });
    _saveWeights();
  }

  function setClefMode(mode) {
    clefMode    = mode;
    currentNote = null;
    _buildDeck();
    drawStaff();
  }

  function setNoteNameStyle(style) { styleRef = style; }
  function setOnAnswer(cb)         { onAnswerCb     = cb; }
  function setOnSessionEnd(cb)     { onSessionEndCb = cb; }
  function getCurrentNote()        { return currentNote; }
  function getSession()            { return session ? { ...session } : null; }
  function getWeights()            { return { ...weights }; }
  function getClefMode()           { return clefMode; }
  function isActive()              { return session !== null && session.count < SESSION_TOTAL; }

  return {
    init, start, onNotePressed,
    setNoteNameStyle, setClefMode, getClefMode, resetWeights,
    setOnAnswer, setOnSessionEnd,
    getCurrentNote, getSession, getWeights, getNoteLabel, isActive, drawStaff
  };
})();
