import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  Alert,
  Animated,
  StatusBar,
  Dimensions,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

const BACKEND_URL = 'https://ytdownlodbackend-production.up.railway.app';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Design Tokens ─────────────────────────────────────────────
const T = {
  bg:         '#080810',
  surface:    '#0F0F1A',
  card:       '#141422',
  cardBorder: '#1E1E32',
  inputBg:    '#0C0C18',
  red:        '#FF3B5C',
  redDim:     '#FF3B5C18',
  redBorder:  '#FF3B5C35',
  blue:       '#4D9EFF',
  blueDim:    '#4D9EFF15',
  blueBorder: '#4D9EFF35',
  green:      '#34D399',
  greenDim:   '#34D39918',
  t1:         '#F2F0FF',
  t2:         '#8A88A8',
  t3:         '#3A3858',
  divider:    '#1A1A2E',
  white:      '#FFFFFF',
};

// ── Helpers ───────────────────────────────────────────────────
const qualityColor = (q) => {
  if (q === 'best')  return { bg: T.greenDim, border: T.green + '40', text: T.green };
  if (q === 'audio') return { bg: T.redDim,   border: T.red   + '40', text: T.red   };
  return               { bg: T.blueDim,  border: T.blue  + '40', text: T.blue  };
};

const qualityLabel = (q) => {
  if (q === 'best')  return '⚡  Best';
  if (q === 'audio') return '♪  Audio';
  return q;
};

// ── Sub-components ────────────────────────────────────────────
const Pill = ({ label, onPress, disabled }) => {
  const c = qualityColor(label);
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[st.pill, { backgroundColor: c.bg, borderColor: c.border }, disabled && st.pillDisabled]}
    >
      <Text style={[st.pillText, { color: c.text }]}>{qualityLabel(label)}</Text>
    </TouchableOpacity>
  );
};

