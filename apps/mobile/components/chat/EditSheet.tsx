import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import type { ApprovalItem } from '../../store/approvals';

interface Props {
  visible: boolean;
  item: ApprovalItem | null;
  onSave(editInstructions: string): void;
  onCancel(): void;
}

export function EditSheet({ visible, item, onSave, onCancel }: Props) {
  const [text, setText] = useState('');

  function handleOpen() {
    if (item) {
      setText(item.fullContent ?? item.preview);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }

  function handleSave() {
    const trimmed = text.trim();
    if (!trimmed) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onSave(trimmed);
  }

  if (!item) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onShow={handleOpen}
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.sheetWrapper}
      >
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Edit Content</Text>
            <Pressable onPress={onCancel} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>

          {/* Instruction note */}
          <Text style={styles.hint}>
            Edit the content below. Your changes will be sent back to the agent for revision.
          </Text>

          {/* Text editor */}
          <ScrollView style={styles.editorScroll} keyboardShouldPersistTaps="handled">
            <TextInput
              style={styles.editor}
              value={text}
              onChangeText={setText}
              multiline
              autoFocus
              textAlignVertical="top"
              placeholder="Edit the content..."
              placeholderTextColor="#9CA3AF"
            />
          </ScrollView>

          {/* Save button */}
          <Pressable
            style={({ pressed }) => [styles.saveBtn, pressed && styles.saveBtnPressed]}
            onPress={handleSave}
          >
            <Text style={styles.saveBtnText}>Save Changes →</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    maxHeight: '80%',
    minHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 20,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 999,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    fontFamily: 'ui-rounded',
  },
  cancelBtn: { padding: 4 },
  cancelText: { fontSize: 15, color: '#6B7280' },
  hint: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 12,
    lineHeight: 18,
  },
  editorScroll: {
    flex: 1,
    maxHeight: 280,
    marginBottom: 16,
  },
  editor: {
    fontSize: 16,
    color: '#1a1a1a',
    lineHeight: 26,
    fontFamily: 'ui-serif',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 14,
    minHeight: 160,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  saveBtn: {
    backgroundColor: '#0066FF',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: 'ui-rounded' },
});
