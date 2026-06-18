import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, ScrollView, SafeAreaView,
  Alert, Animated, StatusBar, Dimensions, Pressable,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

const BACKEND_URL = 'https://ytdownlodbackend-production.up.railway.app';
const { width: SW } = Dimensions.get('window');

const DOWNLOAD_DIR = FileSystem.StorageDirectories?.Downloads
  ? `${FileSystem.StorageDirectories.Downloads}Video Downloader/`
  : 'file:///storage/emulated/0/Download/Video Downloader/';

// ── Tokens ────────────────────────────────────────────────────
const T = {
  // Backgrounds — deep navy-black, not pure black
  bg:       '#07080F',
  surface:  '#0D0F1C',
  card:     '#111320',
  glass:    '#161929',
  border:   '#1E2235',
  borderHi: '#2A2F4A',

  // Accent — electric violet-blue, distinctive from the usual red/green
  accent:     '#6C63FF',
  accentDim:  '#6C63FF18',
  accentBorder:'#6C63FF35',
  accentGlow: '#6C63FF60',

  // Secondary accent — cyan for highlights
  cyan:     '#22D3EE',
  cyanDim:  '#22D3EE12',

  // Status
  green:    '#10B981',
  greenDim: '#10B98115',
  red:      '#F43F5E',
  redDim:   '#F43F5E15',
  amber:    '#F59E0B',

  // Type
  t1: '#F0EFFF',   // near-white with violet tint
  t2: '#7B80A8',   // muted
  t3: '#2E3150',   // very muted / dividers
  white: '#FFFFFF',
};

// ── Quality config ─────────────────────────────────────────────
const qualityMeta = (q) => {
  if (q === 'best')  return { icon: '✦', label: 'Best',  sub: 'Highest quality', color: T.accent, dim: T.accentDim, border: T.accentBorder };
  if (q === 'audio') return { icon: '♫', label: 'Audio', sub: 'MP3 only',        color: T.cyan,   dim: T.cyanDim,   border: T.cyan + '30'   };
  return                    { icon: '▶', label: q,        sub: 'MP4 video',       color: T.t2,     dim: T.glass,     border: T.border        };
};

// ── Reusable animated press scale ─────────────────────────────
function useScale(to = 0.96) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn  = () => Animated.spring(scale, { toValue: to,  useNativeDriver: true, speed: 50 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1,   useNativeDriver: true, speed: 50 }).start();
  return { scale, pressIn, pressOut };
}

// ── Quality Pill ───────────────────────────────────────────────
function QualityCard({ q, onPress, disabled }) {
  const m = qualityMeta(q);
  const { scale, pressIn, pressOut } = useScale();
  return (
    <Animated.View style={{ transform: [{ scale }], width: (SW - 56) / 2 }}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={disabled}
        style={[st.qualCard, { borderColor: m.border, backgroundColor: m.dim }, disabled && { opacity: 0.35 }]}
      >
        <Text style={[st.qualIcon, { color: m.color }]}>{m.icon}</Text>
        <Text style={[st.qualLabel, { color: m.color }]}>{m.label}</Text>
        <Text style={st.qualSub}>{m.sub}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ── Tag ───────────────────────────────────────────────────────
const Tag = ({ children }) => (
  <View style={st.tag}><Text style={st.tagText}>{children}</Text></View>
);

// ── Progress Step ─────────────────────────────────────────────
const Step = ({ n, label, active, done }) => (
  <View style={st.stepRow}>
    <View style={[st.stepDot, active && st.stepDotActive, done && st.stepDotDone]}>
      {done
        ? <Text style={st.stepCheck}>✓</Text>
        : <Text style={[st.stepN, active && { color: T.white }]}>{n}</Text>}
    </View>
    <Text style={[st.stepLabel, (active || done) && { color: T.t1 }]}>{label}</Text>
  </View>
);

async function checkManageStoragePermission() {
  try {
    const info = await FileSystem.getInfoAsync('file:///storage/emulated/0/');
    return info.exists;
  } catch { return false; }
}

async function openManageStorageSettings() {
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION',
      { data: 'package:com.zeeshan.videodownloader' }
    );
  } catch {
    await IntentLauncher.startActivityAsync('android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION');
  }
}

