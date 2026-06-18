import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, ScrollView, SafeAreaView,
  Animated, StatusBar, Dimensions, Pressable, Platform,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as MediaLibrary from 'expo-media-library';

const BACKEND_URL = 'https://ytdownlodbackend-production.up.railway.app';
const { width: SW } = Dimensions.get('window');

// ── Tokens ────────────────────────────────────────────────────
const T = {
  bg:           '#080910',
  surface:      '#0E0F1A',
  card:         '#121424',
  glass:        '#171929',
  border:       '#1F2238',
  borderHi:     '#2C3055',

  accent:       '#7C6FFF',
  accentSoft:   '#7C6FFF22',
  accentBorder: '#7C6FFF40',
  accentGlow:   '#7C6FFF55',

  cyan:         '#00D4FF',
  cyanSoft:     '#00D4FF14',

  green:        '#00C896',
  greenSoft:    '#00C89618',
  red:          '#FF4D6A',
  redSoft:      '#FF4D6A18',

  t1:           '#EEEEFF',
  t2:           '#6B708F',
  t3:           '#252840',
  white:        '#FFFFFF',
};

// ── Quality config ─────────────────────────────────────────────
const qualityMeta = (q) => {
  if (q === 'best')  return { icon: '✦', label: 'Best',  sub: 'Highest quality', color: T.accent, bg: T.accentSoft, border: T.accentBorder };
  if (q === 'audio') return { icon: '♪', label: 'Audio', sub: 'MP3 only',        color: T.cyan,   bg: T.cyanSoft,   border: T.cyan + '35'  };
  return                    { icon: '▶', label: q,        sub: 'MP4 video',       color: T.t2,     bg: T.glass,      border: T.border        };
};

function useScale(to = 0.95) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn  = () => Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 60 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1,  useNativeDriver: true, speed: 60 }).start();
  return { scale, pressIn, pressOut };
}

function QualityCard({ q, onPress, disabled }) {
  const m = qualityMeta(q);
  const { scale, pressIn, pressOut } = useScale();
  return (
    <Animated.View style={{ transform: [{ scale }], width: (SW - 60) / 2 }}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={disabled}
        style={[st.qualCard, { borderColor: m.border, backgroundColor: m.bg }, disabled && { opacity: 0.3 }]}
      >
        <Text style={[st.qualIcon, { color: m.color }]}>{m.icon}</Text>
        <Text style={[st.qualLabel, { color: m.color }]}>{m.label}</Text>
        <Text style={st.qualSub}>{m.sub}</Text>
      </Pressable>
    </Animated.View>
  );
}

const Tag = ({ children }) => (
  <View style={st.tag}><Text style={st.tagText}>{children}</Text></View>
);

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

// ── Permission helpers ────────────────────────────────────────
async function requestStoragePermission() {
  try {
    // Step 1: request MediaLibrary permission (covers READ on all Android)
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') return false;

    // Step 2: on Android 11+ (API 30+) we need MANAGE_ALL_FILES for writing to Downloads
    // We check by attempting to list the root external storage
    try {
      const info = await FileSystem.getInfoAsync('file:///storage/emulated/0/Download/');
      return info.exists;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

async function openStorageSettings() {
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION',
      { data: 'package:com.zeeshan.videodownloader' }
    );
  } catch {
    try {
      await IntentLauncher.startActivityAsync('android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION');
    } catch {
      await IntentLauncher.startActivityAsync('android.settings.APPLICATION_DETAILS_SETTINGS',
        { data: 'package:com.zeeshan.videodownloader' });
    }
  }
}

const DOWNLOAD_DIR = 'file:///storage/emulated/0/Download/VideoDownloader/';

async function ensureDownloadDir() {
  try {
    const info = await FileSystem.getInfoAsync(DOWNLOAD_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true });
    }
  } catch (e) {
    console.warn('Could not create download dir:', e.message);
  }
}

