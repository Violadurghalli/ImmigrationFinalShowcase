import React, { useState, useCallback, useEffect } from "react";
import { GiftedChat } from "react-native-gifted-chat";
import { useHeaderHeight } from "@react-navigation/elements";

const BOT_USER = {
  _id: 2,
  name: "Isabella",
  avatar: "https://loremflickr.com/140/140?lock=2",
};

const REPLIES = [
  "In React Native, use Flexbox for layout — flex: 1 is your friend.",
  "Try FlatList for long lists instead of mapping inside ScrollView.",
  "Expo Go is great for quick previews; use a dev build for native modules.",
  "useEffect runs after render — put side effects (API calls) there.",
  "SafeAreaView (or useSafeAreaInsets) keeps UI clear of notches.",
];

function pickReply(text) {
  const lower = text.toLowerCase();
  if (lower.includes("expo")) {
    return "Expo wraps React Native tooling. Start with `npx expo start`.";
  }
  if (lower.includes("style") || lower.includes("css")) {
    return "RN uses StyleSheet objects, not CSS files. Properties are camelCase.";
  }
  if (lower.includes("nav") || lower.includes("screen")) {
    return "React Navigation stacks + tabs are the usual pattern for screen flow.";
  }
  return REPLIES[Math.floor(Math.random() * REPLIES.length)];
}

export default function RNHelperChatbot() {
  const [messages, setMessages] = useState([]);
  const headerHeight = useHeaderHeight();

  useEffect(() => {
    setMessages([
      {
        _id: 1,
        text: "Hi! I'm RN Helper. Ask about Expo, styles, navigation, or lists.",
        createdAt: new Date(),
        user: BOT_USER,
      },
    ]);
  }, []);

  const onSend = useCallback((newMessages = []) => {
    setMessages((previousMessages) =>
      GiftedChat.append(previousMessages, newMessages),
    );

    const userText = newMessages[0]?.text?.trim();
    if (!userText) return;

    setTimeout(() => {
      setMessages((previousMessages) =>
        GiftedChat.append(previousMessages, [
          {
            _id: Date.now() + 1,
            text: pickReply(userText),
            createdAt: new Date(),
            user: BOT_USER,
          },
        ]),
      );
    }, 600);
  }, []);

  return (
    <GiftedChat
      messages={messages}
      onSend={(msgs) => onSend(msgs)}
      user={{ _id: 1 }}
      keyboardAvoidingViewProps={{ keyboardVerticalOffset: headerHeight }}
    />
  );
}
