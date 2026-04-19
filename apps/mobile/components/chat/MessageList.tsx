import { useCallback, useMemo, useRef } from 'react';
import { FlatList, View } from 'react-native';
import type { ChatMessage } from '../../store/chat';
import { MessageBubble } from './MessageBubble';
import { StreamingBubble } from './StreamingBubble';
import { ApprovalCard } from './ApprovalCard';
import { TypingIndicator } from './TypingIndicator';

interface Props {
  messages: ChatMessage[];
  hasInFlight: boolean;
  onApprovalResolved: () => void;
}

export function MessageList({ messages, hasInFlight, onApprovalResolved }: Props) {
  // Stable ref so renderItem closure never needs to be recreated
  const onApprovalResolvedRef = useRef(onApprovalResolved);
  onApprovalResolvedRef.current = onApprovalResolved;

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => {
    if (item.status === 'streaming') {
      return <StreamingBubble correlationId={item.correlationId} />;
    }

    if (item.status === 'done' && item.hasApproval && item.approvalId) {
      return (
        <View>
          <MessageBubble message={item} />
          <ApprovalCard
            approvalId={item.approvalId}
            description={item.text}
            onResolved={() => onApprovalResolvedRef.current()}
          />
        </View>
      );
    }

    return <MessageBubble message={item} />;
  }, []); // empty deps — stable forever via ref

  // Newest-first for inverted FlatList; only recompute when messages reference changes
  const inverted = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <FlatList
      data={inverted}
      renderItem={renderItem}
      keyExtractor={item => item.id}
      inverted
      ListHeaderComponent={hasInFlight ? <TypingIndicator /> : null}
      contentContainerStyle={{ paddingVertical: 8 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      removeClippedSubviews={false}
    />
  );
}