// ── App ───────────────────────────────────────────────────────
export default function App() {
  const [url, setUrl]             = useState('');
  const [info, setInfo]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [dlQuality, setDlQuality] = useState(null);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [dlState, setDlState]     = useState('idle');
  const [hasPermission, setHasPermission] = useState(false);
  const [checkingPerm, setCheckingPerm]   = useState(true);

  const headerAnim  = useRef(new Animated.Value(0)).current;
  const cardAnim    = useRef(new Animated.Value(0)).current;
  const cardSlide   = useRef(new Animated.Value(24)).current;
  const pulseAnim   = useRef(new Animated.Value(1)).current;
  const inputFocus  = useRef(new Animated.Value(0)).current;
  const successAnim = useRef(new Animated.Value(0)).current;
  const spinTimer   = useRef(null);

  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 600, delay: 150, useNativeDriver: true }).start();

    // Hard cap: spinner never shows more than 2.5s
    spinTimer.current = setTimeout(() => {
      setCheckingPerm(false);
    }, 2500);

    doPermCheck();

    return () => clearTimeout(spinTimer.current);
  }, []);

  const doPermCheck = async () => {
    const granted = await requestStoragePermission();
    clearTimeout(spinTimer.current);
    setHasPermission(granted);
    setCheckingPerm(false);
    if (granted) ensureDownloadDir();
  };

  const showCard = () => {
    cardAnim.setValue(0); cardSlide.setValue(24);
    Animated.parallel([
      Animated.timing(cardAnim,  { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(cardSlide, { toValue: 0, speed: 16, bounciness: 5, useNativeDriver: true }),
    ]).start();
  };

  const startPulse = () => {
    pulseAnim.setValue(1);
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.35, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 750, useNativeDriver: true }),
      ])
    ).start();
  };

  const stopPulse = () => { pulseAnim.stopAnimation(); pulseAnim.setValue(1); };

  const onFocus = () => Animated.timing(inputFocus, { toValue: 1, duration: 180, useNativeDriver: false }).start();
  const onBlur  = () => Animated.timing(inputFocus, { toValue: 0, duration: 180, useNativeDriver: false }).start();
  const borderColor = inputFocus.interpolate({ inputRange: [0, 1], outputRange: [T.border, T.accent] });

  const reset = () => {
    setInfo(null); setUrl(''); setDlState('idle'); setError(''); setSuccess('');
    cardAnim.setValue(0); cardSlide.setValue(24);
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

    // Re-check permission right before download
    const hasPerm = await requestStoragePermission();
    if (!hasPerm) {
      setHasPermission(false);
      return;
    }

    setDlQuality(quality); setDlState('downloading'); startPulse();

    try {
      await ensureDownloadDir();

      const sanitized = (info.title || 'video').replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 60);
      const ext       = quality === 'audio' ? 'mp3' : 'mp4';
      const filename  = `${sanitized}_${quality}_${Date.now()}.${ext}`;
      const finalPath = DOWNLOAD_DIR + filename;
      const dlUrl     = `${BACKEND_URL}/download-video?url=${encodeURIComponent(url)}&quality=${encodeURIComponent(quality)}`;

      const result = await FileSystem.downloadAsync(dlUrl, finalPath);

      if (result.status !== 200) {
        setError(`Download failed (HTTP ${result.status}). Try a different quality.`);
        setDlState('idle');
        return;
      }

      // Scan the file so it appears in Gallery/Files app
      try { await MediaLibrary.createAssetAsync(finalPath); } catch {}

      setDlState('done');
      Animated.spring(successAnim, { toValue: 1, speed: 14, useNativeDriver: true }).start();
      setSuccess('Saved to Downloads/VideoDownloader/');
      setTimeout(() => { successAnim.setValue(0); reset(); }, 3500);

    } catch (e) {
      console.error('Download error:', e);
      setError(e.message?.includes('permission')
        ? 'Storage permission denied. Please grant "All files access" in settings.'
        : (e.message || 'Something went wrong. Try again.'));
      setDlState('idle');
    } finally {
      stopPulse(); setLoading(false); setDlQuality(null);
    }
  };

  const isDownloading = dlState === 'downloading';

  // ── Loading screen ────────────────────────────────────────
  if (checkingPerm) return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <View style={st.center}>
        <View style={st.loaderWrap}>
          <View style={st.loaderRing}>
            <ActivityIndicator color={T.accent} size="large" />
          </View>
          <Text style={st.loaderText}>Setting up...</Text>
        </View>
      </View>
    </SafeAreaView>
  );

  // ── Permission screen ────────────────────────────────────────
  if (!hasPermission) return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <ScrollView contentContainerStyle={st.permScroll} showsVerticalScrollIndicator={false}>
        <View style={st.orbBig} />

        <View style={st.permIconWrap}>
          <Text style={{ fontSize: 28 }}>🗂️</Text>
        </View>

        <Text style={st.permTitle}>Storage access needed</Text>
        <Text style={st.permDesc}>
          Grant "All files access" so downloads save directly to your Downloads folder — no extra steps each time.
        </Text>

        <View style={st.stepsWrap}>
          {[
            'Tap "Open Settings" below',
            'Find Video Downloader in the list',
            'Toggle "Allow all files access" ON',
            'Come back and tap Continue',
          ].map((label, i) => (
            <React.Fragment key={i}>
              <Step n={i + 1} label={label} active={i === 0} />
              {i < 3 && <View style={st.stepLine} />}
            </React.Fragment>
          ))}
        </View>

        <TouchableOpacity style={st.accentBtn} onPress={openStorageSettings} activeOpacity={0.85}>
          <Text style={st.accentBtnText}>Open Settings</Text>
        </TouchableOpacity>

        <TouchableOpacity style={st.ghostBtn} onPress={doPermCheck} activeOpacity={0.7}>
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
        <View style={st.ambientGlow} />

        {/* ── Header ── */}
        <Animated.View style={[st.header, { opacity: headerAnim }]}>
          <View style={st.logoMark}>
            <Text style={st.logoMarkText}>▶</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={st.appName}>Video Downloader</Text>
            <Text style={st.appSub}>1000+ platforms supported</Text>
          </View>
        </Animated.View>

        {/* ── Search card ── */}
        <View style={st.searchCard}>
          <Text style={st.searchLabel}>Paste a video link</Text>
          <Animated.View style={[st.inputWrap, { borderColor }]}>
            <Text style={st.inputIcon}>🔗</Text>
            <TextInput
              style={st.input}
              placeholder="youtube.com, tiktok.com, instagram.com..."
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
              <TouchableOpacity onPress={() => setUrl('')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={st.clearBtn}>✕</Text>
              </TouchableOpacity>
            )}
          </Animated.View>

          <TouchableOpacity
            style={[st.accentBtn, (loading && !info) && { opacity: 0.65 }]}
            onPress={handleGetInfo}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading && !info
              ? <ActivityIndicator color={T.white} size="small" />
              : <Text style={st.accentBtnText}>Fetch Video Info</Text>}
          </TouchableOpacity>

          {/* Platform chips */}
          {!info && !loading && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }} contentContainerStyle={{ gap: 8 }}>
              {['YouTube', 'Instagram', 'TikTok', 'Twitter/X', 'Facebook', 'Reddit', 'Vimeo'].map(p => (
                <View key={p} style={st.chip}>
                  <Text style={st.chipText}>{p}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* ── Error ── */}
        {!!error && (
          <View style={st.errorBox}>
            <Text style={st.errorIcon}>⚠</Text>
            <Text style={st.errorText}>{error}</Text>
          </View>
        )}

        {/* ── Success ── */}
        {!!success && (
          <Animated.View style={[st.successBox, {
            transform: [{ scale: successAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
            opacity: successAnim,
          }]}>
            <Text style={st.successIcon}>✓</Text>
            <View>
              <Text style={st.successTitle}>Download complete</Text>
              <Text style={st.successSub}>{success}</Text>
            </View>
          </Animated.View>
        )}

        {/* ── Video card ── */}
        {info && (
          <Animated.View style={[st.videoCard, { opacity: cardAnim, transform: [{ translateY: cardSlide }] }]}>

            {/* Thumbnail */}
            {info.thumbnail && (
              <View style={st.thumbWrap}>
                <Image source={{ uri: info.thumbnail }} style={st.thumb} resizeMode="cover" />
                <View style={st.thumbOverlay} />
                <View style={st.thumbBottom}>
                  {!!info.duration && <Tag>{info.duration}</Tag>}
                  <Text style={st.thumbTitleText} numberOfLines={2}>{info.title}</Text>
                </View>
              </View>
            )}

            {/* Quality grid */}
            <View style={st.qualSection}>
              <View style={st.qualHeader}>
                <Text style={st.qualHeading}>Choose quality</Text>
                <View style={st.qualCountBadge}>
                  <Text style={st.qualCountText}>{info.qualities.length} options</Text>
                </View>
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
                <View style={{ flex: 1 }}>
                  <Text style={st.dlBarTitle}>Downloading {dlQuality}…</Text>
                  <Text style={st.dlBarSub}>Keep the app open</Text>
                </View>
              </Animated.View>
            )}

            {/* Back */}
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
          <View style={st.sigDot} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: T.bg },
  scroll: { padding: 20, paddingBottom: 72 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.bg },

  // Loader
  loaderWrap: { alignItems: 'center', gap: 16 },
  loaderRing: {
    width: 60, height: 60, borderRadius: 30,
    borderWidth: 1, borderColor: T.accentBorder,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.accentSoft,
  },
  loaderText: { fontSize: 13, color: T.t2, letterSpacing: 0.5 },

  // Glow
  ambientGlow: {
    position: 'absolute', top: -80, left: SW / 2 - 100,
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: T.accentGlow, opacity: 0.1,
  },
  orbBig: {
    position: 'absolute', top: -20, left: SW / 2 - 110,
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: T.accent, opacity: 0.07,
  },

  // Permission
  permScroll:  { padding: 28, alignItems: 'center', paddingTop: 70, paddingBottom: 52 },
  permIconWrap: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: T.accentSoft, borderWidth: 1, borderColor: T.accentBorder,
    alignItems: 'center', justifyContent: 'center', marginBottom: 22,
  },
  permTitle: { fontSize: 26, fontWeight: '800', color: T.t1, marginBottom: 10, textAlign: 'center', letterSpacing: -0.4 },
  permDesc:  { fontSize: 14, color: T.t2, textAlign: 'center', lineHeight: 22, marginBottom: 28, paddingHorizontal: 8 },

  stepsWrap: {
    width: '100%', backgroundColor: T.glass,
    borderRadius: 16, borderWidth: 1, borderColor: T.border,
    padding: 18, marginBottom: 26,
  },
  stepRow:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepDot:       {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: T.accentSoft, borderColor: T.accent },
  stepDotDone:   { backgroundColor: T.accent, borderColor: T.accent },
  stepN:         { fontSize: 11, fontWeight: '700', color: T.t3 },
  stepCheck:     { fontSize: 11, fontWeight: '800', color: T.white },
  stepLabel:     { fontSize: 13, color: T.t2, flex: 1, lineHeight: 19 },
  stepLine:      { width: 1, height: 14, backgroundColor: T.border, marginLeft: 12, marginVertical: 4 },

  // Buttons
  accentBtn: {
    backgroundColor: T.accent, borderRadius: 13,
    paddingVertical: 15, alignItems: 'center', justifyContent: 'center',
    width: '100%', marginBottom: 10,
    shadowColor: T.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 7,
  },
  accentBtnText: { color: T.white, fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  ghostBtn:      { paddingVertical: 12, alignItems: 'center', width: '100%' },
  ghostBtnText:  { color: T.t2, fontSize: 13, fontWeight: '600' },

  // Header
  header:       { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 24, gap: 14 },
  logoMark:     {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: T.accent, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45, shadowRadius: 8, elevation: 6,
  },
  logoMarkText: { fontSize: 18, color: T.white },
  appName:      { fontSize: 20, fontWeight: '800', color: T.t1, letterSpacing: -0.3 },
  appSub:       { fontSize: 11, color: T.t2, marginTop: 2, letterSpacing: 0.2 },

  // Search card
  searchCard: {
    backgroundColor: T.card, borderRadius: 18,
    borderWidth: 1, borderColor: T.border,
    padding: 16, marginBottom: 14,
  },
  searchLabel: { fontSize: 12, fontWeight: '600', color: T.t2, marginBottom: 12, letterSpacing: 0.3, textTransform: 'uppercase' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.surface, borderRadius: 11, borderWidth: 1.5,
    paddingHorizontal: 12, paddingVertical: 11, marginBottom: 12, gap: 9,
  },
  inputIcon: { fontSize: 14 },
  input:     { flex: 1, fontSize: 13.5, color: T.t1, padding: 0 },
  clearBtn:  { fontSize: 12, color: T.t2, padding: 2 },

  // Chips
  chip:     {
    backgroundColor: T.glass, borderRadius: 20,
    borderWidth: 1, borderColor: T.border,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  chipText: { fontSize: 11, color: T.t2, fontWeight: '600' },

  // Error
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: T.redSoft, borderWidth: 1, borderColor: T.red + '28',
    borderRadius: 12, padding: 14, marginBottom: 14,
  },
  errorIcon: { fontSize: 13, color: T.red, marginTop: 1 },
  errorText: { color: T.red, fontSize: 13.5, flex: 1, lineHeight: 20 },

  // Success
  successBox: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: T.greenSoft, borderWidth: 1, borderColor: T.green + '30',
    borderRadius: 12, padding: 14, marginBottom: 14,
  },
  successIcon:  { fontSize: 20, color: T.green, fontWeight: '800' },
  successTitle: { fontSize: 14, fontWeight: '700', color: T.green, marginBottom: 2 },
  successSub:   { fontSize: 11.5, color: T.green, opacity: 0.75 },

  // Video card
  videoCard: {
    backgroundColor: T.card, borderRadius: 18,
    borderWidth: 1, borderColor: T.border,
    overflow: 'hidden', marginBottom: 16,
  },
  thumbWrap:    { position: 'relative' },
  thumb:        { width: '100%', height: 200 },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#07090FBB',
    // gradient effect via bottom-heavy opacity
  },
  thumbBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0, padding: 14,
    backgroundColor: '#080910CC',
  },
  thumbTitleText: { fontSize: 14.5, fontWeight: '700', color: T.t1, lineHeight: 21, marginTop: 7 },

  // Quality
  qualSection:    { padding: 16 },
  qualHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  qualHeading:    { fontSize: 11, fontWeight: '700', color: T.t1, letterSpacing: 1, textTransform: 'uppercase' },
  qualCountBadge: { backgroundColor: T.glass, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: T.border },
  qualCountText:  { fontSize: 10, color: T.t2, fontWeight: '600' },

  qualGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  qualCard:  { borderWidth: 1, borderRadius: 13, padding: 14, alignItems: 'flex-start', gap: 3 },
  qualIcon:  { fontSize: 17, marginBottom: 3 },
  qualLabel: { fontSize: 14.5, fontWeight: '800', letterSpacing: -0.2 },
  qualSub:   { fontSize: 10.5, color: T.t2, fontWeight: '500' },

  // Download bar
  dlBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: 16, marginTop: 0,
    backgroundColor: T.accentSoft, borderRadius: 12,
    borderWidth: 1, borderColor: T.accentBorder, padding: 13,
  },
  dlBarTitle: { fontSize: 13, fontWeight: '700', color: T.accent },
  dlBarSub:   { fontSize: 11, color: T.t2, marginTop: 1 },

  // Reset
  resetBtn:     { alignItems: 'center', paddingVertical: 14, borderTopWidth: 1, borderTopColor: T.border },
  resetBtnText: { fontSize: 13, color: T.t2, fontWeight: '600' },

  // Tag
  tag:     { alignSelf: 'flex-start', backgroundColor: '#000000AA', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { color: T.white, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5 },

  // Signature
  sig:        { alignItems: 'center', marginTop: 40, paddingBottom: 8 },
  sigDivider: { width: 28, height: 1, backgroundColor: T.border, marginBottom: 14 },
  sigBy:      { fontSize: 9.5, letterSpacing: 2.5, color: T.t3, textTransform: 'uppercase', marginBottom: 5 },
  sigName:    { fontSize: 26, fontWeight: '800', color: T.accent, letterSpacing: -0.4, marginBottom: 8 },
  sigDot:     { width: 4, height: 4, borderRadius: 2, backgroundColor: T.accent },
});