const Tag = ({ children }) => (
  <View style={st.tag}><Text style={st.tagText}>{children}</Text></View>
);

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const [url, setUrl]             = useState('');
  const [info, setInfo]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [dlQuality, setDlQuality] = useState(null);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [dlState, setDlState]     = useState('idle'); // idle | downloading | saving | done
  const [permGranted, setPermGranted] = useState(false);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── FIX #1: Request permissions on app launch (not per-download)
  // This ensures the prompt appears once at startup and never during a download
  useEffect(() => {
    (async () => {
      // FIX #2: Pass false (not true) to avoid the "modify media" popup
      // false = we only need to ADD new files, not modify existing ones
      const { status } = await MediaLibrary.requestPermissionsAsync(false);
      if (status === 'granted') {
        setPermGranted(true);
      } else {
        Alert.alert(
          'Permission Required',
          'Video Downloader needs gallery access to save your downloads. Please grant it in Settings.',
          [{ text: 'OK' }]
        );
      }
    })();
  }, []);

  const showCard = () => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  };

  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.5, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ])
    ).start();
  };

  const stopPulse = () => {
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
  };

  const reset = () => {
    setInfo(null);
    setUrl('');
    setDlState('idle');
    setSuccess('');
    fadeAnim.setValue(0);
    slideAnim.setValue(24);
  };

  // ── Fetch Info ──
  const handleGetInfo = async () => {
    setError('');
    setSuccess('');
    setInfo(null);
    fadeAnim.setValue(0);
    slideAnim.setValue(24);

    if (!url.trim()) {
      setError('Paste a video link first.');
      return;
    }

    setLoading(true);
    try {
      const res  = await fetch(`${BACKEND_URL}/get-video-info`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not load video. Check the link.');
        return;
      }
      setInfo(data);
      showCard();
    } catch {
      setError("Can't reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  // ── Download ──
  const handleDownload = async (quality) => {
    setError('');
    setSuccess('');

    // FIX #3: Check permission state — if not granted, re-request once
    // but never block mid-download with a system popup
    if (!permGranted) {
      const { status } = await MediaLibrary.requestPermissionsAsync(false);
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please allow gallery access in your phone Settings to save downloads.',
          [{ text: 'OK' }]
        );
        return;
      }
      setPermGranted(true);
    }

    setDlQuality(quality);
    setDlState('downloading');
    startPulse();

    try {
      const sanitized = info.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const ext       = quality === 'audio' ? 'mp3' : 'mp4';
      const filename  = `${sanitized}_${quality}.${ext}`;

      // FIX #4: Use cacheDirectory instead of documentDirectory
      // cacheDirectory is always writable and doesn't need extra permissions
      const dest   = FileSystem.cacheDirectory + filename;
      const dlUrl  = `${BACKEND_URL}/download-video?url=${encodeURIComponent(url)}&quality=${encodeURIComponent(quality)}`;

      // Download to cache
      const result = await FileSystem.downloadAsync(dlUrl, dest);

      if (result.status !== 200) {
        setError(`Download failed (status ${result.status}). Try another quality.`);
        setDlState('idle');
        return;
      }

      setDlState('saving');

      // FIX #5: Save to gallery — createAssetAsync handles the gallery write
      // This is the correct API for Android 10+ (no WRITE_EXTERNAL_STORAGE needed)
      const asset = await MediaLibrary.createAssetAsync(result.uri);

      // FIX #6: Separate album management with error handling
      // Album creation can fail silently — wrap it independently
      try {
        const album = await MediaLibrary.getAlbumAsync('Video Downloader');
        if (!album) {
          await MediaLibrary.createAlbumAsync('Video Downloader', asset, false);
        } else {
          await MediaLibrary.addAssetsToAlbumAsync([asset], album.id, false);
        }
      } catch {
        // Album failed but file is already in gallery — not a critical error
        console.warn('Album organisation failed, file still saved to gallery.');
      }

      // Clean up cache file
      await FileSystem.deleteAsync(result.uri, { idempotent: true });

      setDlState('done');
      setSuccess('Saved to your gallery in "Video Downloader" album ✓');
      setTimeout(reset, 3500);

    } catch (e) {
      setError(`Download failed: ${e.message}`);
      setDlState('idle');
    } finally {
      stopPulse();
      setLoading(false);
      setDlQuality(null);
    }
  };

  const isDownloading = dlState === 'downloading' || dlState === 'saving';

  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />

      <ScrollView
        contentContainerStyle={st.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* ── Header ── */}
        <View style={st.header}>
          <View style={st.logoRow}>
            <View style={st.logoBox}>
              <Text style={st.logoIcon}>▶</Text>
            </View>
            <View>
              <Text style={st.logoName}>Video Downloader</Text>
              <Text style={st.logoSub}>Download from any platform</Text>
            </View>
          </View>
        </View>

        {/* ── Permission Warning Banner ── */}
        {!permGranted && (
          <View style={st.warnBox}>
            <Text style={st.warnText}>⚠  Gallery permission needed to save downloads</Text>
          </View>
        )}

        {/* ── Input Card ── */}
        <View style={st.card}>
          <Text style={st.fieldLabel}>Video link</Text>
          <TextInput
            style={st.input}
            placeholder="Paste any video link..."
            placeholderTextColor={T.t3}
            value={url}
            onChangeText={setUrl}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            selectionColor={T.red}
            returnKeyType="go"
            onSubmitEditing={handleGetInfo}
          />
          <TouchableOpacity
            style={[st.primaryBtn, (loading && !info) && st.btnBusy]}
            onPress={handleGetInfo}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading && !info
              ? <ActivityIndicator color={T.white} size="small" />
              : <Text style={st.primaryBtnText}>Get video info</Text>
            }
          </TouchableOpacity>
        </View>

        {/* ── Supported Platforms ── */}
        {!info && !loading && (
          <View style={st.platformsCard}>
            <Text style={st.platformsLabel}>Works with</Text>
            <Text style={st.platformsList}>
              YouTube  ·  Instagram  ·  Facebook  ·  TikTok  ·  Twitter/X  ·  Reddit  ·  Vimeo  ·  and 1000+ more
            </Text>
          </View>
        )}

        {/* ── Error ── */}
        {!!error && (
          <View style={st.errorBox}>
            <Text style={st.errorIcon}>!</Text>
            <Text style={st.errorText}>{error}</Text>
          </View>
        )}

        {/* ── Success ── */}
        {!!success && (
          <View style={st.successBox}>
            <Text style={st.successText}>{success}</Text>
          </View>
        )}

        {/* ── Video Info Card ── */}
        {info && (
          <Animated.View style={[st.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

            {/* Thumbnail */}
            {info.thumbnail ? (
              <View style={st.thumbWrap}>
                <Image source={{ uri: info.thumbnail }} style={st.thumb} resizeMode="cover" />
                <View style={st.thumbScrim} />
                <View style={st.thumbMeta}>
                  <Tag>{info.duration}</Tag>
                </View>
              </View>
            ) : null}

            {/* Title */}
            <Text style={st.videoTitle} numberOfLines={3}>{info.title}</Text>

            <View style={st.divider} />

            {/* Quality */}
            <Text style={st.fieldLabel}>Pick a quality</Text>
            <View style={st.pillGrid}>
              {info.qualities.map((q) => (
                <Pill
                  key={q}
                  label={q}
                  onPress={() => handleDownload(q)}
                  disabled={isDownloading}
                />
              ))}
            </View>

            {/* Download State Indicator */}
            {isDownloading && (
              <Animated.View style={[st.dlStatus, { opacity: pulseAnim }]}>
                <ActivityIndicator color={T.red} size="small" style={{ marginRight: 10 }} />
                <Text style={st.dlStatusText}>
                  {dlState === 'saving' ? 'Saving to gallery...' : `Downloading ${dlQuality}...`}
                </Text>
              </Animated.View>
            )}

          </Animated.View>
        )}

        {/* ── Signature ── */}
        <View style={st.sig}>
          <View style={st.sigRule} />
          <Text style={st.sigBy}>crafted by</Text>
          <Text style={st.sigName}>Zeeshan</Text>
          <View style={st.sigAccent} />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────
const st = StyleSheet.create({

  safe:   { flex: 1, backgroundColor: T.bg },
  scroll: { padding: 20, paddingBottom: 56 },

  // Header
  header:   { marginTop: 8, marginBottom: 24 },
  logoRow:  { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logoBox:  {
    width: 46, height: 46, borderRadius: 13,
    backgroundColor: T.red, alignItems: 'center', justifyContent: 'center',
  },
  logoIcon: { fontSize: 18, color: T.white },
  logoName: { fontSize: 22, fontWeight: '800', color: T.t1, letterSpacing: -0.3 },
  logoSub:  { fontSize: 12, color: T.t2, marginTop: 1 },

  // Card
  card: {
    backgroundColor: T.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: T.cardBorder,
    padding: 18,
    marginBottom: 14,
  },

  // Permission warning
  warnBox: {
    backgroundColor: '#2A1A00',
    borderWidth: 1,
    borderColor: '#FF990040',
    borderRadius: 11,
    padding: 12,
    marginBottom: 14,
  },
  warnText: { color: '#FF9900', fontSize: 13, fontWeight: '600' },

  // Platforms hint card
  platformsCard: {
    backgroundColor: T.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.cardBorder,
    padding: 14,
    marginBottom: 14,
  },
  platformsLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: T.t3,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  platformsList: {
    fontSize: 13,
    color: T.t2,
    lineHeight: 20,
  },

  // Field label
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: T.t3,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  // Input
  input: {
    backgroundColor: T.inputBg,
    borderWidth: 1,
    borderColor: T.cardBorder,
    borderRadius: 11,
    paddingHorizontal: 15,
    paddingVertical: 13,
    fontSize: 14,
    color: T.t1,
    marginBottom: 12,
  },

  // Primary button
  primaryBtn: {
    backgroundColor: T.red,
    borderRadius: 11,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnBusy: { opacity: 0.7 },
  primaryBtnText: {
    color: T.white,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Error
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: T.redDim,
    borderWidth: 1,
    borderColor: T.redBorder,
    borderRadius: 11,
    padding: 14,
    marginBottom: 14,
    gap: 10,
  },
  errorIcon: {
    fontSize: 12,
    fontWeight: '800',
    color: T.red,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: T.red,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorText: { color: T.red, fontSize: 14, flex: 1, lineHeight: 20 },

  // Success
  successBox: {
    backgroundColor: T.greenDim,
    borderWidth: 1,
    borderColor: T.green + '40',
    borderRadius: 11,
    padding: 14,
    marginBottom: 14,
  },
  successText: { color: T.green, fontSize: 14, fontWeight: '600' },

  // Thumbnail
  thumbWrap: {
    borderRadius: 11,
    overflow: 'hidden',
    marginBottom: 14,
    position: 'relative',
  },
  thumb:      { width: '100%', height: 196 },
  thumbScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000040' },
  thumbMeta:  { position: 'absolute', bottom: 10, right: 10 },

  // Duration tag
  tag: {
    backgroundColor: '#000000BB',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: { color: T.white, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },

  // Video title
  videoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: T.t1,
    lineHeight: 23,
    marginBottom: 16,
  },

  // Divider
  divider: { height: 1, backgroundColor: T.divider, marginBottom: 16 },

  // Quality pills
  pillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  pillDisabled: { opacity: 0.4 },
  pillText:     { fontSize: 13, fontWeight: '700' },

  // Download status
  dlStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    backgroundColor: T.redDim,
    borderRadius: 10,
    padding: 12,
  },
  dlStatusText: { color: T.red, fontSize: 14, fontWeight: '600' },

  // Signature
  sig:     { alignItems: 'center', marginTop: 32 },
  sigRule: { width: 28, height: 1, backgroundColor: T.cardBorder, marginBottom: 14 },
  sigBy:   {
    fontSize: 10,
    letterSpacing: 2.5,
    color: T.t3,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  sigName: {
    fontSize: 26,
    fontWeight: '800',
    color: T.red,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sigAccent: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.red },
});