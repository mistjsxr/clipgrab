import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { createNeonClient, mediaQueue } from '@clipgrab/db';
import { isValidMediaUrl, createMediaJobPayload } from '@clipgrab/core-downloader';
import { MediaJob, PairingPayload } from '@clipgrab/types';

const SECURE_STORE_KEY = 'clipgrab_mobile_pairing';

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [pairingPayload, setPairingPayload] = useState<PairingPayload | null>(null);
  const [scanning, setScanning] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [loading, setLoading] = useState(false);

  // Check saved credentials on launch
  useEffect(() => {
    async function loadSavedPairing() {
      try {
        const stored = await SecureStore.getItemAsync(SECURE_STORE_KEY);
        if (stored) {
          const parsed: PairingPayload = JSON.parse(stored);
          setPairingPayload(parsed);
          fetchQueue(parsed.databaseUrl);
        }
      } catch (e) {
        console.error('Failed to load secure store pairing payload:', e);
      }
    }
    loadSavedPairing();
  }, []);

  const fetchQueue = async (databaseUrl: string) => {
    try {
      const client = createNeonClient(databaseUrl);
      const records = await client.select().from(mediaQueue);
      const mappedJobs: MediaJob[] = records.map((r) => ({
        id: r.id,
        url: r.url,
        title: r.title || undefined,
        platform: r.platform as MediaJob['platform'],
        status: r.status as MediaJob['status'],
        requestedByDeviceId: r.requestedByDeviceId,
        progress: r.progress,
        filePath: r.filePath || undefined,
        error: r.error || undefined,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
      setJobs(mappedJobs);
    } catch (err: any) {
      console.error('Mobile fetchQueue error:', err);
    }
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    setScanning(false);
    try {
      const jsonStr = atob(data);
      const parsed: PairingPayload = JSON.parse(jsonStr);
      if (!parsed.databaseUrl || !parsed.passId) {
        throw new Error('Invalid QR payload format');
      }

      await SecureStore.setItemAsync(SECURE_STORE_KEY, JSON.stringify(parsed));
      setPairingPayload(parsed);
      Alert.alert('Paired Successfully!', 'Your mobile app is now connected to your Mac Command Center database.');
      fetchQueue(parsed.databaseUrl);
    } catch (err: any) {
      Alert.alert('Pairing Failed', 'Could not read valid ClipGrab QR payload. Error: ' + err?.message);
    }
  };

  const handleEnqueue = async () => {
    if (!urlInput.trim() || !pairingPayload) return;
    if (!isValidMediaUrl(urlInput)) {
      Alert.alert('Invalid URL', 'Please enter a supported media URL (YouTube, Twitter/X, TikTok, Instagram, Direct link).');
      return;
    }

    setLoading(true);
    try {
      const client = createNeonClient(pairingPayload.databaseUrl);
      const payload = createMediaJobPayload(urlInput, 'mobile_app');

      await client.insert(mediaQueue).values({
        id: payload.id,
        url: payload.url,
        title: payload.title,
        platform: payload.platform,
        status: payload.status,
        requestedByDeviceId: payload.requestedByDeviceId,
        progress: 0,
      });

      setUrlInput('');
      Alert.alert('Sent to Mac!', 'The download task has been enqueued to your Mac Command Center.');
      fetchQueue(pairingPayload.databaseUrl);
    } catch (err: any) {
      Alert.alert('Enqueue Error', err?.message || 'Failed to send URL to database');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    Alert.alert(
      'Reset Connection',
      'Are you sure you want to clear pairing settings?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await SecureStore.deleteItemAsync(SECURE_STORE_KEY);
            setPairingPayload(null);
            setJobs([]);
          },
        },
      ]
    );
  };

  // Scanner View
  if (scanning) {
    if (!permission?.granted) {
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.centerBox}>
            <Text style={styles.cardText}>Camera permission is required to scan QR code.</Text>
            <TouchableOpacity style={styles.button} onPress={requestPermission}>
              <Text style={styles.buttonText}>Grant Permission</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.container}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          onBarcodeScanned={handleBarCodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
        />
        <View style={styles.scannerOverlay}>
          <TouchableOpacity style={styles.closeButton} onPress={() => setScanning(false)}>
            <Text style={styles.buttonText}>Cancel Scan</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#060814" />
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={styles.title}>
              CLIP<Text style={{ color: '#ff007f' }}>GRAB</Text>
            </Text>
            <Text style={styles.subtitle}>CROSS-DEVICE MEDIA SYNC</Text>
          </View>
          {pairingPayload && (
            <TouchableOpacity style={styles.resetButton} onPress={handleReset}>
              <Text style={styles.resetButtonText}>RESET</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.body}>
        {!pairingPayload ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>PAIR DEVICE</Text>
            <Text style={styles.cardText}>
              Scan the setup QR code displayed in your ClipGrab Desktop dashboard to automatically connect your serverless Neon Postgres instance.
            </Text>
            <TouchableOpacity style={styles.button} onPress={() => setScanning(true)}>
              <Text style={styles.buttonText}>SCAN DESKTOP QR</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.mainContent}>
            {/* Input Bar */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>SEND LINK TO QUEUE</Text>
              <TextInput
                style={styles.input}
                placeholder="Paste video/audio URL..."
                placeholderTextColor="#3e4a68"
                value={urlInput}
                onChangeText={setUrlInput}
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.button} onPress={handleEnqueue} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.buttonText}>ENQUEUE TASK</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Queue List */}
            <View style={styles.queueHeader}>
              <Text style={styles.queueTitle}>MEDIA QUEUE</Text>
              <TouchableOpacity onPress={() => fetchQueue(pairingPayload.databaseUrl)}>
                <Text style={styles.refreshText}>REFRESH QUEUE</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={jobs}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.jobItem}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={styles.jobTitle} numberOfLines={1}>
                      {item.title || item.url}
                    </Text>
                    <Text style={styles.jobSub}>
                      {item.platform.toUpperCase()} • NODE: {item.requestedByDeviceId.toUpperCase()}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.statusBadge,
                      item.status === 'completed'
                        ? styles.statusCompleted
                        : item.status === 'downloading'
                        ? styles.statusDownloading
                        : item.status === 'failed'
                        ? styles.statusFailed
                        : styles.statusPending,
                    ]}
                  >
                    {item.status}
                  </Text>
                </View>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>No active media tasks in queue.</Text>}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060814' },
  header: { paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#101426' },
  title: { fontSize: 20, fontWeight: '900', letterSpacing: 1.5, color: '#8b5cf6' },
  subtitle: { fontSize: 9, color: '#4a5578', fontWeight: '900', letterSpacing: 1, marginTop: 2 },
  body: { flex: 1, padding: 16 },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  mainContent: { flex: 1 },
  card: { backgroundColor: '#0a0d1c', borderRadius: 8, padding: 18, borderWidth: 1, borderColor: '#101426', marginBottom: 16 },
  cardTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: '#00f0ff', marginBottom: 8 },
  cardText: { fontSize: 13, color: '#7a88b0', lineHeight: 18, marginBottom: 14 },
  input: { backgroundColor: '#060814', borderWidth: 1, borderColor: '#1a203a', borderRadius: 6, padding: 12, color: '#f8fafc', marginBottom: 12, fontSize: 13, fontFamily: 'System' },
  button: { backgroundColor: '#8b5cf6', paddingVertical: 12, borderRadius: 6, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: '#6d28d9' },
  buttonText: { color: '#ffffff', fontWeight: '900', fontSize: 11, letterSpacing: 1 },
  resetButton: { paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ff007f50', borderRadius: 4 },
  resetButtonText: { color: '#ff007f', fontWeight: '900', fontSize: 9, letterSpacing: 1 },
  scannerOverlay: { position: 'absolute', bottom: 40, left: 20, right: 20 },
  closeButton: { backgroundColor: '#ff007f', padding: 14, borderRadius: 6, alignItems: 'center' },
  queueHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 8 },
  queueTitle: { color: '#4a5578', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  refreshText: { color: '#8b5cf6', fontSize: 11, fontWeight: '700' },
  jobItem: { backgroundColor: '#0a0d1c', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#101426', marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobTitle: { color: '#f8fafc', fontSize: 13, fontWeight: '700' },
  jobSub: { color: '#4a5578', fontSize: 9, fontWeight: '700', marginTop: 3 },
  statusBadge: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, textTransform: 'uppercase', borderWidth: 1 },
  statusPending: { backgroundColor: '#2d1a03', color: '#f59e0b', borderColor: '#d9770640' },
  statusDownloading: { backgroundColor: '#022329', color: '#00f0ff', borderColor: '#00f0ff40' },
  statusCompleted: { backgroundColor: '#022e1b', color: '#34d399', borderColor: '#05966940' },
  statusFailed: { backgroundColor: '#2d020d', color: '#ff007f', borderColor: '#e11d4840' },
  emptyText: { color: '#3e4a68', fontSize: 12, textAlign: 'center', marginTop: 30, fontWeight: '500' },
});
