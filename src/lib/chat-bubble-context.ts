import { createContext, useContext } from 'react';

// Only chat bubbles hide inline controls. Reading, question details and other
// screens retain their existing text selection and action buttons.
export const ChatBubbleContext = createContext<((text?: string) => void) | null>(null);
export const useChatBubble = () => useContext(ChatBubbleContext);
