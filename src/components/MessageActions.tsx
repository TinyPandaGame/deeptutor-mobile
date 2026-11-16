import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TextCopyActions } from './TextCopyActions';
import { ReadAloud } from '../features/read-aloud';
import { Button, C, s } from '../ui';

export function MessageActions({ text, conversation, onClose, children }: {
  text: string; conversation: string; onClose: () => void; children?: ReactNode;
}) {
  return <Modal transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable accessibilityLabel="关闭消息操作" onPress={onClose}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0006' }} />
      <SafeAreaView edges={['bottom', 'left', 'right']} style={{ maxHeight: '75%', backgroundColor: C.white, borderTopLeftRadius: 22, borderTopRightRadius: 22 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Text style={s.h2}>消息操作</Text>
          <TextCopyActions text={text} />
          <ReadAloud text={text} conversation={conversation} />
          {children}
          <Button title="取消" secondary onPress={onClose} />
        </ScrollView>
      </SafeAreaView>
    </View>
  </Modal>;
}
