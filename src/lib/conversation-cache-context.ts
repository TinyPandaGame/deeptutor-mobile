import { createContext, useContext } from 'react';
export const ConversationCacheContext = createContext('');
export const useConversationCache = () => useContext(ConversationCacheContext);
