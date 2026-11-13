import VideoTile from './VideoTile.jsx';

function gridColumns(count) {
  return Math.min(Math.ceil(Math.sqrt(count)), 4);
}

/** Camera grid; when anyone presents, screens take the stage and cameras become a strip. */
export default function Stage({ call, selfName }) {
  const { media } = call;
  const peers = call.peerList;

  const screens = [
    ...peers
      .filter((p) => p.media.screen && p.screenStream)
      .map((p) => ({ key: `${p.id}-screen`, stream: p.screenStream, name: p.user.name, muted: false })),
    ...(media.screen
      ? [{ key: 'self-screen', stream: call.screenStream, name: 'You', muted: true }]
      : []),
  ];

  const cameras = [
    <VideoTile
      key="self"
      self
      stream={call.localStream}
      name={`${selfName} (you)`}
      muted
      videoOn={media.video}
      audioOn={media.audio}
    />,
    ...peers.map((p) => (
      <VideoTile
        key={p.id}
        stream={p.cameraStream}
        name={p.user.name}
        videoOn={p.media.video}
        audioOn={p.media.audio}
        status={p.state}
      />
    )),
  ];

  if (screens.length === 0) {
    return (
      <div className="grid" style={{ '--cols': gridColumns(cameras.length) }}>
        {cameras}
      </div>
    );
  }

  return (
    <div className="presenting">
      <div className="presenting-screens" style={{ '--cols': gridColumns(screens.length) }}>
        {screens.map(({ key, ...tile }) => (
          <VideoTile key={key} {...tile} videoOn screen />
        ))}
      </div>
      <div className="presenting-strip">{cameras}</div>
    </div>
  );
}
