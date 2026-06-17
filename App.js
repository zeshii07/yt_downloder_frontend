import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, ScrollView, SafeAreaView,
  Alert, Animated, StatusBar,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

const BACKEND_URL = 'https://ytdownlodbackend-production.up.railway.app';

// ── Design Tokens ─────────────────────────────────────────────
const T = {
  bg: '#080810', surface: '#0F0F1A', card: '#141422', cardBorder: '#1E1E32',
  inputBg: '#0C0C18', red: '#FF3B5C', redDim: '#FF3B5C18', redBorder: '#FF3B5C35',
  blue: '#4D9EFF', blueDim: '#4D9EFF15', blueBorder: '#4D9EFF35',
  green: '#34D399', greenDim: '#34D39918',
  t1: '#F2F0FF', t2: '#8A88A8', t3: '#3A3858', divider: '#1A1A2E', white: '#FFFFFF',
};

const qualityColor = (q) => {
  if (q === 'best')  return { bg: T.greenDim, border: T.green + '40', text: T.green };
  if (q === 'audio') return { bg: T.redDim,   border: T.red   + '40', text: T.red   };
  return                    { bg: T.blueDim,  border: T.blue  + '40', text: T.blue  };
};

const qualityLabel = (q) => {
  if (q === 'best')  return '⚡  Best';
  if (q === 'audio') return '♪  Audio';
  return q;
};

const Pill = ({ label, onPress, disabled }) => {
  const c = qualityColor(label);
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.7}
      style={[st.pill, { backgroundColor: c.bg, borderColor: c.border }, disabled && st.pillDisabled]}>
      <Text style={[st.pillText, { color: c.text }]}>{qualityLabel(label)}</Text>
    </TouchableOpacity>
  );
};

const Tag = ({ children }) => (
  <View style={st.tag}><Text style={st.tagText}>{children}</Text></View>
);

