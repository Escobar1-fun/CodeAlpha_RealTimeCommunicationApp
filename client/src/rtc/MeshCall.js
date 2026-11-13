import { AUDIO_CONSTRAINTS, VIDEO_CONSTRAINTS, describeMediaError } from './media.js';

/**
 * Full-mesh WebRTC call: one RTCPeerConnection per remote participant.
 *
 * Every connection is created with four fixed transceivers ("slots"). Whoever joins
 * later makes the single offer that establishes them; after that, turning the camera
 * on or sharing a screen is only a replaceTrack() on a slot. There is no renegotiation,
 * so no offer glare, and which incoming track is which is known from its position
 * rather than from a side channel that could arrive late.
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

    this.tracks = [stream.getAudioTracks()[0] ?? null, stream.getVideoTracks()[0] ?? null, null, null];
    this.audioOn = Boolean(this.tracks[SLOT.MIC]?.enabled);
    this.videoOn = Boolean(this.tracks[SLOT.CAMERA]);
    this.localStream = stream;
    this.screenStream = null;

    this.onPeerJoined = ({ id, user, media }) => {
      this.#createPeer({ id, user, media }, false);
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
      if (peer) this.#enqueue(peer, () => this.#applySignal(peer, message));
    };

    socket.on('peer:joined', this.onPeerJoined);
    socket.on('peer:left', this.onPeerLeft);
    socket.on('media:state', this.onMediaState);
    socket.on('signal', this.onSignal);
  }

  // --- Observers --------------------------------------------------------

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #changed() {
    this.listeners.forEach((listener) => listener());
  }

  get media() {
    return { audio: this.audioOn, video: this.videoOn, screen: Boolean(this.screenStream) };
  }

  get peerList() {
    return [...this.peers.values()];
  }

  // --- Connection lifecycle ---------------------------------------------

  /** Called after each successful room:join, including rejoins after a reconnect. */
  start({ peers, iceServers }) {
    this.iceServers = iceServers;
    [...this.peers.keys()].forEach((id) => this.#closePeer(id));
    for (const info of peers) {
      const peer = this.#createPeer(info, true);
      this.#enqueue(peer, () => this.#sendOffer(peer));
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
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = {
      id,
      user,
      media,
      pc,
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

    if (initiator) {
      SLOT_KINDS.forEach((kind) => pc.addTransceiver(kind, { direction: 'sendrecv' }));
      this.#bindSlots(peer);
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket.emit('signal', { to: id, candidate: candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      peer.state = pc.connectionState;
      if (pc.connectionState === 'connected') peer.iceRestarts = 0;
      // Only the original offerer restarts, so the two sides never offer at once.
      if (pc.connectionState === 'failed' && initiator && peer.iceRestarts < MAX_ICE_RESTARTS) {
        peer.iceRestarts += 1;
        this.#enqueue(peer, () => this.#sendOffer(peer, { iceRestart: true }));
      }
      this.#changed();
    };
    return peer;
  }

  #closePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.onicecandidate = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    this.peers.delete(id);
  }

  /** Signals are applied strictly in arrival order, one at a time, per peer. */
  #enqueue(peer, task) {
    peer.queue = peer.queue.then(task).catch((err) => console.error('WebRTC signaling error:', err));
  }

  #bindSlots(peer) {
    // Transceivers are listed in creation order, which on the answering side is m-line order.
    peer.slots = peer.pc.getTransceivers().slice(0, SLOT_KINDS.length);
    const receiverTrack = (slot) => peer.slots[slot].receiver.track;
    peer.cameraStream = new MediaStream([receiverTrack(SLOT.MIC), receiverTrack(SLOT.CAMERA)]);
    peer.screenStream = new MediaStream([
      receiverTrack(SLOT.SCREEN_VIDEO),
      receiverTrack(SLOT.SCREEN_AUDIO),
    ]);
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

  // --- Local media controls ---------------------------------------------

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
    this.localStream = new MediaStream(tracks);
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
        const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
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

  /** Camera off releases the device (and its indicator light) rather than sending black. */
  async toggleCamera() {
    const camera = this.tracks[SLOT.CAMERA];
    if (camera) {
      camera.stop();
      this.#setSlotTrack(SLOT.CAMERA, null);
      this.videoOn = false;
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
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

  /** Returns an error message, or null on success or when the user cancels the picker. */
  async startScreenShare() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: true,
      });
    } catch (err) {
      return err.name === 'NotAllowedError' || err.name === 'AbortError'
        ? null
        : 'Screen sharing failed to start.';
    }
    const [video] = stream.getVideoTracks();
    const [audio] = stream.getAudioTracks();
    video.contentHint = 'detail';
    // Fires when the user clicks the browser's own "Stop sharing" bar.
    video.addEventListener('ended', () => this.stopScreenShare());

    this.screenStream = stream;
    this.#setSlotTrack(SLOT.SCREEN_VIDEO, video);
    this.#setSlotTrack(SLOT.SCREEN_AUDIO, audio ?? null);
    this.#publishState();
    return null;
  }

  stopScreenShare() {
    if (!this.screenStream) return;
    this.screenStream.getTracks().forEach((track) => track.stop());
    this.screenStream = null;
    this.#setSlotTrack(SLOT.SCREEN_VIDEO, null);
    this.#setSlotTrack(SLOT.SCREEN_AUDIO, null);
    this.#publishState();
  }
}
