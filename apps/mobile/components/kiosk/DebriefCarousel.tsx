import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
  withRepeat, runOnJS, interpolate, Extrapolation, cancelAnimation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Voice, { type SpeechResultsEvent } from '@react-native-voice/voice';
import * as Speech from 'expo-speech';
import { v4 as uuidv4 } from 'uuid';
import { saveGuest, enqueueMessage, type StoredGuest } from '../../lib/db';
import { authedFetch } from '../../lib/api';

interface Props {
  guests: StoredGuest[];
  onComplete: () => void;
  isConnected: boolean;
  wsConnected: boolean;
}

export function DebriefCarousel({ guests, onComplete, isConnected, wsConnected }: Props) {
  const [index, setIndex] = useState(0);
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [done, setDone] = useState(false);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const pulseScale = useSharedValue(1);

  // Keep mutable refs so voice callbacks always see latest values
  const indexRef = useRef(index);
  const guestsRef = useRef(guests);
  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => { guestsRef.current = guests; }, [guests]);

  // ── TTS ──
  useEffect(() => {
    const guest = guestsRef.current[index];
    if (!guest) return;
    Speech.stop();
    void Speech.speak(`Reviewing ${guest.name}`, { rate: 0.9 });
    return () => { Speech.stop(); };
  }, [index]);

  // ── Pulse animation ──
  useEffect(() => {
    if (recording) {
      pulseScale.value = withRepeat(withTiming(1.4, { duration: 600 }), -1, true);
    } else {
      cancelAnimation(pulseScale);
      pulseScale.value = withTiming(1, { duration: 150 });
    }
  }, [recording, pulseScale]);

  // ── Advance logic ──
  const advance = useCallback(() => {
    setTranscript('');
    setTextInput('');
    setTextMode(false);
    translateX.value = 0;
    translateY.value = 0;
    const nextIndex = indexRef.current + 1;
    if (nextIndex >= guestsRef.current.length) {
      setDone(true);
    } else {
      setIndex(nextIndex);
    }
  }, [translateX, translateY]);

  const advanceRef = useRef(advance);
  useEffect(() => { advanceRef.current = advance; }, [advance]);

  // ── Save note ──
  const saveNote = useCallback(async (rawNote: string) => {
    const current = guestsRef.current[indexRef.current];
    if (!current) { advanceRef.current(); return; }

    await saveGuest({ ...current, brain_dump_text: rawNote.trim() });

    if (isConnected && wsConnected) {
      authedFetch('/v1/open-house/guests', {
        method: 'POST',
        body: JSON.stringify({
          name: current.name,
          phone: current.phone,
          workingWithAgent: !!current.working_with_agent,
          brainDumpText: rawNote.trim(),
        }),
      }).catch(() => {});
    } else {
      enqueueMessage({
        id: uuidv4(),
        correlation_id: uuidv4(),
        text: `[DEBRIEF_NOTE guest_id=${current.id}] ${rawNote.trim()}`,
        platform: 'mobile',
        created_at: new Date().toISOString(),
        retry_count: 0,
      }).catch(() => {});
    }

    advanceRef.current();
  }, [isConnected, wsConnected]);

  const saveNoteRef = useRef(saveNote);
  useEffect(() => { saveNoteRef.current = saveNote; }, [saveNote]);

  // ── Voice handlers ──
  useEffect(() => {
    Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
      setTranscript(e.value?.[0] ?? '');
    };
    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const text = (e.value?.[0] ?? '').trim();
      setRecording(false);
      setTranscript('');
      if (text) {
        void saveNoteRef.current(text);
      } else {
        advanceRef.current();
      }
    };
    Voice.onSpeechError = () => {
      setRecording(false);
      setTranscript('');
      advanceRef.current();
    };
    return () => {
      Speech.stop();
      Voice.destroy().then(Voice.removeAllListeners).catch(() => {});
    };
  }, []); // register once — refs keep closures fresh

  const startRecording = useCallback(async () => {
    try {
      await Voice.start('en-US');
      setRecording(true);
      setTranscript('');
    } catch { /* mic permission denied */ }
  }, []);

  const stopRecordingNoSave = useCallback(async () => {
    try {
      await Voice.cancel();
    } catch { /* ignore */ }
    setRecording(false);
    setTranscript('');
  }, []);

  const stopRecordingWithSave = useCallback(async () => {
    try {
      await Voice.stop();
      // onSpeechResults will fire and call saveNote/advance
    } catch {
      setRecording(false);
      advanceRef.current();
    }
  }, []);

  const handleSkip = useCallback(() => {
    advanceRef.current();
  }, []);

  // ── Gesture ──
  const pan = Gesture.Pan()
    .onBegin(() => {
      isDragging.value = false;
      runOnJS(startRecording)();
    })
    .onUpdate(e => {
      translateX.value = e.translationX * 0.45;
      translateY.value = Math.min(0, e.translationY * 0.45); // only allow upward
      if (Math.abs(e.translationX) > 20 || e.translationY < -20) {
        isDragging.value = true;
      }
    })
    .onFinalize(e => {
      const dragged = isDragging.value;
      isDragging.value = false;

      if (!dragged) {
        runOnJS(stopRecordingWithSave)();
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        return;
      }

      runOnJS(stopRecordingNoSave)();

      if (e.translationX < -100 || e.velocityX < -800) {
        translateX.value = withTiming(-700, { duration: 280 }, () => runOnJS(handleSkip)());
        return;
      }

      if (e.translationY < -80 || e.velocityY < -800) {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        runOnJS(setTextMode)(true);
        return;
      }

      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  const dismissOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-60, -110], [0, 1], Extrapolation.CLAMP),
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  // ── Completion ──
  if (done) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.doneContainer}>
          <Text style={styles.doneIcon}>🚗</Text>
          <Text style={styles.doneTitle}>All done! Safe travels.</Text>
          <Text style={styles.doneSubtitle}>
            Notes will sync when you have signal.
          </Text>
          <TouchableOpacity style={styles.doneBtn} onPress={onComplete}>
            <Text style={styles.doneBtnText}>Back to Guest List</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const guest = guests[index];
  if (!guest) return null;

  // ── Text mode ──
  if (textMode) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.textModeContainer}>
            <Text style={styles.textModeTitle}>Note for {guest.name}</Text>
            <TextInput
              style={styles.textModeInput}
              value={textInput}
              onChangeText={setTextInput}
              placeholder="Type your notes here…"
              placeholderTextColor="#9CA3AF"
              multiline
              autoFocus
              maxLength={600}
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.saveTextBtn, !textInput.trim() && styles.btnDisabled]}
              onPress={() => { if (textInput.trim()) void saveNote(textInput); }}
              disabled={!textInput.trim()}
            >
              <Text style={styles.saveTextBtnText}>Save Note →</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.skipTextLink}
              onPress={() => { setTextMode(false); advance(); }}
            >
              <Text style={styles.skipTextLinkText}>Skip (no note)</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Card view ──
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.progressRow}>
        <Text style={styles.progressText}>
          {index + 1} of {guests.length} guests
        </Text>
      </View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.card, cardStyle]}>
          {/* Skip hint */}
          <Animated.View style={[styles.dismissHint, dismissOpacity]}>
            <Text style={styles.dismissText}>SKIP ✕</Text>
          </Animated.View>

          {/* Guest info */}
          <View style={styles.guestInfo}>
            <Text style={styles.guestName}>{guest.name}</Text>
            {guest.phone ? (
              <Text style={styles.guestPhone}>📞 {guest.phone}</Text>
            ) : null}
            <Text style={styles.guestAgentStatus}>
              {guest.working_with_agent ? 'Has an agent' : 'No agent yet'}
            </Text>
            {guest.brain_dump_text ? (
              <Text style={styles.existingNote} numberOfLines={2}>
                📝 {guest.brain_dump_text}
              </Text>
            ) : null}
          </View>

          {/* Recording area */}
          <View style={styles.recordingArea}>
            {recording ? (
              <View style={styles.recordingActive}>
                <Animated.View style={[styles.pulseDot, pulseStyle]} />
                <Text style={styles.transcriptText} numberOfLines={4}>
                  {transcript || 'Listening…'}
                </Text>
              </View>
            ) : (
              <View style={styles.recordingIdle}>
                <Text style={styles.micIcon}>🎙</Text>
                <Text style={styles.holdHint}>Hold anywhere to add a note</Text>
              </View>
            )}
          </View>

          <Text style={styles.gestureHint}>
            ← swipe to skip  ·  ↑ swipe to type
          </Text>
        </Animated.View>
      </GestureDetector>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#0066FF' },
  progressRow: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: 'center',
  },
  progressText: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '600' },

  // Card
  card: {
    flex: 1,
    margin: 16,
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 28,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
  },
  dismissHint: {
    position: 'absolute',
    right: 24,
    top: 24,
  },
  dismissText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#EF4444',
    letterSpacing: 1,
  },
  guestInfo: { gap: 6 },
  guestName: { fontSize: 38, fontWeight: '800', color: '#1a1a1a', lineHeight: 44 },
  guestPhone: { fontSize: 18, color: '#555' },
  guestAgentStatus: { fontSize: 15, color: '#888' },
  existingNote: { fontSize: 13, color: '#0066FF', marginTop: 4 },

  // Recording
  recordingArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
  },
  recordingIdle: { alignItems: 'center', gap: 12 },
  micIcon: { fontSize: 48 },
  holdHint: { fontSize: 17, color: '#888', textAlign: 'center' },
  recordingActive: { alignItems: 'center', gap: 16 },
  pulseDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EF4444',
  },
  transcriptText: {
    fontSize: 20,
    color: '#1a1a1a',
    textAlign: 'center',
    lineHeight: 28,
    fontStyle: 'italic',
  },
  gestureHint: {
    fontSize: 13,
    color: '#bbb',
    textAlign: 'center',
    paddingTop: 12,
  },

  // Text mode
  textModeContainer: {
    flex: 1,
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 24,
    padding: 24,
    gap: 16,
  },
  textModeTitle: { fontSize: 22, fontWeight: '700', color: '#1a1a1a' },
  textModeInput: {
    flex: 1,
    fontSize: 16,
    color: '#1a1a1a',
    backgroundColor: '#f8f8fb',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    textAlignVertical: 'top',
  },
  saveTextBtn: {
    backgroundColor: '#0066FF',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveTextBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  btnDisabled: { opacity: 0.45 },
  skipTextLink: { alignItems: 'center', paddingVertical: 8 },
  skipTextLinkText: { color: '#9CA3AF', fontSize: 15 },

  // Completion
  doneContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  doneIcon: { fontSize: 72 },
  doneTitle: { fontSize: 28, fontWeight: '800', color: '#fff', textAlign: 'center' },
  doneSubtitle: { fontSize: 16, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  doneBtn: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  doneBtnText: { color: '#0066FF', fontSize: 17, fontWeight: '700' },
});
