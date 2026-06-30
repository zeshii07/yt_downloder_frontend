import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, ScrollView, SafeAreaView,
  Animated, StatusBar, Dimensions, Pressable, Platform, Linking,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

let IntentLauncher;
if (Platform.OS === 'android') {
  IntentLauncher = require('expo-intent-launcher');
}

const BACKEND_URL = 'https://ytdownlodbackend-production.up.railway.app';
const { width: SW } = Dimensions.get('window');

const T = {
  bg: '#080910', surface: '#0E0F1A', card: '#121424', glass: '#171929',
  border: '#1F2238', borderHi: '#2C3055', accent: '#7C6FFF',
  accentSoft: '#7C6FFF22', accentBorder: '#7C6FFF40', accentGlow: '#7C6FFF55',
  cyan: '#00D4FF', cyanSoft: '#00D4FF14', green: '#00C896', greenSoft: '#00C89618',
  red: '#FF4D6A', redSoft: '#FF4D6A18', t1: '#EEEEFF', t2: '#6B708F',
  t3: '#252840', white: '#FFFFFF',
};

const qualityMeta = (q) => {
  if (q === 'best')  return { icon: '✦', label: 'Best',  color: T.accent, bg: T.accentSoft, border: T.accentBorder };
  if (q === 'audio') return { icon: '♪', label: 'Audio', color: T.cyan,   bg: T.cyanSoft,   border: T.cyan + '35'  };
  return                    { icon: '▶', label: q,        color: T.t2,     bg: T.glass,      border: T.border        };
};

// ── Modern Horizontal Quality Pill ─────────────────────────────
function QualityPill({ q, onPress, disabled, active }) {
  const m = qualityMeta(q);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        st.pill, 
        { borderColor: active ? m.color : m.border, backgroundColor: active ? m.bg : T.glass },
        disabled && { opacity: 0.4 }
      ]}
    >
      <Text style={[st.pillIcon, { color: m.color }]}>{m.icon}</Text>
      <Text style={[st.pillLabel, { color: active ? m.color : T.t2 }]}>{m.label}</Text>
    </Pressable>
  );
}

const Tag = ({ children }) => (
  <View style={st.tag}><Text style={st.tagText}>{children}</Text></View>
);

// ── Permission Helpers ─────────────────────────────────────────
async function checkMediaLibraryPermission() {
  try {
    const { status, canAskAgain } = await MediaLibrary.getPermissionsAsync();
    return { status, canAskAgain };
  } catch (e) {
    return { status: 'undetermined', canAskAgain: true };
  }
}

async function requestMediaPermission() {
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    return false;
  }
}

async function openAppSettings() {
  try {
    if (Platform.OS === 'android') {
      await IntentLauncher.startActivityAsync(IntentLauncher.ACTION_APPLICATION_DETAILS_SETTINGS, { data: 'package:com.zeeshan.videodownloader' });
    } else {
      await Linking.openURL('app-settings:');
    }
  } catch (e) {
    if (Platform.OS === 'ios') Linking.openURL('prefs:root=Photos').catch(() => {});
  }
}

const SANDBOX_DIR = FileSystem.cacheDirectory + 'video-downloader/';

