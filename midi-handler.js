// midi-handler.js
// Web MIDI API ラッパー
// KAWAI CX302 の Bluetooth MIDI / USB-MIDI 入力を処理する

const MidiHandler = (function () {
  let midiAccess = null;
  let selectedInput = null;

  // コールバック
  let onNoteOnCb = null;
  let onNoteOffCb = null;
  let onDeviceChangeCb = null;

  // ============================================================
  // 公開 API
  // ============================================================

  /**
   * Web MIDI API への接続を開始する。
   * @returns {Promise<boolean>} 接続成功なら true
   */
  async function connect() {
    if (!navigator.requestMIDIAccess) {
      alert(
        'このブラウザは Web MIDI API に対応していません。\n' +
        'Chrome または Edge をご使用ください。'
      );
      return false;
    }

    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      midiAccess.onstatechange = _onStateChange;
      _scanInputs();
      return true;
    } catch (err) {
      console.error('[MidiHandler] requestMIDIAccess 失敗:', err);
      alert(
        'MIDI の使用が許可されませんでした。\n' +
        'ブラウザの設定でこのページへの MIDI アクセスを許可してください。'
      );
      return false;
    }
  }

  /** NoteOn 時のコールバックを登録 (note: number, velocity: number) => void */
  function setOnNoteOn(cb) { onNoteOnCb = cb; }

  /** NoteOff 時のコールバックを登録 (note: number) => void */
  function setOnNoteOff(cb) { onNoteOffCb = cb; }

  /**
   * デバイス接続状態変化のコールバックを登録
   * (deviceName: string | null, connected: boolean) => void
   */
  function setOnDeviceChange(cb) { onDeviceChangeCb = cb; }

  /** 現在接続中のデバイス名を返す（未接続なら null） */
  function getDeviceName() {
    return selectedInput ? selectedInput.name : null;
  }

  // ============================================================
  // 内部処理
  // ============================================================

  /** MIDI 入力デバイスを検索して selectedInput に設定する */
  function _scanInputs() {
    if (!midiAccess) return;

    // 既存リスナーを解除
    if (selectedInput) {
      selectedInput.onmidimessage = null;
      selectedInput = null;
    }

    // KAWAI デバイスを優先し、なければ最初の入力を使う
    for (const input of midiAccess.inputs.values()) {
      const name = input.name.toLowerCase();
      if (name.includes('kawai') || name.includes('cx302') || name.includes('cx-302')) {
        selectedInput = input;
        break;
      }
    }

    if (!selectedInput) {
      const first = midiAccess.inputs.values().next().value;
      if (first) selectedInput = first;
    }

    if (selectedInput) {
      selectedInput.onmidimessage = _onMidiMessage;
      if (onDeviceChangeCb) onDeviceChangeCb(selectedInput.name, true);
    } else {
      if (onDeviceChangeCb) onDeviceChangeCb(null, false);
    }
  }

  /** デバイスの接続・切断イベント */
  function _onStateChange() {
    _scanInputs();
  }

  /** MIDI メッセージをパースして NoteOn / NoteOff コールバックを呼ぶ */
  function _onMidiMessage(event) {
    const data = event.data;
    if (!data || data.length < 2) return;

    const status   = data[0];
    const note     = data[1];
    const velocity = data.length > 2 ? data[2] : 0;
    const msgType  = status & 0xf0; // 上位 4 ビット = メッセージ種別

    if (msgType === 0x90 && velocity > 0) {
      // Note On
      if (onNoteOnCb) onNoteOnCb(note, velocity);
    } else if (msgType === 0x80 || (msgType === 0x90 && velocity === 0)) {
      // Note Off（velocity=0 の NoteOn も MIDI 仕様上 NoteOff 扱い）
      if (onNoteOffCb) onNoteOffCb(note);
    }
  }

  return { connect, setOnNoteOn, setOnNoteOff, setOnDeviceChange, getDeviceName };
})();
