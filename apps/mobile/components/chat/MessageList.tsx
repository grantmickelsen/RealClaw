import { useCallback } from 'react';
import { FlashList } from '@shopify/flash-list';
import { View } from 'react-native';
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
            onResolved={onApprovalResolved}
          />
        </View>
      );
    }

    return <MessageBubble message={item} />;
  }, [onApprovalResolved]);

  // Reverse array so newest is at the bottom (FlashList inverted)
  const inverted = [...messages].reverse();

  return (
    <FlashList
      data={inverted}
      renderItem={renderItem}
      estimatedItemSize={80}
      inverted
      keyExtractor={item => item.id}
      ListHeaderComponent={hasInFlight ? <TypingIndicator /> : null}
      contentContainerStyle={{ paddingVertical: 8 }}
    />
  );
}
