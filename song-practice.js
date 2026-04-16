// song-practice.js
// 楽譜練習モード — 曲を見ながら弾き、手のポジション変化を学ぶ

const SongPractice = (function () {

  // ============================================================
  // 内蔵楽曲データ
  // midi: MIDI ノート番号 (0 = 休符)
  // posChange: true = 直前で手の位置移動が必要
  // pos: 手のポジション名
  // ============================================================
  const SONGS = {
    'ode-to-joy': {
      title:    '喜びの歌',
      composer: 'ベートーヴェン',
      source:   '大人のためのPiano Study Step1',
      notes: [
        // ──── A部（ドのポジション: C4〜G4）────
        { midi: 64, pos: 'ドポジション' },   // E4
        { midi: 64, pos: 'ドポジション' },   // E4
        { midi: 65, pos: 'ドポジション' },   // F4
        { midi: 67, pos: 'ドポジション' },   // G4
        { midi: 67, pos: 'ドポジション' },   // G4
        { midi: 65, pos: 'ドポジション' },   // F4
        { midi: 64, pos: 'ドポジション' },   // E4
        { midi: 62, pos: 'ドポジション' },   // D4
        { midi: 60, pos: 'ドポジション' },   // C4
        { midi: 60, pos: 'ドポジション' },   // C4
        { midi: 62, pos: 'ドポジション' },   // D4
        { midi: 64, pos: 'ドポジション' },   // E4
        { midi: 64, pos: 'ドポジション' },   // E4
        { midi: 62, pos: 'ドポジション' },   // D4
        { midi: 62, pos: 'ドポジション' },   // D4
        // ──── A部 繰り返し ────
        { midi: 64, pos: 'ドポジション' },
        { midi: 64, pos: 'ドポジション' },
        { midi: 65, pos: 'ドポジション' },
        { midi: 67, pos: 'ドポジション' },
        { midi: 67, pos: 'ドポジション' },
        { midi: 65, pos: 'ドポジション' },
        { midi: 64, pos: 'ドポジション' },
        { midi: 62, pos: 'ドポジション' },
        { midi: 60, pos: 'ドポジション' },
        { midi: 60, pos: 'ドポジション' },
        { midi: 62, pos: 'ドポジション' },
        { midi: 64, pos: 'ドポジション' },
        { midi: 62, pos: 'ドポジション' },
        { midi: 60, pos: 'ドポジション' },
        { midi: 60, pos: 'ドポジション' },
        // ──── B部（ドポジション → 一時ソポジション）────
        { midi: 62, pos: 'ドポジション' },
        { midi: 62, pos: 'ドポジション' },
        { midi: 64, pos: 'ドポジション' },
        { midi: 60, pos: 'ドポジション' },
        { midi: 62, pos: 'ドポジション' },
        { midi: 64, pos: 'ドポジション', posChange: true, posNext: 'ソポジション' }, // ここから指を伸ばす
        { midi: 65, pos: 'ドポジション' },
        { midi: 64, pos: 'ドポジション' },
        { midi: 60, pos: 'ドポジション' },
        { midi: 62, pos: 'ドポジション' },
        { midi: 64, pos: 'ドポジション', posChange: true, posNext: 'ソポジション' },
        { midi: 65, pos: 'ドポジション' },
        { midi: 64, pos: 'ドポジション' },
        { midi: 62, pos: 'ドポジション' },
        { midi: 60, pos: 'ドポジション' },
        { midi: 62, pos: 'ドポジション' },
        { midi: 55, pos: 'ソポジション', posChange: true, posNext: 'ソポジション' }, // G3: 手を移動！
        // ──── A部 最終 ────
        { midi: 64, pos: 'ドポジション', posChange: true, posNext: 'ドポジション' }, // 戻る
        { midi: 64, pos: 'ドポジション' },
        { midi: 65, pos: 'ドポジション' },
        { midi: 67, pos: 'ドポジション' },
        { midi: 67, pos: 'ドポジション' },
        { midi: 65, pos: 'ドポジション' },
        { midi: 64, pos: 'ドポジション' },
        { midi: 62, pos: 'ドポジション' },
        { midi: 60, pos: 'ドポジション' },
        { midi: 60, pos: 'ドポジション' },
        { midi: 62, pos: 'ドポジション' },
        { midi: 64, pos: 'ドポジション' },
        { midi: 62, pos: 'ドポジション' },
        { midi: 60, pos: 'ドポジション' },
        { midi: 60, pos: 'ドポジション' },
      ]
    }
  };

  // ============================================================
  // 描画定数
  // ============================================================
  const LINE_SPACING = 18;
  const NOTE_RX      = LINE_SPACING * 0.48;
  const NOTE_RY      = LINE_SPACING * 0.36;
  const NOTE_TILT    = -0.25;
  const DIATONIC     = [0,0,1,1,2,3,3,4,4,5,5,6];
  const E4_ABS       = 30;

  // ============================================================
  // 状態
  // ============================================================
  let canvas        = null;
  let ctx           = null;
  let styleRef      = 'doremi';
  let currentSong   = null;
  let noteIndex     = 0;   // 現在弾くべきノートのインデックス
  let isWaiting     = true; // 正しい音符を待っている
  let stats         = null;
  let feedbackTimer = null;
  let lastFeedback  = null; // 'correct' | 'wrong' | null
  let onFinishCb    = null;
  let onAnswerCb    = null;

  // ============================================================
  // 全音階ステップ計算
  // ============================================================

  function _midiToStepTreble(midiNote) {
    const noteInOct = midiNote % 12;
    const octave    = Math.floor(midiNote / 12) - 1;
    return octave * 7 + DIATONIC[noteInOct] - E4_ABS;
  }

  // ============================================================
  // 楽曲管理
  // ============================================================

  function getSongList() {
    return Object.entries(SONGS).map(([id, s]) => ({ id, title: s.title, composer: s.composer }));
  }

  function loadSong(id) {
    currentSong = SONGS[id] || null;
    noteIndex   = 0;
    isWaiting   = true;
    lastFeedback= null;
    stats       = { total: 0, correct: 0, wrong: 0 };
    if (currentSong) drawPractice();
  }

  function loadCustomNotes(title, midiNotes) {
    currentSong = {
      title,
      composer: 'MIDIファイル',
      notes: midiNotes.map(m => ({ midi: m, pos: '' }))
    };
    noteIndex   = 0;
    isWaiting   = true;
    lastFeedback= null;
    stats       = { total: 0, correct: 0, wrong: 0 };
    drawPractice();
  }

  function getCurrentTarget() {
    if (!currentSong || noteIndex >= currentSong.notes.length) return null;
    return currentSong.notes[noteIndex];
  }

  // ============================================================
  // 入力処理
  // ============================================================

  function onNotePressed(midiNote) {
    if (!currentSong || !isWaiting) return;
    const target = getCurrentTarget();
    if (!target) return;

    // 休符はスキップ
    if (target.midi === 0) { _advance(); return; }

    const correct = (midiNote === target.midi);
    stats.total++;
    if (correct) {
      stats.correct++;
      lastFeedback = 'correct';
    } else {
      stats.wrong++;
      lastFeedback = 'wrong';
    }

    if (onAnswerCb) onAnswerCb(correct, midiNote, target.midi);

    drawPractice();

    if (correct) {
      // 正解: 少し待ってから次へ
      isWaiting = false;
      if (feedbackTimer) clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => {
        _advance();
        isWaiting = true;
        lastFeedback = null;
        drawPractice();
      }, 600);
    }
    // 不正解: そのまま待つ（ユーザーが正解を押すまで進まない）
  }

  function _advance() {
    noteIndex++;
    // 休符はさらにスキップ
    while (currentSong && noteIndex < currentSong.notes.length && currentSong.notes[noteIndex].midi === 0) {
      noteIndex++;
    }
    if (!currentSong || noteIndex >= currentSong.notes.length) {
      // 曲終了
      if (onFinishCb) onFinishCb({ ...stats });
    }
  }

  // ============================================================
  // 描画
  // ============================================================

  function drawPractice() {
    if (!canvas || !ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (!currentSong) {
      ctx.fillStyle    = '#7a7a9a';
      ctx.font         = '14px sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('曲を選んでください', W / 2, H / 2);
      return;
    }

    const song   = currentSong;
    const target = getCurrentTarget();
    const done   = noteIndex >= song.notes.length;

    // 進捗バー
    const progress = song.notes.length > 0 ? noteIndex / song.notes.length : 1;
    ctx.fillStyle = '#2a2a45';
    ctx.fillRect(0, H - 4, W, 4);
    ctx.fillStyle = '#4A90E2';
    ctx.fillRect(0, H - 4, W * progress, 4);

    if (done) {
      // 完了画面
      ctx.fillStyle    = '#80f080';
      ctx.font         = 'bold 20px sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('完奏！', W / 2, H / 2 - 16);
      ctx.fillStyle = '#7a7a9a';
      ctx.font      = '14px sans-serif';
      ctx.fillText(`正解率 ${stats.total > 0 ? Math.round(stats.correct / stats.total * 100) : 100}%`, W / 2, H / 2 + 14);
      return;
    }

    // ── 五線譜描画 ──
    const staffCenterY = H * 0.46;
    const staffTop     = staffCenterY - 2 * LINE_SPACING;
    const staffLeft    = 68;
    const staffWidth   = W - staffLeft - 30;

    ctx.strokeStyle = '#c8c8e8';
    ctx.lineWidth   = 1.5;
    for (let i = 0; i < 5; i++) {
      const y = staffTop + i * LINE_SPACING;
      ctx.beginPath();
      ctx.moveTo(staffLeft, y);
      ctx.lineTo(staffLeft + staffWidth, y);
      ctx.stroke();
    }

    // ト音記号
    ctx.font         = `${LINE_SPACING * 4.8}px 'Times New Roman', serif`;
    ctx.fillStyle    = '#c8c8e8';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('\uD834\uDD1E', staffLeft + 3, staffTop + LINE_SPACING * 4.8);

    const refY     = staffTop + 4 * LINE_SPACING;
    const noteXBase = staffLeft + staffWidth * 0.45;

    // ── 先行音符（次の最大 4 音を薄く表示）──
    const previewCount = Math.min(4, song.notes.length - noteIndex - 1);
    for (let k = 1; k <= previewCount; k++) {
      const ni = song.notes[noteIndex + k];
      if (!ni || ni.midi === 0) continue;
      const step  = _midiToStepTreble(ni.midi);
      const nx    = noteXBase + k * (LINE_SPACING * 2.4);
      const alpha = Math.max(0.15, 0.45 - k * 0.08);
      _drawNoteAt(step, refY, nx, `rgba(200,200,220,${alpha})`, false);
    }

    // ── 現在音符（大きく鮮明に）──
    if (target && target.midi !== 0) {
      const step   = _midiToStepTreble(target.midi);
      let color    = '#4A90E2';
      if (lastFeedback === 'correct') color = '#4CAF50';
      if (lastFeedback === 'wrong')   color = '#F44336';
      _drawNoteAt(step, refY, noteXBase, color, true);
    }

    // ── 手のポジション表示 ──
    if (target && target.pos) {
      const isChange = target.posChange;
      ctx.font         = `bold 12px sans-serif`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle    = isChange ? '#FFC107' : '#7a7a9a';
      const posText = isChange ? `⚡ 手を移動: ${target.posNext || target.pos}` : target.pos;
      ctx.fillText(posText, staffLeft, 4);
    }
  }

  function _drawNoteAt(step, refY, noteX, color, drawLedger) {
    const noteY = refY - step * (LINE_SPACING / 2);

    // 加線
    if (drawLedger) {
      const ledgerHalfW = NOTE_RX * 2.6;
      ctx.strokeStyle = '#c8c8e8';
      ctx.lineWidth   = 1.5;
      if (step <= -2) {
        for (let s = -2; s >= step; s -= 2) {
          const y = refY - s * (LINE_SPACING / 2);
          ctx.beginPath(); ctx.moveTo(noteX - ledgerHalfW, y); ctx.lineTo(noteX + ledgerHalfW, y); ctx.stroke();
        }
      }
      if (step >= 10) {
        for (let s = 10; s <= step; s += 2) {
          const y = refY - s * (LINE_SPACING / 2);
          ctx.beginPath(); ctx.moveTo(noteX - ledgerHalfW, y); ctx.lineTo(noteX + ledgerHalfW, y); ctx.stroke();
        }
      }
    }

    // 符頭
    ctx.fillStyle   = color;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.ellipse(noteX, noteY, NOTE_RX, NOTE_RY, NOTE_TILT, 0, Math.PI * 2);
    ctx.fill();

    // 符幹
    if (drawLedger) {
      const stemLen = LINE_SPACING * 3.5;
      ctx.lineWidth = 2;
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
  }

  // ============================================================
  // 初期化 / リセット
  // ============================================================

  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');

    new ResizeObserver(() => {
      if (canvas.offsetWidth === 0) return;
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      drawPractice();
    }).observe(canvas.parentElement);

    canvas.width  = canvas.offsetWidth  || 400;
    canvas.height = canvas.offsetHeight || 200;
    drawPractice();
  }

  function restart() {
    if (!currentSong) return;
    noteIndex    = 0;
    isWaiting    = true;
    lastFeedback = null;
    stats        = { total: 0, correct: 0, wrong: 0 };
    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
    drawPractice();
  }

  function setNoteNameStyle(style) { styleRef = style; }
  function setOnFinish(cb)         { onFinishCb  = cb; }
  function setOnAnswer(cb)         { onAnswerCb  = cb; }
  function getStats()              { return stats ? { ...stats } : null; }
  function getCurrentSong()        { return currentSong; }
  function getNoteIndex()          { return noteIndex; }

  return {
    init, loadSong, loadCustomNotes, restart,
    onNotePressed, getSongList,
    setNoteNameStyle, setOnFinish, setOnAnswer,
    getStats, getCurrentSong, getNoteIndex, drawPractice
  };
})();
