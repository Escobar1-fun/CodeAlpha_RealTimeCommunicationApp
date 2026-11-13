import { AUDIO_CONSTRAINTS, VIDEO_CONSTRAINTS, describeMediaError } from './media';
import { rtc } from './native';

/**
 * Native port of the web client's mesh call; both speak the same protocol.
 * Each connection has four fixed transceivers. The later joiner makes the one offer
 * that sets them up, and after that media changes are only replaceTrack() on a slot.
 * In Expo Go there is no WebRTC, so peers are presence-only.
 */
const SLOT = { MIC: 0, CAMERA: 1, SCREEN_VIDEO: 2, SCREEN_AUDIO: 3 };
const SLOT_KINDS = ['audio', 'video', 'video', 'audio'];
const MAX_ICE_RESTARTS = 5;

export class MeshCall {
  constructor(socket, stream) {
    this.socket = socket;
    this.iceServers = [];
    this.peers = new Map();
    this.listeners = new Set();

    this.tracks = [stream?.getAudioTracks()[0] ?? null, stream?.getVideoTracks()[0] ?? null, null, null];
    this.audioOn = Boolean(this.tracks[SLOT.MIC]?.enabled);
    this.videoOn = Boolean(this.tracks[SLOT.CAMERA]);
    this.localStream = stream ?? null;

    this.onPeerJoined = (info) => {
      this.#createPeer(info, false);
      this.#changed();
    };
    this.onPeerLeft = ({ id }) => {
      this.#closePeer(id);
      this.#changed();
    };
    this.onMediaState = ({ id, media }) => {
      const peer = this.peers.get(id);
      if (!peer) return;
      peer.media = media;
      this.#changed();
    };
    this.onSignal = (message) => {
      const peer = this.peers.get(message.from);
      if (peer?.pc) this.#enqueue(peer, () => this.#applySignal(peer, message));
    };

    socket.on('peer:joined', this.onPeerJoined);
    socket.on('peer:left', this.onPeerLeft);
    socket.on('media:state', this.onMediaState);
    socket.on('signal', this.onSignal);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #changed() {
    this.listeners.forEach((listener) => listener());
  }

  get media() {
    return { audio: this.audioOn, video: this.videoOn, screen: Boolean(this.tracks[SLOT.SCREEN_VIDEO]) };
  }

  get peerList() {
    return [...this.peers.values()];
  }

