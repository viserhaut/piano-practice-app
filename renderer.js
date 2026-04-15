// renderer.js
// Canvas によるバーチャルキーボード描画
// 88鍵（MIDI 21: A0 〜 MIDI 108: C8）に対応

const Renderer = (function () {
  // ============================================================
  // 定数
  // ============================================================
  const MIDI_MIN = 21;  // A0
  const MIDI_MAX = 108; // C8
  const WHITE_KEY_COUNT = 52;

  // 1オクターブ内 (0=C) で黒鍵になる音程
  const BLACK_OFFSETS = new Set([1, 3, 6, 8, 10]); // C# D# F# G# A#

  // 音名テーブル（黒鍵は ''）
  const NAMES_DOREMI = ['ド','','レ','','ミ','ファ','','ソ','','ラ','','シ'];
  const NAMES_CDEFG  = ['C', '', 'D', '', 'E', 'F',  '', 'G', '', 'A', '', 'B'];

  // ============================================================
  // 状態
  // ============================================================
  let canvas = null;
  let ctx = null;
  let keyLayout = {};       // MIDI番号 → {x,y,w,h,isBlack}
  let activeNotes = new Set();
  let noteNameStyle = 'doremi'; // 'doremi' | 'cdefg'

  // ============================================================
  // 公開 API
  // ============================================================

  /** Canvas を初期化してリサイズ監視を開始する */
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    _resize();
    window.addEventListener('resize', _resize);
  }

  /** 現在押鍵中の音をまとめて更新する */
  function setActiveNotes(notes) {
    activeNotes = new Set(notes);
    _draw();
  }

  /** 単一ノートを押鍵状態にする */
  function addNote(midiNote) {
    activeNotes.add(midiNote);
    _draw();
  }

  /** 単一ノートを離鍵状態にする */
  function removeNote(midiNote) {
    activeNotes.delete(midiNote);
    _draw();
  }

  /** 音名スタイルを切り替えて再描画する */
  function setNoteNameStyle(style) {
    noteNameStyle = style;
    _draw();
  }

  /**
   * MIDI ノート番号から表示用の音名ラベルを返す
   * 例: 60 → "ド4"（doremi）/ "C4"（cdefg）
   */
  function getNoteLabel(midiNote) {
    const offset = midiNote % 12;
    const names  = noteNameStyle === 'doremi' ? NAMES_DOREMI : NAMES_CDEFG;
    const name   = names[offset];
    if (!name) return ''; // 黒鍵はラベルなし
    const octave = Math.floor(midiNote / 12) - 1;
    return `${name}${octave}`;
  }

  // ============================================================
  // 内部処理
  // ============================================================

  function _isBlack(midiNote) {
    return BLACK_OFFSETS.has(midiNote % 12);
  }

  /** ウィンドウリサイズ時に Canvas サイズを合わせてレイアウトを再計算する */
  function _resize() {
    if (!canvas) return;
    const container = canvas.parentElement;
    canvas.width  = container.clientWidth;
    canvas.height = container.clientHeight;
    _buildLayout();
    _draw();
  }

  /**
   * 全鍵盤の座標を計算して keyLayout に格納する。
   * 白鍵 → 黒鍵の順で 2 パスで処理する。
   */
  function _buildLayout() {
    const W  = canvas.width;
    const H  = canvas.height;
    const ww = W / WHITE_KEY_COUNT; // 白鍵の幅
    const wh = H;                   // 白鍵の高さ
    const bw = Math.max(8, Math.floor(ww * 0.58));
    const bh = Math.floor(wh * 0.62);

    keyLayout = {};

    // パス 1: 白鍵
    let wi = 0;
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      if (!_isBlack(m)) {
        keyLayout[m] = {
          x: Math.round(wi * ww),
          y: 0,
          w: Math.round(ww) - 1, // 1px の隙間
          h: wh,
          isBlack: false
        };
        wi++;
      }
    }

    // パス 2: 黒鍵（前後の白鍵の中央に配置）
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      if (_isBlack(m)) {
        const prev = keyLayout[m - 1]; // 必ず白鍵
        const next = keyLayout[m + 1]; // 必ず白鍵
        if (prev && next) {
          // 前白鍵の右端を基準に中央配置
          const cx = prev.x + prev.w;
          keyLayout[m] = {
            x: Math.round(cx - bw / 2),
            y: 0,
            w: bw,
            h: bh,
            isBlack: true
          };
        }
      }
    }
  }

  /** 全鍵盤を描画する（白 → 黒の順に描画して重なりを正しく表示） */
  function _draw() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 白鍵を先に描画
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      if (!_isBlack(m)) _drawKey(m);
    }
    // 黒鍵を後から描画（白鍵の上に重ねる）
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
      if (_isBlack(m)) _drawKey(m);
    }
  }

  /** 1 鍵盤を描画する */
  function _drawKey(midiNote) {
    const key = keyLayout[midiNote];
    if (!key) return;

    const isActive = activeNotes.has(midiNote);
    const { x, y, w, h, isBlack } = key;

    ctx.save();

    if (isBlack) {
      // ── 黒鍵 ──
      ctx.fillStyle = isActive ? '#4A90E2' : '#1c1c1c';
      _fillRoundRect(ctx, x, y, w, h, [0, 0, 4, 4]);

      // 非アクティブ時: 上部にハイライト（立体感）
      if (!isActive) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        _fillRoundRect(ctx, x + 1, y + 1, w - 2, h * 0.4, [0, 0, 2, 2]);
      }
    } else {
      // ── 白鍵 ──
      // 外枠（影として機能）
      ctx.fillStyle = '#aaa';
      ctx.fillRect(x, y, w + 1, h);

      // 本体
      ctx.fillStyle = isActive ? '#4A90E2' : '#f8f8f8';
      ctx.fillRect(x, y, w, h - 2);

      // 音名ラベル（白鍵のみ）
      _drawNoteLabel(midiNote, x, y, w, h, isActive);
    }

    ctx.restore();
  }

  /** 白鍵の底部に音名ラベルを描画する */
  function _drawNoteLabel(midiNote, x, y, w, h, isActive) {
    const offset = midiNote % 12;
    const names  = noteNameStyle === 'doremi' ? NAMES_DOREMI : NAMES_CDEFG;
    const name   = names[offset];
    if (!name) return;

    const octave     = Math.floor(midiNote / 12) - 1;
    const isCNote    = offset === 0; // C / ド 音（オクターブ番号を表示）
    const label      = isCNote ? `${name}${octave}` : name;
    const fontSize   = Math.max(9, Math.floor(w * 0.42));

    ctx.font         = `bold ${fontSize}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';

    if (isActive) {
      ctx.fillStyle = '#fff';
    } else if (isCNote) {
      ctx.fillStyle = '#444'; // C 音は少し目立たせる
    } else {
      ctx.fillStyle = '#999';
    }

    ctx.fillText(label, x + w / 2, h - 5);
  }

  /**
   * 角丸矩形を描画するユーティリティ。
   * @param {number[]} radii [tl, tr, br, bl] 各コーナーの半径
   */
  function _fillRoundRect(ctx, x, y, w, h, radii) {
    const [tl, tr, br, bl] = radii;
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
    ctx.lineTo(x + w, y + h - br);
    ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    ctx.lineTo(x + bl, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
    ctx.lineTo(x, y + tl);
    ctx.quadraticCurveTo(x, y, x + tl, y);
    ctx.closePath();
    ctx.fill();
  }

  return { init, setActiveNotes, addNote, removeNote, setNoteNameStyle, getNoteLabel };
})();
