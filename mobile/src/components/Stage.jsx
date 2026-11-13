import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { rtc } from '../rtc/native';
import VideoTile from './VideoTile';

function columnsFor(count, landscape) {
  if (landscape) return Math.min(count <= 3 ? count : Math.ceil(count / 2), 4);
  return count <= 2 ? 1 : 2;
}

/** Camera grid; when anyone presents, their screen takes the stage beside a camera strip. */
export default function Stage({ call, selfName }) {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const { media } = call;
  const peers = call.peerList;
  const screens = peers.filter((p) => p.media.screen && p.screenStream);

  const people = [
    { key: 'self', self: true, stream: call.localStream, name: `${selfName} (you)`, videoOn: media.video, audioOn: media.audio },
    ...peers.map((p) => ({
      key: p.id,
      stream: p.cameraStream,
      name: p.user.name,
      videoOn: p.media.video,
      audioOn: p.media.audio,
      status: rtc ? p.state : undefined,
    })),
  ];

  if (screens.length > 0 || media.screen) {
    return (
      <View style={[styles.fill, landscape && styles.row]}>
        <View style={styles.screens}>
          {/* No preview of your own screen: it would only film itself. */}
          {media.screen && <VideoTile name="You" videoOn={false} screen style={styles.fill} />}
          {screens.map((p) => (
            <VideoTile key={p.id} stream={p.screenStream} name={p.user.name} videoOn screen style={styles.fill} />
          ))}
        </View>
        <ScrollView
          horizontal={!landscape}
          style={landscape ? styles.stripSide : styles.strip}
          contentContainerStyle={styles.stripContent}
        >
          {people.map(({ key, ...tile }) => (
            <VideoTile key={key} {...tile} style={styles.stripTile} />
          ))}
        </ScrollView>
      </View>
    );
  }

  const columns = columnsFor(people.length, landscape);
  const rows = Math.ceil(people.length / columns);
  const size = {
    width: `${(100 - (columns - 1) * 1.5) / columns}%`,
    height: `${(100 - (rows - 1) * 1.5) / rows}%`,
  };
  return (
    <View style={styles.grid}>
      {people.map(({ key, ...tile }) => (
        <VideoTile key={key} {...tile} style={size} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row' },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'space-between', justifyContent: 'space-between' },
  screens: { flex: 1, gap: 8 },
  strip: { flexGrow: 0, marginTop: 8 },
  stripSide: { flexGrow: 0, marginLeft: 8 },
  stripContent: { gap: 8 },
  stripTile: { width: 124, height: 124 },
});
