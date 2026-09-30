import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, FlatList, Modal, Platform, SafeAreaView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { Medication } from './src/types';
import { addMed, deleteMed, loadMeds, markTaken, todayString } from './src/storage';
import { ACTION_TAKEN, setupNotifications } from './src/notifications';

export default function App() {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const refresh = useCallback(async () => setMeds(await loadMeds()), []);

  // Runs once: load data, ask for notification permission.
  useEffect(() => {
    refresh();
    setupNotifications().then((ok) => {
      if (!ok) Alert.alert('Notifications are off', 'Enable them in settings to get reminders.');
    });
  }, [refresh]);

  // Handles tapping "Mark as taken" on a notification (also when the app was closed).
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (lastResponse?.actionIdentifier === ACTION_TAKEN) {
      const medId = lastResponse.notification.request.content.data?.medId as string | undefined;
      if (medId) markTaken(medId).then(refresh); // safe to repeat: only counts once per day
    }
  }, [lastResponse, refresh]);

  const sorted = [...meds].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

  return (
    <SafeAreaView style={s.screen}>
      <Text style={s.title}>My medications</Text>
      <FlatList
        data={sorted}
        keyExtractor={(m) => m.id}
        ListEmptyComponent={<Text style={s.empty}>No medications yet. Add one below.</Text>}
        renderItem={({ item }) => (
          <MedCard
            med={item}
            onTaken={async () => { await markTaken(item.id); refresh(); }}
            onDelete={async () => { await deleteMed(item.id); refresh(); }}
          />
        )}
      />
      <Button title="+ Add medication" onPress={() => setShowAdd(true)} />
      <AddModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={async (input) => { await addMed(input); setShowAdd(false); refresh(); }}
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
      <SafeAreaView style={s.screen}>
        <Text style={s.title}>Add medication</Text>
        <TextInput style={s.input} placeholder="Pill name" value={name} onChangeText={setName} />
        <TextInput style={s.input} placeholder="Pills remaining" keyboardType="number-pad" value={pills} onChangeText={setPills} />
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

const s = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12, paddingTop: 48 },
  title: { fontSize: 28, fontWeight: '600' },
  empty: { marginTop: 24, textAlign: 'center', color: '#666' },
  card: { padding: 16, borderRadius: 12, backgroundColor: '#f3f0ea', marginBottom: 12, gap: 4 },
  cardTitle: { fontSize: 20, fontWeight: '600' },
  low: { color: '#b00020', fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16 },
});
