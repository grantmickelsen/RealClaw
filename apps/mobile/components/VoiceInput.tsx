import { useState, useCallback } from 'react';
import { TouchableOpacity, StyleSheet, Text, Alert } from 'react-native';
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';

interface Props {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

/**
 * Press-and-hold microphone button.
 * Uses @react-native-voice/voice for real-time transcription.
 * Submits the final transcript on button release.
 */
export function VoiceInput({ onTranscript, disabled }: Props) {
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');

  const startRecording = useCallback(async () => {
    if (disabled) return;
    try {
      Voice.onSpeechResults = (e: SpeechResultsEvent) => {
        const text = e.value?.[0] ?? '';
        setInterim(text);
      };
      Voice.onSpeechError = (e: SpeechErrorEvent) => {
        console.warn('[Voice] Error:', e.error);
        setRecording(false);
        setInterim('');
      };
      await Voice.start('en-US');
      setRecording(true);
    } catch (err) {
      Alert.alert('Voice Input', 'Microphone permission required.');
    }
  }, [disabled]);

  const stopRecording = useCallback(async () => {
    if (!recording) return;
    try {
      await Voice.stop();
      const final = interim.trim();
      if (final) onTranscript(final);
    } catch (err) {
      console.warn('[Voice] Stop error:', err);
    } finally {
      setRecording(false);
      setInterim('');
      Voice.onSpeechResults = undefined as never;
      Voice.onSpeechError = undefined as never;
    }
  }, [recording, interim, onTranscript]);

  return (
    <TouchableOpacity
      style={[styles.button, recording && styles.buttonActive, disabled && styles.disabled]}
      onPressIn={startRecording}
      onPressOut={stopRecording}
      activeOpacity={0.7}
    >
      <Text style={styles.icon}>{recording ? '🔴' : '🎙️'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f0f0f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonActive: { backgroundColor: '#ffeeee' },
  disabled: { opacity: 0.4 },
  icon: { fontSize: 20 },
});
