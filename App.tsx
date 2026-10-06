import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, FlatList, Modal, Platform, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { Medication } from './src/types';
import { addMed, deleteMed, getArduinoIp, loadMeds, markTaken, setArduinoIp, todayString } from './src/storage';
import { ACTION_TAKEN, setupNotifications } from './src/notifications';
import { fetchHardwareStatus, syncHardwareTime, syncHardwareSchedules, triggerManualDispense, DispenserStatus } from './src/hardwareApi';

export default function App() {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showHardware, setShowHardware] = useState(false);
  const [arduinoIp, setIpState] = useState('');
  const [hardwareStatus, setHardwareStatus] = useState<DispenserStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const refresh = useCallback(async () => setMeds(await loadMeds()), []);

  useEffect(() => {
    refresh();
    setupNotifications().then((ok) => {
      if (!ok) Alert.alert('Notifications are off', 'Enable them in settings to get reminders.');
    });
    getArduinoIp().then((savedIp) => {
      if (savedIp) {
        setIpState(savedIp);
        checkStatus(savedIp);
      }
    });
  }, [refresh]);

  const checkStatus = async (ipToTest?: string) => {
    const targetIp = ipToTest || arduinoIp;
    if (!targetIp) return;
    setLoadingStatus(true);
    const status = await fetchHardwareStatus(targetIp);
    setHardwareStatus(status);
    setLoadingStatus(false);
  };

  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (lastResponse?.actionIdentifier === ACTION_TAKEN) {
      const medId = lastResponse.notification.request.content.data?.medId as string | undefined;
      if (medId) markTaken(medId).then(refresh);
    }
  }, [lastResponse, refresh]);

  const sorted = [...meds].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.headerRow}>
        <View>
          <Text style={s.title}>My medications</Text>
          <Text style={s.subtitle}>PillBuddy Companion App</Text>
        </View>
        <TouchableOpacity style={s.hardwareBadge} onPress={() => setShowHardware(true)}>
          <Text style={s.hardwareBadgeText}>
            ⚙️ Hardware {hardwareStatus ? '🟢' : '⚪'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Hardware Summary Card */}
      <View style={s.dispenserCard}>
        <Text style={s.dispenserTitle}>
          🤖 Dispenser: {hardwareStatus ? 'Online' : 'Not Connected'}
        </Text>
        {hardwareStatus ? (
          <Text style={s.dispenserInfo}>
            RTC: {hardwareStatus.rtcTime} | Compartment #{hardwareStatus.currentCompartment + 1}
          </Text>
        ) : (
          <Text style={s.dispenserInfo}>Configure Arduino Uno R4 WiFi IP address in Settings</Text>
        )}
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(m) => m.id}
        ListEmptyComponent={<Text style={s.empty}>No medications scheduled yet. Add one below.</Text>}
        renderItem={({ item }) => (
          <MedCard
            med={item}
            onTaken={async () => { await markTaken(item.id); refresh(); }}
            onDelete={async () => { await deleteMed(item.id); refresh(); }}
          />
        )}
      />

      <View style={s.buttonRow}>
        <Button title="+ Add medication" onPress={() => setShowAdd(true)} />
        <Button title="Dispenser Settings" color="#0066cc" onPress={() => setShowHardware(true)} />
      </View>

      <AddModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={async (input) => { await addMed(input); setShowAdd(false); refresh(); }}
      />

      <HardwareModal
        visible={showHardware}
        ip={arduinoIp}
        status={hardwareStatus}
        loading={loadingStatus}
        meds={meds}
        onClose={() => setShowHardware(false)}
        onSaveIp={async (newIp) => {
          setIpState(newIp);
          await setArduinoIp(newIp);
          checkStatus(newIp);
        }}
        onCheckStatus={() => checkStatus()}
      />
    </SafeAreaView>
  );
}

function MedCard({ med, onTaken, onDelete }: { med: Medication; onTaken: () => void; onDelete: () => void }) {
  const takenToday = med.lastTakenDate === todayString();
  const time = new Date(2000, 0, 1, med.hour, med.minute)
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const low = med.pillsRemaining <= med.pillsPerDose * 3;

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{med.name}</Text>
      <Text>{med.pillsPerDose} pill(s) daily at {time}</Text>
      <Text style={low ? s.low : undefined}>{med.pillsRemaining} pills remaining</Text>
      <View style={s.row}>
        <Button
          title={takenToday ? 'Taken today' : 'Mark as taken'}
          onPress={onTaken}
          disabled={takenToday || med.pillsRemaining === 0}
        />
        <Button title="Delete" color="#b00020" onPress={onDelete} />
      </View>
    </View>
  );
}