  /** Called after each successful room:join, including rejoins after a reconnect. */
  start({ peers, iceServers }) {
    this.iceServers = iceServers;
    [...this.peers.keys()].forEach((id) => this.#closePeer(id));
    for (const info of peers) {
      const peer = this.#createPeer(info, true);
      if (peer.pc) this.#enqueue(peer, () => this.#sendOffer(peer));
    }
    this.#changed();
  }

  destroy() {
    this.socket.off('peer:joined', this.onPeerJoined);
    this.socket.off('peer:left', this.onPeerLeft);
    this.socket.off('media:state', this.onMediaState);
    this.socket.off('signal', this.onSignal);
    [...this.peers.keys()].forEach((id) => this.#closePeer(id));
    this.tracks.forEach((track) => track?.stop());
    this.listeners.clear();
  }

  #createPeer({ id, user, media }, initiator) {
    const peer = {
      id,
      user,
      media,
      pc: null,
      initiator,
      state: 'connecting',
      slots: null,
      cameraStream: null,
      screenStream: null,
      queue: Promise.resolve(),
      pendingCandidates: [],
      iceRestarts: 0,
    };
    this.peers.set(id, peer);
    if (!rtc) return peer;

    const pc = new rtc.RTCPeerConnection({ iceServers: this.iceServers });
    peer.pc = pc;
    if (initiator) {
      SLOT_KINDS.forEach((kind) => pc.addTransceiver(kind, { direction: 'sendrecv' }));
      this.#bindSlots(peer);
    }

    pc.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) this.socket.emit('signal', { to: id, candidate: candidate.toJSON() });
    });
    pc.addEventListener('connectionstatechange', () => {
      peer.state = pc.connectionState;
      if (pc.connectionState === 'connected') peer.iceRestarts = 0;
      // Only the original offerer restarts, so the two sides never offer at once.
      if (pc.connectionState === 'failed' && initiator && peer.iceRestarts < MAX_ICE_RESTARTS) {
        peer.iceRestarts += 1;
        this.#enqueue(peer, () => this.#sendOffer(peer, { iceRestart: true }));
      }
      this.#changed();
    });
    return peer;
  }

  #closePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc?.close();
    this.peers.delete(id);
  }

  /** Signals are applied strictly in arrival order, one at a time, per peer. */
  #enqueue(peer, task) {
    peer.queue = peer.queue.then(task).catch((err) => console.error('WebRTC signaling error:', err));
  }

  #bindSlots(peer) {
    peer.slots = peer.pc.getTransceivers().slice(0, SLOT_KINDS.length);
    const track = (slot) => peer.slots[slot].receiver.track;
    peer.cameraStream = new rtc.MediaStream([track(SLOT.MIC), track(SLOT.CAMERA)]);
    peer.screenStream = new rtc.MediaStream([track(SLOT.SCREEN_VIDEO), track(SLOT.SCREEN_AUDIO)]);
    peer.slots.forEach((transceiver, slot) => {
      transceiver.direction = 'sendrecv';
      if (this.tracks[slot]) transceiver.sender.replaceTrack(this.tracks[slot]);
    });
  }

  async #sendOffer(peer, options) {
    await peer.pc.setLocalDescription(await peer.pc.createOffer(options));
    this.#sendDescription(peer);
  }

  #sendDescription(peer) {
    const { type, sdp } = peer.pc.localDescription;
    this.socket.emit('signal', { to: peer.id, description: { type, sdp } });
  }

  async #applySignal(peer, { description, candidate }) {
    const { pc } = peer;
    if (candidate) {
      if (!pc.remoteDescription) peer.pendingCandidates.push(candidate);
      else await pc.addIceCandidate(candidate);
      return;
    }

    await pc.setRemoteDescription(description);
    for (const pending of peer.pendingCandidates.splice(0)) await pc.addIceCandidate(pending);

    if (description.type === 'offer') {
      if (!peer.slots) {
        this.#bindSlots(peer);
        this.#changed();
      }
      await pc.setLocalDescription();
      this.#sendDescription(peer);
    }
  }

  #setSlotTrack(slot, track) {
    this.tracks[slot] = track;
    for (const peer of this.peers.values()) {
      peer.slots?.[slot].sender.replaceTrack(track).catch((err) => {
        console.error('replaceTrack failed:', err);
      });
    }
  }

  #refreshLocalStream() {
    const tracks = [this.tracks[SLOT.MIC], this.tracks[SLOT.CAMERA]].filter(Boolean);
    this.localStream = tracks.length ? new rtc.MediaStream(tracks) : null;
  }

  #publishState() {
    if (this.socket.connected) this.socket.emit('media:state', this.media);
    this.#changed();
  }

  /** Returns an error message, or null on success. */
  async toggleMic() {
    const mic = this.tracks[SLOT.MIC];
    if (mic) {
      mic.enabled = !mic.enabled;
      this.audioOn = mic.enabled;
    } else {
      try {
        const stream = await rtc.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
        this.#setSlotTrack(SLOT.MIC, stream.getAudioTracks()[0]);
        this.#refreshLocalStream();
        this.audioOn = true;
      } catch (err) {
        return describeMediaError(err);
      }
    }
    this.#publishState();
    return null;
  }

  /** Camera off releases the device (and its indicator) rather than sending black. */
  async toggleCamera() {
    const camera = this.tracks[SLOT.CAMERA];
    if (camera) {
      camera.stop();
      this.#setSlotTrack(SLOT.CAMERA, null);
      this.videoOn = false;
    } else {
      try {
        const stream = await rtc.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
        this.#setSlotTrack(SLOT.CAMERA, stream.getVideoTracks()[0]);
        this.videoOn = true;
      } catch (err) {
        return describeMediaError(err);
      }
    }
    this.#refreshLocalStream();
    this.#publishState();
    return null;
  }

  /** Returns an error message, or null on success or when the user cancels the dialog. */
  async startScreenShare() {
    let stream;
    try {
      stream = await rtc.mediaDevices.getDisplayMedia();
    } catch (err) {
      return /denied|cancel|notallowed/i.test(`${err?.name} ${err?.message}`) ? null : 'Screen sharing failed to start.';
    }
    const [video] = stream.getVideoTracks();
    // Fires when sharing is stopped from Android's own notification or status bar.
    video.addEventListener('ended', () => this.stopScreenShare());
    this.#setSlotTrack(SLOT.SCREEN_VIDEO, video);
    this.#publishState();
    return null;
  }

  stopScreenShare() {
    const video = this.tracks[SLOT.SCREEN_VIDEO];
    if (!video) return;
    this.#setSlotTrack(SLOT.SCREEN_VIDEO, null);
    video.stop();
    this.#publishState();
  }
}