async function ensureSandboxDir() {
  try {
    const info = await FileSystem.getInfoAsync(SANDBOX_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(SANDBOX_DIR, { intermediates: true });
    return true;
  } catch (e) {
    return false;
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
  const [permStatus, setPermStatus] = useState('checking');

  const headerAnim  = useRef(new Animated.Value(0)).current;
  const cardAnim    = useRef(new Animated.Value(0)).current;
  const cardSlide   = useRef(new Animated.Value(24)).current;
  const pulseAnim   = useRef(new Animated.Value(1)).current;
  const inputFocus  = useRef(new Animated.Value(0)).current;
  const successAnim = useRef(new Animated.Value(0)).current;
  const spinTimer   = useRef(null);

  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 600, delay: 150, useNativeDriver: true }).start();
    spinTimer.current = setTimeout(() => setPermStatus(prev => prev === 'checking' ? 'denied' : prev), 3000);
    checkInitialPermission();
    return () => clearTimeout(spinTimer.current);
  }, []);

  const checkInitialPermission = async () => {
    const { status, canAskAgain } = await checkMediaLibraryPermission();
    clearTimeout(spinTimer.current);
    if (status === 'granted') { setPermStatus('granted'); await ensureSandboxDir(); }
    else if (status === 'denied' && !canAskAgain) setPermStatus('blocked');
    else setPermStatus('denied');
  };

  const handleRequestPermission = async () => {
    const granted = await requestMediaPermission();
    if (granted) { setPermStatus('granted'); await ensureSandboxDir(); }
    else { const { canAskAgain } = await checkMediaLibraryPermission(); setPermStatus(canAskAgain ? 'denied' : 'blocked'); }
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
    Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,   duration: 800, useNativeDriver: true }),
    ])).start();
  };
  const stopPulse = () => { pulseAnim.stopAnimation(); pulseAnim.setValue(1); };

  const onFocus = () => Animated.timing(inputFocus, { toValue: 1, duration: 180, useNativeDriver: false }).start();
  const onBlur  = () => Animated.timing(inputFocus, { toValue: 0, duration: 180, useNativeDriver: false }).start();
  const borderColor = inputFocus.interpolate({ inputRange: [0, 1], outputRange: [T.border, T.accent] });

  const reset = () => {
    setInfo(null); setUrl(''); setDlState('idle'); setError(''); setSuccess(''); setDlQuality(null);
    cardAnim.setValue(0); cardSlide.setValue(24);
  };

  const handleGetInfo = async () => {
    setError(''); setSuccess(''); setInfo(null);
    if (!url.trim()) { setError('Paste a video link to get started.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/get-video-info`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not load video.'); return; }
      setInfo(data); showCard();
    } catch { setError("Can't reach server."); }
    finally { setLoading(false); }
  };

  const handleDownload = async (quality) => {
    setError(''); setSuccess('');
    const { status } = await checkMediaLibraryPermission();
    if (status !== 'granted') {
      if (!await requestMediaPermission()) { setPermStatus('denied'); setError('Permission required.'); return; }
    }

    setDlQuality(quality); setDlState('downloading'); startPulse();

    try {
      if (!await ensureSandboxDir()) throw new Error('Storage prep failed');

      const sanitized = (info.title || 'video').replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 60);
      const ext = quality === 'audio' ? 'mp3' : 'mp4';
      const filename = `${sanitized}_${quality}_${Date.now()}.${ext}`;
      const sandboxPath = SANDBOX_DIR + filename;
      const dlUrl = `${BACKEND_URL}/download-video?url=${encodeURIComponent(url)}&quality=${encodeURIComponent(quality)}`;

      const result = await FileSystem.downloadAsync(dlUrl, sandboxPath);
      if (result.status !== 200) {
        try { await FileSystem.deleteAsync(sandboxPath, { idempotent: true }); } catch {}
        throw new Error(`Download failed (HTTP ${result.status}).`);
      }

      const fileInfo = await FileSystem.getInfoAsync(sandboxPath);
      if (!fileInfo.exists || fileInfo.size === 0) throw new Error('File empty or missing.');

      let asset;
      try {
        asset = await MediaLibrary.createAssetAsync(sandboxPath);
      } catch (assetErr) {
        const docPath = FileSystem.documentDirectory + filename;
        await FileSystem.copyAsync({ from: sandboxPath, to: docPath });
        asset = await MediaLibrary.createAssetAsync(docPath);
        try { await FileSystem.deleteAsync(docPath, { idempotent: true }); } catch {}
      }

      // FIX: Skip custom album creation on iOS to prevent the "Allow this app to modify this video" popup
      if (Platform.OS === 'android') {
        try {
          let album = await MediaLibrary.getAlbumAsync('VideoDownloader');
          if (album == null) await MediaLibrary.createAlbumAsync('VideoDownloader', asset, false);
          else await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
        } catch (albumErr) { console.warn('Album step failed:', albumErr.message); }
      }

      try { await FileSystem.deleteAsync(sandboxPath, { idempotent: true }); } catch {}

      setDlState('done');
      Animated.spring(successAnim, { toValue: 1, speed: 14, useNativeDriver: true }).start();
      setSuccess(Platform.OS === 'ios' ? 'Saved to Photos app!' : 'Saved to Gallery → VideoDownloader');
      setTimeout(() => { successAnim.setValue(0); reset(); }, 3500);

    } catch (e) {
      let errorMsg = e.message || 'Something went wrong.';
      if (errorMsg.includes('permission')) { errorMsg = 'Storage permission denied.'; setPermStatus('denied'); }
      setError(errorMsg); setDlState('idle');
    } finally {
      stopPulse(); setLoading(false); 
    }
  };

  const isDownloading = dlState === 'downloading';

  // ── UI States ──────────────────────────────────────────────
  if (permStatus === 'checking') return (
    <SafeAreaView style={st.safe}><StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <View style={st.center}><View style={st.loaderWrap}><View style={st.loaderRing}><ActivityIndicator color={T.accent} size="large" /></View><Text style={st.loaderText}>Setting up...</Text></View></View>
    </SafeAreaView>
  );

  if (permStatus === 'denied' || permStatus === 'blocked') return (
    <SafeAreaView style={st.safe}><StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <ScrollView contentContainerStyle={st.permScroll} showsVerticalScrollIndicator={false}>
        <View style={st.orbBig} />
        <View style={st.permIconWrap}><Text style={{ fontSize: 28 }}>{permStatus === 'blocked' ? '🔒' : '🗂️'}</Text></View>
        <Text style={st.permTitle}>{permStatus === 'blocked' ? 'Permission Blocked' : 'Allow Media Access'}</Text>
        <Text style={st.permDesc}>{permStatus === 'blocked' ? 'You denied permission previously. Please enable it in Settings.' : 'Video Downloader needs permission to save videos.'}</Text>
        {permStatus !== 'blocked' && <TouchableOpacity style={st.accentBtn} onPress={handleRequestPermission} activeOpacity={0.85}><Text style={st.accentBtnText}>Allow Access</Text></TouchableOpacity>}
        <TouchableOpacity style={st.ghostBtn} onPress={openAppSettings} activeOpacity={0.7}><Text style={st.ghostBtnText}>Open Settings →</Text></TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );

  // ── Main UI ───────────────────────────────────────────────
  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={st.ambientGlow} />

        <Animated.View style={[st.header, { opacity: headerAnim }]}>
          <View style={st.logoMark}><Text style={st.logoMarkText}>▶</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={st.appName}>Video Downloader</Text>
            <Text style={st.appSub}>1000+ platforms supported</Text>
          </View>
        </Animated.View>

        <View style={st.searchCard}>
          <Text style={st.searchLabel}>Paste a video link</Text>
          <Animated.View style={[st.inputWrap, { borderColor }]}>
            <Text style={st.inputIcon}>🔗</Text>
            <TextInput style={st.input} placeholder="youtube.com, tiktok.com..." placeholderTextColor={T.t3} value={url} onChangeText={setUrl} onFocus={onFocus} onBlur={onBlur} keyboardType="url" autoCapitalize="none" autoCorrect={false} selectionColor={T.accent} returnKeyType="go" onSubmitEditing={handleGetInfo} />
            {url.length > 0 && <TouchableOpacity onPress={() => setUrl('')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><Text style={st.clearBtn}>✕</Text></TouchableOpacity>}
          </Animated.View>
          <TouchableOpacity style={[st.accentBtn, loading && { opacity: 0.6 }]} onPress={handleGetInfo} disabled={loading} activeOpacity={0.85}>
            {loading ? <ActivityIndicator color={T.white} size="small" /> : <Text style={st.accentBtnText}>Fetch Video Info</Text>}
          </TouchableOpacity>
          {!info && !loading && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }} contentContainerStyle={{ gap: 8 }}>
              {['YouTube', 'Instagram', 'TikTok', 'Twitter/X'].map(p => (<View key={p} style={st.chip}><Text style={st.chipText}>{p}</Text></View>))}
            </ScrollView>
          )}
        </View>

        {!!error && <View style={st.errorBox}><Text style={st.errorIcon}>⚠</Text><Text style={st.errorText}>{error}</Text></View>}
        {!!success && (
          <Animated.View style={[st.successBox, { transform: [{ scale: successAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }], opacity: successAnim }]}>
            <Text style={st.successIcon}>✓</Text><View><Text style={st.successTitle}>Download complete</Text><Text style={st.successSub}>{success}</Text></View>
          </Animated.View>
        )}

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

            {/* FIX: Download Banner directly under thumbnail */}
            {isDownloading && (
              <Animated.View style={[st.dlBanner, { opacity: pulseAnim }]}>
                <ActivityIndicator color={T.accent} size="small" />
                <Text style={st.dlBannerText}>Downloading {dlQuality}… Keep app open</Text>
              </Animated.View>
            )}

            {/* FIX: Modern Horizontal Quality Row */}
            <View style={st.qualSection}>
              <Text style={st.qualHeading}>Select Quality</Text>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false} 
                contentContainerStyle={st.qualRow}
              >
                {info.qualities.map((q) => (
                  <QualityPill key={q} q={q} onPress={() => handleDownload(q)} disabled={isDownloading} active={dlQuality === q && isDownloading} />
                ))}
              </ScrollView>
            </View>

            <TouchableOpacity style={st.resetBtn} onPress={reset} disabled={isDownloading}>
              <Text style={st.resetBtnText}>← Try another link</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        <View style={st.sig}>
          <View style={st.sigDivider} /><Text style={st.sigBy}>crafted with ♥ by</Text><Text style={st.sigName}>Zeeshan</Text><View style={st.sigDot} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  scroll: { padding: 20, paddingBottom: 72 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.bg },
  loaderWrap: { alignItems: 'center', gap: 16 },
  loaderRing: { width: 60, height: 60, borderRadius: 30, borderWidth: 1, borderColor: T.accentBorder, alignItems: 'center', justifyContent: 'center', backgroundColor: T.accentSoft },
  loaderText: { fontSize: 13, color: T.t2, letterSpacing: 0.5 },
  ambientGlow: { position: 'absolute', top: -80, left: SW / 2 - 100, width: 200, height: 200, borderRadius: 100, backgroundColor: T.accentGlow, opacity: 0.1 },
  orbBig: { position: 'absolute', top: -20, left: SW / 2 - 110, width: 220, height: 220, borderRadius: 110, backgroundColor: T.accent, opacity: 0.07 },
  permScroll: { padding: 28, alignItems: 'center', paddingTop: 70, paddingBottom: 52 },
  permIconWrap: { width: 72, height: 72, borderRadius: 22, backgroundColor: T.accentSoft, borderWidth: 1, borderColor: T.accentBorder, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  permTitle: { fontSize: 26, fontWeight: '800', color: T.t1, marginBottom: 10, textAlign: 'center' },
  permDesc: { fontSize: 14, color: T.t2, textAlign: 'center', lineHeight: 22, marginBottom: 28, paddingHorizontal: 8 },
  accentBtn: { backgroundColor: T.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center', width: '100%', marginBottom: 12, shadowColor: T.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8 },
  accentBtnText: { color: T.white, fontSize: 15, fontWeight: '700' },
  ghostBtn: { paddingVertical: 12, alignItems: 'center', width: '100%' },
  ghostBtnText: { color: T.t2, fontSize: 13, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 24, gap: 14 },
  logoMark: { width: 48, height: 48, borderRadius: 14, backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center', shadowColor: T.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8, elevation: 8 },
  logoMarkText: { fontSize: 20, color: T.white },
  appName: { fontSize: 21, fontWeight: '800', color: T.t1 },
  appSub: { fontSize: 11, color: T.t2, marginTop: 2 },
  searchCard: { backgroundColor: T.card, borderRadius: 20, borderWidth: 1, borderColor: T.border, padding: 18, marginBottom: 16 },
  searchLabel: { fontSize: 12, fontWeight: '600', color: T.t2, marginBottom: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14, gap: 10 },
  inputIcon: { fontSize: 16 },
  input: { flex: 1, fontSize: 14, color: T.t1, padding: 0 },
  clearBtn: { fontSize: 14, color: T.t3, padding: 4 },
  chip: { backgroundColor: T.glass, borderRadius: 20, borderWidth: 1, borderColor: T.border, paddingHorizontal: 14, paddingVertical: 7 },
  chipText: { fontSize: 11, color: T.t2, fontWeight: '600' },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: T.redSoft, borderWidth: 1, borderColor: T.red + '28', borderRadius: 14, padding: 16, marginBottom: 16 },
  errorIcon: { fontSize: 14, color: T.red, marginTop: 1 },
  errorText: { color: T.red, fontSize: 13.5, flex: 1, lineHeight: 20 },
  successBox: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: T.greenSoft, borderWidth: 1, borderColor: T.green + '30', borderRadius: 14, padding: 16, marginBottom: 16 },
  successIcon: { fontSize: 22, color: T.green, fontWeight: '800' },
  successTitle: { fontSize: 14, fontWeight: '700', color: T.green, marginBottom: 2 },
  successSub: { fontSize: 12, color: T.green, opacity: 0.8 },
  videoCard: { backgroundColor: T.card, borderRadius: 20, borderWidth: 1, borderColor: T.border, overflow: 'hidden', marginBottom: 16 },
  thumbWrap: { position: 'relative' },
  thumb: { width: '100%', height: 220 },
  thumbOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'linear-gradient(to bottom, rgba(8,9,16,0.2), rgba(8,9,16,0.9))' }, // Fallback for RN
  thumbBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#080910CC' },
  thumbTitleText: { fontSize: 15, fontWeight: '700', color: T.t1, lineHeight: 22, marginTop: 8 },

  // NEW: Download Banner
  dlBanner: { 
    flexDirection: 'row', alignItems: 'center', gap: 12, 
    margin: 16, marginTop: 0, paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: T.accentSoft, borderRadius: 14,
    borderWidth: 1, borderColor: T.accentBorder,
  },
  dlBannerText: { fontSize: 13.5, fontWeight: '600', color: T.accent, flex: 1 },

  // NEW: Quality Row & Pills
  qualSection: { padding: 16, gap: 12 },
  qualHeading: { fontSize: 11, fontWeight: '700', color: T.t1, letterSpacing: 1, textTransform: 'uppercase' },
  qualRow: { gap: 10, paddingBottom: 4 },
  pill: { 
    flexDirection: 'row', alignItems: 'center', gap: 8, 
    paddingHorizontal: 18, paddingVertical: 12, 
    borderRadius: 50, borderWidth: 1.5,
  },
  pillIcon: { fontSize: 16 },
  pillLabel: { fontSize: 14, fontWeight: '700' },

  resetBtn: { alignItems: 'center', paddingVertical: 16, borderTopWidth: 1, borderTopColor: T.border },
  resetBtnText: { fontSize: 13, color: T.t2, fontWeight: '600' },
  tag: { alignSelf: 'flex-start', backgroundColor: '#000000AA', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { color: T.white, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  sig: { alignItems: 'center', marginTop: 40, paddingBottom: 8 },
  sigDivider: { width: 28, height: 1, backgroundColor: T.border, marginBottom: 14 },
  sigBy: { fontSize: 9.5, letterSpacing: 2.5, color: T.t3, textTransform: 'uppercase', marginBottom: 5 },
  sigName: { fontSize: 26, fontWeight: '800', color: T.accent, marginBottom: 8 },
  sigDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: T.accent },
});