// ── App ───────────────────────────────────────────────────────
export default function App() {
  const [url, setUrl]           = useState('');
  const [info, setInfo]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [dlQuality, setDlQuality] = useState(null);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [dlState, setDlState]   = useState('idle');
  const [hasPermission, setHasPermission] = useState(false);
  const [checkingPerm, setCheckingPerm]   = useState(true);

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const cardAnim   = useRef(new Animated.Value(0)).current;
  const cardSlide  = useRef(new Animated.Value(32)).current;
  const pulseAnim  = useRef(new Animated.Value(1)).current;
  const inputFocus = useRef(new Animated.Value(0)).current;
  const successAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade header in on mount
    Animated.timing(headerAnim, { toValue: 1, duration: 700, delay: 100, useNativeDriver: true }).start();
    checkPerm();
  }, []);

  const checkPerm = async () => {
    setCheckingPerm(true);
    const granted = await checkManageStoragePermission();
    setHasPermission(granted);
    setCheckingPerm(false);
    if (granted) ensureDownloadDir();
  };

  const ensureDownloadDir = async () => {
    try {
      const i = await FileSystem.getInfoAsync(DOWNLOAD_DIR);
      if (!i.exists) await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true });
    } catch {}
  };

  const showCard = () => {
    cardAnim.setValue(0); cardSlide.setValue(32);
    Animated.parallel([
      Animated.timing(cardAnim,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(cardSlide, { toValue: 0, speed: 14, bounciness: 6, useNativeDriver: true }),
    ]).start();
  };

  const startPulse = () => Animated.loop(
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,   duration: 800, useNativeDriver: true }),
    ])
  ).start();

  const stopPulse = () => { pulseAnim.stopAnimation(); pulseAnim.setValue(1); };

  const onFocus = () => Animated.timing(inputFocus, { toValue: 1, duration: 200, useNativeDriver: false }).start();
  const onBlur  = () => Animated.timing(inputFocus, { toValue: 0, duration: 200, useNativeDriver: false }).start();

  const borderColor = inputFocus.interpolate({ inputRange: [0, 1], outputRange: [T.border, T.accent] });

  const reset = () => {
    setInfo(null); setUrl(''); setDlState('idle'); setError('');
    setSuccess(''); cardAnim.setValue(0); cardSlide.setValue(32);
  };

  const handleGetInfo = async () => {
    setError(''); setSuccess(''); setInfo(null);
    if (!url.trim()) { setError('Paste a video link to get started.'); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${BACKEND_URL}/get-video-info`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not load video. Check the link.'); return; }
      setInfo(data);
      showCard();
    } catch { setError("Can't reach the server. Check your connection."); }
    finally  { setLoading(false); }
  };

  const handleDownload = async (quality) => {
    setError(''); setSuccess('');
    setDlQuality(quality); setDlState('downloading'); startPulse();

    try {
      const sanitized = info.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const ext       = quality === 'audio' ? 'mp3' : 'mp4';
      const filename  = `${sanitized}_${quality}.${ext}`;
      const finalPath = DOWNLOAD_DIR + filename;
      const dlUrl     = `${BACKEND_URL}/download-video?url=${encodeURIComponent(url)}&quality=${encodeURIComponent(quality)}`;

      const result = await FileSystem.downloadAsync(dlUrl, finalPath);
      if (result.status !== 200) {
        setError(`Download failed (HTTP ${result.status}). Try another quality.`);
        setDlState('idle'); return;
      }

      setDlState('done');
      Animated.spring(successAnim, { toValue: 1, speed: 12, useNativeDriver: true }).start();
      setSuccess(`Saved to Downloads/Video Downloader/`);
      setTimeout(() => {
        successAnim.setValue(0);
        reset();
      }, 3500);

    } catch (e) {
      setError(e.message || 'Something went wrong.');
      setDlState('idle');
    } finally {
      stopPulse(); setLoading(false); setDlQuality(null);
    }
  };

  const isDownloading = dlState === 'downloading';

  // ── Screens ───────────────────────────────────────────────

  if (checkingPerm) return (
    <SafeAreaView style={st.safe}>
      <View style={st.center}>
        <View style={st.spinnerRing}>
          <ActivityIndicator color={T.accent} size="large" />
        </View>
      </View>
    </SafeAreaView>
  );

  if (!hasPermission) return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <ScrollView contentContainerStyle={st.permScroll} showsVerticalScrollIndicator={false}>
        {/* Glowing orb */}
        <View style={st.orb} />

        <View style={st.permIcon}>
          <Text style={{ fontSize: 32 }}>🗂</Text>
        </View>

        <Text style={st.permTitle}>One-time setup</Text>
        <Text style={st.permDesc}>
          Allow storage access so every download saves silently to your Downloads folder — no more popups.
        </Text>

        <View style={st.stepsWrap}>
          <Step n="1" label="Tap Open Settings below" active />
          <View style={st.stepLine} />
          <Step n="2" label="Find Video Downloader in the list" />
          <View style={st.stepLine} />
          <Step n="3" label='Toggle "Allow all files access" ON' />
          <View style={st.stepLine} />
          <Step n="4" label="Return here and tap Continue" />
        </View>

        <TouchableOpacity style={st.accentBtn} onPress={openManageStorageSettings} activeOpacity={0.85}>
          <Text style={st.accentBtnText}>Open Settings</Text>
        </TouchableOpacity>

        <TouchableOpacity style={st.ghostBtn} onPress={checkPerm} activeOpacity={0.7}>
          <Text style={st.ghostBtnText}>I've granted it — Continue →</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );

  // ── Main UI ───────────────────────────────────────────────
  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <ScrollView
        contentContainerStyle={st.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Ambient glow */}
        <View style={st.ambientGlow} />

        {/* ── Header ── */}
        <Animated.View style={[st.header, { opacity: headerAnim }]}>
          <View style={st.logoMark}>
            <Text style={st.logoMarkText}>▶</Text>
          </View>
          <View style={st.headerText}>
            <Text style={st.appName}>Video Downloader</Text>
            <View style={st.badgeRow}>
              <View style={st.badge}><Text style={st.badgeText}>1000+ platforms</Text></View>
            </View>
          </View>
        </Animated.View>

        {/* ── Search Card ── */}
        <View style={st.searchCard}>
          <Text style={st.searchLabel}>Drop a link, get the video</Text>
          <Animated.View style={[st.inputWrap, { borderColor }]}>
            <Text style={st.inputIcon}>🔗</Text>
            <TextInput
              style={st.input}
              placeholder="youtube.com, instagram.com, tiktok.com..."
              placeholderTextColor={T.t3}
              value={url}
              onChangeText={setUrl}
              onFocus={onFocus}
              onBlur={onBlur}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              selectionColor={T.accent}
              returnKeyType="go"
              onSubmitEditing={handleGetInfo}
            />
            {url.length > 0 && (
              <TouchableOpacity onPress={() => setUrl('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={st.clearBtn}>✕</Text>
              </TouchableOpacity>
            )}
          </Animated.View>

          <TouchableOpacity
            style={[st.accentBtn, (loading && !info) && { opacity: 0.7 }]}
            onPress={handleGetInfo}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading && !info
              ? <ActivityIndicator color={T.white} size="small" />
              : <Text style={st.accentBtnText}>Fetch Video Info</Text>}
          </TouchableOpacity>
        </View>

        {/* ── Platform chips ── */}
        {!info && !loading && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.chipScroll} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
            {['YouTube', 'Instagram', 'TikTok', 'Twitter/X', 'Facebook', 'Reddit', 'Vimeo'].map(p => (
              <View key={p} style={st.chip}>
                <Text style={st.chipText}>{p}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {/* ── Error ── */}
        {!!error && (
          <Animated.View style={st.errorBox}>
            <Text style={st.errorDot}>●</Text>
            <Text style={st.errorText}>{error}</Text>
          </Animated.View>
        )}

        {/* ── Success ── */}
        {!!success && (
          <Animated.View style={[st.successBox, { transform: [{ scale: successAnim.interpolate({ inputRange: [0,1], outputRange: [0.9, 1] }) }], opacity: successAnim }]}>
            <Text style={st.successIcon}>✓</Text>
            <View>
              <Text style={st.successTitle}>Download complete</Text>
              <Text style={st.successSub}>{success}</Text>
            </View>
          </Animated.View>
        )}

        {/* ── Video Card ── */}
        {info && (
          <Animated.View style={[st.videoCard, { opacity: cardAnim, transform: [{ translateY: cardSlide }] }]}>

            {/* Thumbnail */}
            {info.thumbnail && (
              <View style={st.thumbWrap}>
                <Image source={{ uri: info.thumbnail }} style={st.thumb} resizeMode="cover" />
                {/* Gradient overlay */}
                <View style={st.thumbGradient} />
                <View style={st.thumbBottom}>
                  <Tag>{info.duration}</Tag>
                  <View style={st.thumbTitle}>
                    <Text style={st.thumbTitleText} numberOfLines={2}>{info.title}</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Quality section */}
            <View style={st.qualSection}>
              <View style={st.qualHeader}>
                <Text style={st.qualHeading}>Choose quality</Text>
                <Text style={st.qualCount}>{info.qualities.length} options</Text>
              </View>
              <View style={st.qualGrid}>
                {info.qualities.map((q) => (
                  <QualityCard key={q} q={q} onPress={() => handleDownload(q)} disabled={isDownloading} />
                ))}
              </View>
            </View>

            {/* Download progress */}
            {isDownloading && (
              <Animated.View style={[st.dlBar, { opacity: pulseAnim }]}>
                <ActivityIndicator color={T.accent} size="small" />
                <View style={st.dlBarText}>
                  <Text style={st.dlBarTitle}>Downloading {dlQuality}</Text>
                  <Text style={st.dlBarSub}>Please keep the app open</Text>
                </View>
              </Animated.View>
            )}

            {/* Reset */}
            <TouchableOpacity style={st.resetBtn} onPress={reset} disabled={isDownloading}>
              <Text style={st.resetBtnText}>← Try another link</Text>
            </TouchableOpacity>

          </Animated.View>
        )}

        {/* ── Signature ── */}
        <View style={st.sig}>
          <View style={st.sigDivider} />
          <Text style={st.sigBy}>crafted with ♥ by</Text>
          <Text style={st.sigName}>Zeeshan</Text>
          <Text style={st.sigTagline}>made with love</Text>
          <View style={st.sigDot} />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: T.bg },
  scroll: { padding: 20, paddingBottom: 64 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.bg },

  spinnerRing: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 1, borderColor: T.accentBorder,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.accentDim,
  },

  // Ambient background glow
  ambientGlow: {
    position: 'absolute', top: -60, left: SW / 2 - 120,
    width: 240, height: 240, borderRadius: 120,
    backgroundColor: T.accentGlow,
    opacity: 0.12,
  },

  // ── Permission screen ──
  permScroll: { padding: 28, alignItems: 'center', paddingTop: 60, paddingBottom: 48 },
  orb: {
    position: 'absolute', top: 0, left: SW / 2 - 100,
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: T.accent, opacity: 0.07,
  },
  permIcon: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: T.accentDim, borderWidth: 1, borderColor: T.accentBorder,
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  permTitle: { fontSize: 28, fontWeight: '800', color: T.t1, marginBottom: 12, textAlign: 'center', letterSpacing: -0.5 },
  permDesc:  { fontSize: 15, color: T.t2, textAlign: 'center', lineHeight: 24, marginBottom: 32 },

  stepsWrap: {
    width: '100%', backgroundColor: T.glass,
    borderRadius: 16, borderWidth: 1, borderColor: T.border,
    padding: 20, marginBottom: 28,
  },
  stepRow:   { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepDot:   {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: T.accentDim, borderColor: T.accent },
  stepDotDone:   { backgroundColor: T.accent, borderColor: T.accent },
  stepN:         { fontSize: 12, fontWeight: '700', color: T.t3 },
  stepCheck:     { fontSize: 12, fontWeight: '800', color: T.white },
  stepLabel:     { fontSize: 14, color: T.t2, flex: 1, lineHeight: 20 },
  stepLine:      { width: 1, height: 16, backgroundColor: T.border, marginLeft: 13, marginVertical: 4 },

  // ── Buttons ──
  accentBtn: {
    backgroundColor: T.accent, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    width: '100%', marginBottom: 12,
    shadowColor: T.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  accentBtnText: { color: T.white, fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },

  ghostBtn:     { paddingVertical: 14, alignItems: 'center', width: '100%' },
  ghostBtnText: { color: T.t2, fontSize: 14, fontWeight: '600' },

  // ── Header ──
  header:     { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 28, gap: 14 },
  logoMark:   {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: T.accent, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5, shadowRadius: 8, elevation: 6,
  },
  logoMarkText: { fontSize: 20, color: T.white },
  headerText:   { flex: 1 },
  appName:      { fontSize: 22, fontWeight: '800', color: T.t1, letterSpacing: -0.4 },
  badgeRow:     { flexDirection: 'row', marginTop: 4 },
  badge:        { backgroundColor: T.accentDim, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: T.accentBorder },
  badgeText:    { fontSize: 10, color: T.accent, fontWeight: '700', letterSpacing: 0.8 },

  // ── Search card ──
  searchCard: {
    backgroundColor: T.card, borderRadius: 20,
    borderWidth: 1, borderColor: T.border,
    padding: 18, marginBottom: 16,
  },
  searchLabel: { fontSize: 13, fontWeight: '600', color: T.t2, marginBottom: 14, letterSpacing: 0.2 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.surface, borderRadius: 12, borderWidth: 1.5,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14, gap: 10,
  },
  inputIcon: { fontSize: 15 },
  input:     { flex: 1, fontSize: 14, color: T.t1, padding: 0 },
  clearBtn:  { fontSize: 13, color: T.t2, padding: 2 },

  // ── Chips ──
  chipScroll: { marginBottom: 16 },
  chip: {
    backgroundColor: T.glass, borderRadius: 20,
    borderWidth: 1, borderColor: T.border,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  chipText: { fontSize: 12, color: T.t2, fontWeight: '600' },

  // ── Error ──
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: T.redDim, borderWidth: 1, borderColor: T.red + '30',
    borderRadius: 12, padding: 14, marginBottom: 14,
  },
  errorDot:  { fontSize: 8, color: T.red, marginTop: 5 },
  errorText: { color: T.red, fontSize: 14, flex: 1, lineHeight: 20 },

  // ── Success ──
  successBox: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: T.greenDim, borderWidth: 1, borderColor: T.green + '35',
    borderRadius: 12, padding: 16, marginBottom: 14,
  },
  successIcon:  { fontSize: 22, color: T.green, fontWeight: '800' },
  successTitle: { fontSize: 15, fontWeight: '700', color: T.green, marginBottom: 2 },
  successSub:   { fontSize: 12, color: T.green, opacity: 0.75 },

  // ── Video card ──
  videoCard: {
    backgroundColor: T.card, borderRadius: 20,
    borderWidth: 1, borderColor: T.border,
    overflow: 'hidden', marginBottom: 16,
  },

  // Thumbnail
  thumbWrap:     { position: 'relative' },
  thumb:         { width: '100%', height: 210 },
  thumbGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    // Simulated gradient via overlay
    background: 'linear-gradient(to bottom, transparent 40%, #111320 100%)',
  },
  thumbBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 14,
    backgroundColor: '#07080FCC',
  },
  thumbTitle:     { marginTop: 8 },
  thumbTitleText: { fontSize: 15, fontWeight: '700', color: T.t1, lineHeight: 22 },

  // Quality
  qualSection: { padding: 18 },
  qualHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  qualHeading: { fontSize: 13, fontWeight: '700', color: T.t1, letterSpacing: 0.5, textTransform: 'uppercase' },
  qualCount:   { fontSize: 12, color: T.t2 },

  qualGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  qualCard: {
    borderWidth: 1, borderRadius: 14, padding: 14,
    alignItems: 'flex-start', gap: 4,
  },
  qualIcon:  { fontSize: 18, marginBottom: 4 },
  qualLabel: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  qualSub:   { fontSize: 11, color: T.t2, fontWeight: '500' },

  // Download bar
  dlBar: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    margin: 18, marginTop: 0,
    backgroundColor: T.accentDim, borderRadius: 12,
    borderWidth: 1, borderColor: T.accentBorder, padding: 14,
  },
  dlBarText:  {},
  dlBarTitle: { fontSize: 14, fontWeight: '700', color: T.accent },
  dlBarSub:   { fontSize: 11, color: T.t2, marginTop: 2 },

  // Reset
  resetBtn: { alignItems: 'center', paddingVertical: 14, borderTopWidth: 1, borderTopColor: T.border },
  resetBtnText: { fontSize: 13, color: T.t2, fontWeight: '600' },

  // Tag
  tag:     { alignSelf: 'flex-start', backgroundColor: '#000000AA', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { color: T.white, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },

  // Signature
  sig:       { alignItems: 'center', marginTop: 36, paddingBottom: 8 },
  sigDivider:{ width: 32, height: 1, backgroundColor: T.border, marginBottom: 16 },
  sigBy:     { fontSize: 10, letterSpacing: 2.5, color: T.t3, textTransform: 'uppercase', marginBottom: 6 },
  sigName:   { fontSize: 28, fontWeight: '800', color: T.accent, letterSpacing: -0.5, marginBottom: 4 },
  sigTagline:{ fontSize: 11, color: T.t2, letterSpacing: 1.5, marginBottom: 10 },
  sigDot:    { width: 5, height: 5, borderRadius: 3, backgroundColor: T.accent },
});
 