function AddModal({ visible, onClose, onSave }: {
  visible: boolean;
  onClose: () => void;
  onSave: (m: { name: string; pillsRemaining: number; pillsPerDose: number; hour: number; minute: number }) => void;
}) {
  const [name, setName] = useState('');
  const [pills, setPills] = useState('');
  const [perDose, setPerDose] = useState('1');
  const [time, setTime] = useState(new Date(2000, 0, 1, 9, 0));
  const [showPicker, setShowPicker] = useState(false);

  const valid = name.trim() && Number(pills) > 0 && Number(perDose) > 0;

  const save = () => {
    onSave({
      name: name.trim(),
      pillsRemaining: Number(pills),
      pillsPerDose: Number(perDose),
      hour: time.getHours(),
      minute: time.getMinutes(),
    });
    setName(''); setPills(''); setPerDose('1');
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.modalScreen}>
        <Text style={s.title}>Add medication</Text>
        <TextInput style={s.input} placeholder="Pill name (e.g. Vitamin D)" value={name} onChangeText={setName} />
        <TextInput style={s.input} placeholder="Pills remaining in container" keyboardType="number-pad" value={pills} onChangeText={setPills} />
        <TextInput style={s.input} placeholder="Pills per dose" keyboardType="number-pad" value={perDose} onChangeText={setPerDose} />
        <Button
          title={`Reminder time: ${time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
          onPress={() => setShowPicker(true)}
        />
        {showPicker && (
          <DateTimePicker
            value={time}
            mode="time"
            onChange={(_, picked) => {
              if (Platform.OS === 'android') setShowPicker(false);
              if (picked) setTime(picked);
            }}
          />
        )}
        <View style={s.row}>
          <Button title="Cancel" onPress={onClose} />
          <Button title="Save" onPress={save} disabled={!valid} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function HardwareModal({
  visible, ip, status, loading, meds, onClose, onSaveIp, onCheckStatus
}: {
  visible: boolean;
  ip: string;
  status: DispenserStatus | null;
  loading: boolean;
  meds: Medication[];
  onClose: () => void;
  onSaveIp: (ip: string) => void;
  onCheckStatus: () => void;
}) {
  const [inputIp, setInputIp] = useState(ip);
  const [actionMsg, setActionMsg] = useState('');

  useEffect(() => {
    setInputIp(ip);
  }, [ip]);

  const handleManualDispense = async () => {
    setActionMsg('Triggering manual dispense...');
    const ok = await triggerManualDispense(inputIp);
    setActionMsg(ok ? '✅ Dispense sequence started!' : '❌ Dispense request failed');
  };

  const handleSyncTime = async () => {
    setActionMsg('Syncing phone time to Arduino RTC...');
    const ok = await syncHardwareTime(inputIp);
    setActionMsg(ok ? '✅ RTC Time synced!' : '❌ Time sync failed');
    onCheckStatus();
  };

  const handleSyncSchedules = async () => {
    setActionMsg('Syncing medication schedules...');
    const ok = await syncHardwareSchedules(inputIp, meds);
    setActionMsg(ok ? '✅ Schedules synced!' : '❌ Schedule sync failed');
    onCheckStatus();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.modalScreen}>
        <Text style={s.title}>Arduino R4 WiFi Dispenser</Text>
        
        <Text style={s.label}>Dispenser IP Address</Text>
        <TextInput
          style={s.input}
          placeholder="e.g. 192.168.1.150"
          value={inputIp}
          onChangeText={setInputIp}
          autoCapitalize="none"
        />

        <View style={s.row}>
          <Button title="Save IP" onPress={() => onSaveIp(inputIp)} />
          <Button title="Test Connection" onPress={onCheckStatus} />
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#0066cc" style={{ marginVertical: 12 }} />
        ) : (
          <View style={s.statusBox}>
            <Text style={s.statusHeader}>Hardware Status:</Text>
            <Text>Connection: {status ? '🟢 Connected' : '🔴 Disconnected'}</Text>
            {status && (
              <>
                <Text>RTC Clock: {status.rtcTime}</Text>
                <Text>Current Carousel Slot: #{status.currentCompartment + 1} / 7</Text>
                <Text>Dispenser State: {status.isDispensing ? '⚙️ Rotating' : 'Idle'}</Text>
                <Text>Active Schedules: {status.scheduleCount}</Text>
              </>
            )}
          </View>
        )}

        {actionMsg ? <Text style={s.actionText}>{actionMsg}</Text> : null}

        <View style={s.actionGroup}>
          <Button
            title="🐾 Test Dispense (51.4° Turn + Servo + Bark)"
            color="#2e7d32"
            onPress={handleManualDispense}
          />
          <Button
            title="⏰ Sync Phone Time to Arduino RTC"
            color="#5c6bc0"
            onPress={handleSyncTime}
          />
          <Button
            title="📅 Sync Schedules to Arduino"
            color="#0288d1"
            onPress={handleSyncSchedules}
          />
        </View>

        <View style={{ marginTop: 'auto' }}>
          <Button title="Done" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12, paddingTop: 48, backgroundColor: '#f9f9fb' },
  modalScreen: { flex: 1, padding: 20, gap: 14, backgroundColor: '#ffffff' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 26, fontWeight: '700', color: '#1a1a1a' },
  subtitle: { fontSize: 14, color: '#666', marginTop: 2 },
  hardwareBadge: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#eee', borderRadius: 16 },
  hardwareBadgeText: { fontSize: 13, fontWeight: '600', color: '#333' },
  dispenserCard: { padding: 14, borderRadius: 12, backgroundColor: '#e8f0fe', marginBottom: 8 },
  dispenserTitle: { fontSize: 16, fontWeight: '600', color: '#1967d2' },
  dispenserInfo: { fontSize: 13, color: '#3c4043', marginTop: 4 },
  empty: { marginTop: 24, textAlign: 'center', color: '#666' },
  card: { padding: 16, borderRadius: 12, backgroundColor: '#ffffff', marginBottom: 12, gap: 4, borderWidth: 1, borderColor: '#e0e0e0' },
  cardTitle: { fontSize: 20, fontWeight: '600' },
  low: { color: '#b00020', fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333' },
  statusBox: { padding: 14, backgroundColor: '#f5f5f5', borderRadius: 8, gap: 4, marginVertical: 6 },
  statusHeader: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  actionText: { textAlign: 'center', fontWeight: '600', color: '#333', marginVertical: 4 },
  actionGroup: { gap: 10, marginVertical: 8 },
});