// ── Save to Gallery (no modify popup) ────────────────────────
// The modify popup appears when Android thinks you're overwriting
// an existing media asset. Fix: delete the old asset first if it
// exists, then createAssetAsync always sees it as a brand-new file.
async function saveToGallery(uri, filename) {
  // Check if an asset with this filename already exists in our album
  const album = await MediaLibrary.getAlbumAsync('Video Downloader');
  if (album) {
    const { assets } = await MediaLibrary.getAssetsAsync({
      album: album,
      mediaType: [MediaLibrary.MediaType.video, MediaLibrary.MediaType.audio],
    });
    const existing = assets.find(a => a.filename === filename);
    if (existing) {
      // Delete old asset so Android treats the new one as a fresh create
      await MediaLibrary.deleteAssetsAsync([existing]);
    }
  }

  // Now create — Android sees this as new, no modify popup
  const asset = await MediaLibrary.createAssetAsync(uri);

  // Add to our album
  const updatedAlbum = await MediaLibrary.getAlbumAsync('Video Downloader');
  if (!updatedAlbum) {
    await MediaLibrary.createAlbumAsync('Video Downloader', asset, false);
  } else {
    await MediaLibrary.addAssetsToAlbumAsync([asset], updatedAlbum.id, false);
  }
}

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const [url, setUrl]             = useState('');
  const [info, setInfo]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [dlQuality, setDlQuality] = useState(null);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [dlState, setDlState]     = useState('idle');
  const [permGranted, setPermGranted] = useState(false);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Ask permission once on launch — never again during downloads
  useEffect(() => {
    (async () => {
      const { status } = await MediaLibrary.requestPermissionsAsync(false);
      if (status === 'granted') {
        setPermGranted(true);
      } else {
        Alert.alert(
          'Permission Required',
          'Please allow gallery access so downloads can be saved automatically.',
          [{ text: 'OK' }]
        );
      }
    })();
  }, []);

  const showCard = () => Animated.parallel([
    Animated.timing(fadeAnim,  { toValue: 1, duration: 400, useNativeDriver: true }),
    Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
  ]).start();

  const startPulse = () => Animated.loop(
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,   duration: 700, useNativeDriver: true }),
    ])
  ).start();

  const stopPulse = () => { pulseAnim.stopAnimation(); pulseAnim.setValue(1); };

  const reset = () => {
    setInfo(null); setUrl(''); setDlState('idle'); setSuccess('');
    fadeAnim.setValue(0); slideAnim.setValue(24);
  };

  // ── Fetch Info ──────────────────────────────────────────────
  const handleGetInfo = async () => {
    setError(''); setSuccess(''); setInfo(null);
    fadeAnim.setValue(0); slideAnim.setValue(24);
    if (!url.trim()) { setError('Paste a video link first.'); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${BACKEND_URL}/get-video-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not load video. Check the link.'); return; }
      setInfo(data);
      showCard();
    } catch {
      setError("Can't reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  // ── Download ────────────────────────────────────────────────
  const handleDownload = async (quality) => {
    setError(''); setSuccess('');

    if (!permGranted) {
      const { status } = await MediaLibrary.requestPermissionsAsync(false);
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Allow gallery access in Settings to save downloads.');
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

      // Step 1: Download to cache (no permissions needed)
      const cached = FileSystem.cacheDirectory + filename;
      const dlUrl  = `${BACKEND_URL}/download-video?url=${encodeURIComponent(url)}&quality=${encodeURIComponent(quality)}`;
      const result = await FileSystem.downloadAsync(dlUrl, cached);

      if (result.status !== 200) {
        setError(`Download failed (HTTP ${result.status}). Try another quality.`);
        setDlState('idle');
        return;
      }

      // Step 2: Save to gallery without triggering modify popup
      setDlState('saving');
      await saveToGallery(result.uri, filename);

      // Step 3: Clean cache
      await FileSystem.deleteAsync(result.uri, { idempotent: true });

      setDlState('done');
      setSuccess(`Saved to "Video Downloader" album in your gallery ✓`);
      setTimeout(reset, 3500);

    } catch (e) {
      setError(e.message || 'Something went wrong.');
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
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={st.header}>
          <View style={st.logoRow}>
            <View style={st.logoBox}><Text style={st.logoIcon}>▶</Text></View>
            <View>
              <Text style={st.logoName}>Video Downloader</Text>
              <Text style={st.logoSub}>Download from any platform</Text>
            </View>
          </View>
        </View>

        {/* Permission warning */}
        {!permGranted && (
          <View style={st.warnBox}>
            <Text style={st.warnText}>⚠  Gallery permission needed to save downloads</Text>
          </View>
        )}

        {/* Input Card */}
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
          <TouchableOpacity style={[st.primaryBtn, (loading && !info) && st.btnBusy]}
            onPress={handleGetInfo} disabled={loading} activeOpacity={0.8}>
            {loading && !info
              ? <ActivityIndicator color={T.white} size="small" />
              : <Text style={st.primaryBtnText}>Get video info</Text>}
          </TouchableOpacity>
        </View>

        {/* Platforms hint */}
        {!info && !loading && (
          <View style={st.platformsCard}>
            <Text style={st.platformsLabel}>Works with</Text>
            <Text style={st.platformsList}>
              YouTube · Instagram · Facebook · TikTok · Twitter/X · Reddit · Vimeo · and 1000+ more
            </Text>
          </View>
        )}

        {/* Error */}
        {!!error && (
          <View style={st.errorBox}>
            <Text style={st.errorIcon}>!</Text>
            <Text style={st.errorText}>{error}</Text>
          </View>
        )}

        {/* Success */}
        {!!success && (
          <View style={st.successBox}>
            <Text style={st.successText}>{success}</Text>
          </View>
        )}

        {/* Video Info Card */}
        {info && (
          <Animated.View style={[st.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            {info.thumbnail ? (
              <View style={st.thumbWrap}>
                <Image source={{ uri: info.thumbnail }} style={st.thumb} resizeMode="cover" />
                <View style={st.thumbScrim} />
                <View style={st.thumbMeta}><Tag>{info.duration}</Tag></View>
              </View>
            ) : null}

            <Text style={st.videoTitle} numberOfLines={3}>{info.title}</Text>
            <View style={st.divider} />

            <Text style={st.fieldLabel}>Pick a quality</Text>
            <View style={st.pillGrid}>
              {info.qualities.map((q) => (
                <Pill key={q} label={q} onPress={() => handleDownload(q)} disabled={isDownloading} />
              ))}
            </View>

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

        {/* Signature */}
        <View style={st.sig}>
          <View style={st.sigRule} />
          <Text style={st.sigBy}>crafted with ♥ by</Text>
          <Text style={st.sigName}>Zeeshan</Text>
          <Text style={st.sigTagline}>made with love</Text>
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

  header:  { marginTop: 8, marginBottom: 24, alignItems: 'center', justifyContent: 'center' },
  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  logoBox: { width: 46, height: 46, borderRadius: 13, backgroundColor: T.red, alignItems: 'center', justifyContent: 'center' },
  logoIcon: { fontSize: 18, color: T.white },
  logoName: { fontSize: 22, fontWeight: '800', color: T.t1, letterSpacing: -0.3 },
  logoSub:  { fontSize: 12, color: T.t2, marginTop: 1 },

  warnBox:  { backgroundColor: '#2A1A00', borderWidth: 1, borderColor: '#FF990040', borderRadius: 11, padding: 12, marginBottom: 14 },
  warnText: { color: '#FF9900', fontSize: 13, fontWeight: '600' },

  card: { backgroundColor: T.card, borderRadius: 18, borderWidth: 1, borderColor: T.cardBorder, padding: 18, marginBottom: 14 },

  platformsCard:  { backgroundColor: T.surface, borderRadius: 12, borderWidth: 1, borderColor: T.cardBorder, padding: 14, marginBottom: 14 },
  platformsLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: T.t3, textTransform: 'uppercase', marginBottom: 6 },
  platformsList:  { fontSize: 13, color: T.t2, lineHeight: 20 },

  fieldLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, color: T.t3, textTransform: 'uppercase', marginBottom: 10 },

  input: { backgroundColor: T.inputBg, borderWidth: 1, borderColor: T.cardBorder, borderRadius: 11, paddingHorizontal: 15, paddingVertical: 13, fontSize: 14, color: T.t1, marginBottom: 12 },

  primaryBtn:     { backgroundColor: T.red, borderRadius: 11, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnBusy:        { opacity: 0.7 },
  primaryBtnText: { color: T.white, fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },

  errorBox:  { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: T.redDim, borderWidth: 1, borderColor: T.redBorder, borderRadius: 11, padding: 14, marginBottom: 14, gap: 10 },
  errorIcon: { fontSize: 12, fontWeight: '800', color: T.red, width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: T.red, textAlign: 'center', lineHeight: 18 },
  errorText: { color: T.red, fontSize: 14, flex: 1, lineHeight: 20 },

  successBox:  { backgroundColor: T.greenDim, borderWidth: 1, borderColor: T.green + '40', borderRadius: 11, padding: 14, marginBottom: 14 },
  successText: { color: T.green, fontSize: 14, fontWeight: '600' },

  thumbWrap:  { borderRadius: 11, overflow: 'hidden', marginBottom: 14, position: 'relative' },
  thumb:      { width: '100%', height: 196 },
  thumbScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000040' },
  thumbMeta:  { position: 'absolute', bottom: 10, right: 10 },

  tag:     { backgroundColor: '#000000BB', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { color: T.white, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },

  videoTitle: { fontSize: 16, fontWeight: '700', color: T.t1, lineHeight: 23, marginBottom: 16 },
  divider:    { height: 1, backgroundColor: T.divider, marginBottom: 16 },

  pillGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill:         { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  pillDisabled: { opacity: 0.4 },
  pillText:     { fontSize: 13, fontWeight: '700' },

  dlStatus:     { flexDirection: 'row', alignItems: 'center', marginTop: 16, backgroundColor: T.redDim, borderRadius: 10, padding: 12 },
  dlStatusText: { color: T.red, fontSize: 14, fontWeight: '600' },

  sig:       { alignItems: 'center', marginTop: 32 },
  sigRule:   { width: 28, height: 1, backgroundColor: T.cardBorder, marginBottom: 14 },
  sigBy:     { fontSize: 10, letterSpacing: 2.5, color: T.t3, textTransform: 'uppercase', marginBottom: 5 },
  sigName:   { fontSize: 26, fontWeight: '800', color: T.red, letterSpacing: 0.5, marginBottom: 8 },
  sigTagline:{ fontSize: 11, color: T.t2, letterSpacing: 1.2, marginTop: 4 },
  sigAccent: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.red },
});