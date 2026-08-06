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
import { Camera, CameraView, useCameraPermissions } from 'expo-camera';
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
      <StatusBar barStyle="light-content" backgroundColor="#020617" />
      <View style={styles.header}>
        <Text style={styles.title}>ClipGrab Mobile</Text>
        <Text style={styles.subtitle}>Cross-Device Media Grabber</Text>
      </View>

      <View style={styles.body}>
        {!pairingPayload ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pair with Mac Command Center</Text>
            <Text style={styles.cardText}>
              Scan the QR code displayed on your ClipGrab Desktop screen to connect your serverless Neon Database.
            </Text>
            <TouchableOpacity style={styles.button} onPress={() => setScanning(true)}>
              <Text style={styles.buttonText}>Scan Desktop QR Code</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.mainContent}>
            {/* Input Bar */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Send Link to Mac</Text>
              <TextInput
                style={styles.input}
                placeholder="Paste video/audio URL..."
                placeholderTextColor="#64748b"
                value={urlInput}
                onChangeText={setUrlInput}
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.button} onPress={handleEnqueue} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.buttonText}>Enqueue Task to Mac</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Queue List */}
            <View style={styles.queueHeader}>
              <Text style={styles.queueTitle}>Shared Downloads Queue</Text>
              <TouchableOpacity onPress={() => fetchQueue(pairingPayload.databaseUrl)}>
                <Text style={styles.refreshText}>Refresh</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={jobs}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.jobItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.jobTitle} numberOfLines={1}>
                      {item.title || item.url}
                    </Text>
                    <Text style={styles.jobSub}>{item.platform.toUpperCase()} • {item.requestedByDeviceId}</Text>
                  </View>
                  <Text
                    style={[
                      styles.statusBadge,
                      item.status === 'completed'
                        ? styles.statusCompleted
                        : item.status === 'downloading'
                        ? styles.statusDownloading
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
  container: { flex: 1, backgroundColor: '#020617' },
  header: { padding: 20, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#818cf8' },
  subtitle: { fontSize: 13, color: '#94a3b8', marginTop: 2 },
  body: { flex: 1, padding: 16 },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  mainContent: { flex: 1 },
  card: { backgroundColor: '#0f172a', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#1e293b', marginBottom: 16 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#f8fafc', marginBottom: 8 },
  cardText: { fontSize: 13, color: '#94a3b8', lineHeight: 18, marginBottom: 14 },
  input: { backgroundColor: '#020617', borderWidth: 1, borderColor: '#334155', borderRadius: 8, padding: 12, color: '#f8fafc', marginBottom: 12, fontSize: 14 },
  button: { backgroundColor: '#4f46e5', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontWeight: '600', fontSize: 14 },
  scannerOverlay: { position: 'absolute', bottom: 40, left: 20, right: 20 },
  closeButton: { backgroundColor: '#e11d48', padding: 14, borderRadius: 10, alignItems: 'center' },
  queueHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  queueTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '600' },
  refreshText: { color: '#818cf8', fontSize: 13 },
  jobItem: { backgroundColor: '#0f172a', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#1e293b', marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '500' },
  jobSub: { color: '#64748b', fontSize: 11, marginTop: 2 },
  statusBadge: { fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, textTransform: 'capitalize' },
  statusPending: { backgroundColor: '#451a03', color: '#f59e0b' },
  statusDownloading: { backgroundColor: '#1e1b4b', color: '#818cf8' },
  statusCompleted: { backgroundColor: '#064e3b', color: '#34d399' },
  emptyText: { color: '#64748b', fontSize: 13, textAlign: 'center', marginTop: 20 },
});
