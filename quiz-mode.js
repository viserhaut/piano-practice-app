// quiz-mode.js
// 音符クイズモード — 音符 → 鍵盤の瞬間認識を訓練する
//
// 仕組み:
//   1. 五線譜に音符を1つ表示する
//   2. ユーザーが対応する鍵盤を押す
//   3. 即座に正誤 + 応答時間を表示する
//   4. スペースドリピティションで苦手な音符を多く出題する

const QuizMode = (function () {

  // ============================================================
  // 定数
  // ============================================================

  // 出題音符: C4〜G5 (バイエルレベル、ト音記号の基本音域)
  const QUIZ_NOTES = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79];
  //                  C4  D4  E4  F4  G4  A4  B4  C5  D5  E5  F5  G5

  // 各 MIDI noteInOctave (0〜11) → その音の1オクターブ内の全音階順位 (0=C)
  // 黒鍵は前の白鍵と同じ値（使う場面はないが配列インデックスを合わせるため）
  const DIATONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

  // E4 (MIDI 64) の全音階絶対値 = 4 octaves * 7 notes + 2 (E is 3rd white key from C)
  const E4_ABS = 4 * 7 + 2; // = 30

  // 五線譜描画パラメータ
  const LINE_SPACING = 18; // 隣接する線の間隔 (px)
  const NOTE_RX     = LINE_SPACING * 0.50; // 符頭の横半径
  const NOTE_RY     = LINE_SPACING * 0.38; // 符頭の縦半径
  const NOTE_TILT   = -0.25; // 符頭の傾き (ラジアン)

  // フィードバック表示時間 (ms)
  const FEEDBACK_CORRECT = 800;
  const FEEDBACK_WRONG   = 1500;

  // スペースドリピティション パラメータ
  const WEIGHT_MIN         = 0.3;
  const WEIGHT_MAX         = 5.0;
  const WEIGHT_FAST_MUL    = 0.8;  // 正解 & 速い (< 2s)
  const WEIGHT_SLOW_MUL    = 1.15; // 正解 & 遅い (> 4s)
  const WEIGHT_WRONG_MUL   = 1.6;  // 不正解
  const FAST_THRESHOLD_MS  = 2000;
  const SLOW_THRESHOLD_MS  = 4000;

  // セッション問題数
  const SESSION_TOTAL = 20;

  // ============================================================
  // 状態
  // ============================================================
  let canvas      = null;
  let ctx         = null;
  let styleRef    = 'doremi'; // 現在の音名スタイル (app.js と同期)

  let currentNote  = null;  // 現在表示中の MIDI ノート番号 (null = 待機中)
  let startTime    = null;  // 音符を表示した時刻
  let weights      = {};    // 各音符の重み { midiNote: number }
  let session      = null;  // セッション統計
  let feedbackTimer = null; // setTimeout ハンドル

  // コールバック
  let onAnswerCb     = null; // (correct: bool, responseMs: number, pressed: number) => void
  let onSessionEndCb = null; // (session: object) => void

  // ============================================================
  // 五線譜描画
  // ============================================================

  /** MIDI ノート番号 → ト音記号 E4 線からの半音程ステップ数 */
  function midiToStep(midiNote) {
    const noteInOct = midiNote % 12;
    const octave    = Math.floor(midiNote / 12) - 1;
    const abs       = octave * 7 + DIATONIC[noteInOct];
    return abs - E4_ABS;
  }

  /** 五線譜 + 音符を Canvas に描画する */
  function drawStaff() {
    if (!canvas || !ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // 五線譜を縦方向の中心より少し上に配置
    const staffCenterY = H * 0.48;
    // staffCenterY は 3 本目の線 (B4) の y 座標
    // 上から: F5(0), E5(1/2), D5(1), C5(3/2), B4(2), A4(5/2), G4(3), F4(7/2), E4(4)
    // top line (F5) = staffCenterY - 2 * LINE_SPACING
    const staffTop  = staffCenterY - 2 * LINE_SPACING;
    const staffLeft = 70;
    const staffWidth= W - staffLeft - 30;

    // 五線 (5本)
    ctx.strokeStyle = '#c8c8e8';
    ctx.lineWidth   = 1.5;
    for (let i = 0; i < 5; i++) {
      const y = staffTop + i * LINE_SPACING;
      ctx.beginPath();
      ctx.moveTo(staffLeft, y);
      ctx.lineTo(staffLeft + staffWidth, y);
      ctx.stroke();
    }

    // ト音記号 (Unicode 𝄞 U+1D11E)
    // 一部フォントで表示されない場合のフォールバック付き
    ctx.font          = `${LINE_SPACING * 4.8}px 'Times New Roman', serif`;
    ctx.fillStyle     = '#c8c8e8';
    ctx.textAlign     = 'left';
    ctx.textBaseline  = 'bottom';
    ctx.fillText('\uD834\uDD1E', staffLeft + 3, staffTop + LINE_SPACING * 4.8);

    // 音符を描画
    if (currentNote !== null) {
      _drawNote(currentNote, staffLeft, staffTop, staffWidth);
    }
  }

  /** 1 つの音符（符頭 + 符幹 + 加線）を描画する */
  function _drawNote(midiNote, staffLeft, staffTop, staffWidth) {
    const step  = midiToStep(midiNote);

    // E4 (step=0) の y 座標: staffTop + 4 * LINE_SPACING
    const e4Y   = staffTop + 4 * LINE_SPACING;
    const noteY = e4Y - step * (LINE_SPACING / 2);
    const noteX = staffLeft + staffWidth * 0.58;

    // 加線 (ledger lines)
    _drawLedgerLines(step, noteX, e4Y, staffTop);

    // 符頭
    ctx.fillStyle   = '#4A90E2';
    ctx.strokeStyle = '#4A90E2';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.ellipse(noteX, noteY, NOTE_RX, NOTE_RY, NOTE_TILT, 0, Math.PI * 2);
    ctx.fill();

    // 符幹 (step < 4 → 上向き、それ以上 → 下向き)
    const stemLen = LINE_SPACING * 3.5;
    ctx.lineWidth = 2;
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

  /** 加線が必要な音符に加線を描画する */
  function _drawLedgerLines(step, noteX, e4Y, staffTop) {
    const ledgerHalfW = NOTE_RX * 2.6;
    ctx.strokeStyle = '#c8c8e8';
    ctx.lineWidth   = 1.5;

    if (step <= -2) {
      // E4 より下 (C4 以下): ステップ -2, -4, ... に加線
      for (let s = -2; s >= step; s -= 2) {
        const y = e4Y - s * (LINE_SPACING / 2);
        ctx.beginPath();
        ctx.moveTo(noteX - ledgerHalfW, y);
        ctx.lineTo(noteX + ledgerHalfW, y);
        ctx.stroke();
      }
    }

    if (step >= 10) {
      // F5 より上: ステップ 10, 12, ... に加線
      for (let s = 10; s <= step; s += 2) {
        const y = e4Y - s * (LINE_SPACING / 2);
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

  /** Canvas を初期化する */
  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');

    // 初期重み
    QUIZ_NOTES.forEach(n => { weights[n] = 1.0; });

    // リサイズ対応（hidden 中は offsetWidth=0 になるためスキップ）
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

  /** セッションを開始して最初の音符を表示する */
  function start() {
    // 非表示中に初期化されていた場合はここで Canvas サイズを再計算
    if (canvas.offsetWidth > 0) {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    session = { count: 0, correct: 0, wrong: 0, times: [] };
    _nextNote();
  }

  /** 次の音符をランダムに選んで表示する */
  function _nextNote() {
    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }

    if (session.count >= SESSION_TOTAL) {
      currentNote = null;
      drawStaff();
      if (onSessionEndCb) onSessionEndCb({ ...session });
      return;
    }

    currentNote = _sampleNote();
    startTime   = Date.now();
    drawStaff();
  }

  /**
   * 重みに比例した確率で出題する音符を選ぶ。
   * 直前の音符は連続しないようにする。
   */
  function _sampleNote() {
    const prev  = currentNote;
    const notes = prev !== null
      ? QUIZ_NOTES.filter(n => n !== prev)
      : QUIZ_NOTES;

    const total = notes.reduce((s, n) => s + weights[n], 0);
    let rand = Math.random() * total;
    for (const note of notes) {
      rand -= weights[note];
      if (rand <= 0) return note;
    }
    return notes[notes.length - 1];
  }

  /**
   * ユーザーが鍵盤を押したときに呼び出す。
   * currentNote が null（フィードバック表示中）のときは無視する。
   */
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

    // コールバック → app.js がフィードバック UI を更新する
    if (onAnswerCb) onAnswerCb(correct, responseMs, midiNote, answered);

    // currentNote を null にして二重入力を防ぐ
    currentNote = null;

    // フィードバック後に次の音符へ
    const delay = correct ? FEEDBACK_CORRECT : FEEDBACK_WRONG;
    feedbackTimer = setTimeout(_nextNote, delay);
  }

  /** 重みを更新する（スペースドリピティション） */
  function _updateWeight(note, correct, responseMs) {
    if (!correct) {
      weights[note] = Math.min(WEIGHT_MAX, weights[note] * WEIGHT_WRONG_MUL);
    } else if (responseMs < FAST_THRESHOLD_MS) {
      weights[note] = Math.max(WEIGHT_MIN, weights[note] * WEIGHT_FAST_MUL);
    } else if (responseMs > SLOW_THRESHOLD_MS) {
      weights[note] = Math.min(WEIGHT_MAX, weights[note] * WEIGHT_SLOW_MUL);
    }
  }

  // ============================================================
  // ユーティリティ
  // ============================================================

  /** 音符の名前ラベルを返す (例: "ド4", "C4") */
  function getNoteLabel(midiNote, style) {
    const s = style || styleRef;
    const DOREMI = ['ド','','レ','','ミ','ファ','','ソ','','ラ','','シ'];
    const CDEFG  = ['C', '', 'D', '', 'E', 'F',  '', 'G', '', 'A', '', 'B'];
    const name   = (s === 'doremi' ? DOREMI : CDEFG)[midiNote % 12];
    const octave = Math.floor(midiNote / 12) - 1;
    return name ? `${name}${octave}` : '';
  }

  function setNoteNameStyle(style) { styleRef = style; }
  function setOnAnswer(cb)     { onAnswerCb     = cb; }
  function setOnSessionEnd(cb) { onSessionEndCb = cb; }
  function getCurrentNote()    { return currentNote; }
  function getSession()        { return session ? { ...session } : null; }
  function getWeights()        { return { ...weights }; }
  function isActive()          { return session !== null && session.count < SESSION_TOTAL; }

  return {
    init, start, onNotePressed,
    setNoteNameStyle, setOnAnswer, setOnSessionEnd,
    getCurrentNote, getSession, getWeights, getNoteLabel, isActive, drawStaff
  };
})();
