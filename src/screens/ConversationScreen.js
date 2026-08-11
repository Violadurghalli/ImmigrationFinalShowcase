import React, { useState, useRef } from "react";
import {
  SafeAreaView,
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

const CHAT_API_URL = process.env.EXPO_PUBLIC_CHAT_API_URL;

var myHeaders = new Headers();

myHeaders.append("Content-Type", "application/json");
myHeaders.append("Accept", "application/json");
myHeaders.append("Authorization", "Bearer " + CHAT_API_URL);

export default function ConversationScreen({ route }) {
  const { chatbotName } = route.params;

  const [message, setMessage] = useState("");
  
  const [messages, setMessages] = useState([
    {
      id: "1",
      sender: "bot",
      name: chatbotName,
      text: "¡Hola! ¿Cómo te va hoy?",
      color: "#FF2D55", 
      translatedText: "Hello! How are you doing today?",
    }
  ]);
  
  const listRef = useRef();

  async function sendMessage() {
    if (!message.trim()) return;

    const currentText = message;
    const userMsgId = Date.now().toString();

    // 1. Instantly display YOUR original English message
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        sender: "me",
        name: "ME",
        text: currentText,
        color: "#00A7B5", 
      },
    ]);
    
    setMessage("");

    // 2. Build history for OpenAI using ONLY the original language texts
    const conversationHistory = messages.map((msg) => ({
      role: msg.sender === "me" ? "user" : "assistant",
      content: msg.text 
    }));
    conversationHistory.push({ role: "user", content: currentText });

    // 3. Define the single JSON System Prompt
    const systemPrompt = `You are a helpful Spanish-speaking friend chatting on Snapchat. 
Your goal is to keep the conversation going naturally in Spanish.
When the user sends a message, you must respond strictly in JSON format with three properties:
1. "userTranslation": Translate the user's latest English message into Spanish.
2. "reply": Your natural, friendly conversational reply to the user in Spanish.
3. "replyTranslation": The English translation of your reply.

Respond ONLY with valid JSON.`;

    const messagesPayload = [
      { role: "system", content: systemPrompt },
      ...conversationHistory
    ];

    try {
      if (!CHAT_API_URL) {
        throw new Error("EXPO_PUBLIC_CHAT_API_URL is not configured");
      }

      const raw = JSON.stringify({
    "model": "gpt-4o-mini",
    "messages": messagesPayload,
    "temperature": 1,
    "top_p": 1,
    "n": 1,
    "stream": false,
    "max_tokens": 250,
    "presence_penalty": 0,
    "frequency_penalty": 0
  });

      const requestOptions = {
    method: 'POST',
    headers: myHeaders,
    body: raw,
    redirect: 'follow'
  };

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions", requestOptions
  );

      const data = await response.json();
      
      if (data.choices && data.choices.length > 0) {
        const content = data.choices[0].message.content;
        
        // Parse the JSON data returned by OpenAI
        const parsed = JSON.parse(content);
        const botMsgId = (Date.now() + 1).toString();

        // 4. Update the UI all at once
        setMessages((prev) => {
          // First, add the translation to the user's message
          const updatedMessages = prev.map((msg) => 
            msg.id === userMsgId ? { ...msg, translatedText: parsed.userTranslation } : msg
          );
          
          // Next, append the bot's response with its translation
          return [
            ...updatedMessages,
            {
              id: botMsgId,
              sender: "bot",
              name: chatbotName,
              text: parsed.reply, // Original Spanish
              translatedText: parsed.replyTranslation, // English translation
              color: "#FF2D55"
            }
          ];
        });
      } else {
        console.error("OpenAI Error:", data);
      }
    } catch (error) {
      console.error("Failed to fetch or parse OpenAI response:", error);
    }
  }

  function renderMessage({ item }) {
    return (
      <View style={styles.messageWrapper}>
        <Text style={[styles.sender, { color: item.color }]}>
          {item.name}
        </Text>

        <View style={[styles.messageRow, { borderLeftColor: item.color }]}>
          <Text style={styles.messageText}>{item.text}</Text>
        </View>

        {item.translatedText && (
          <View style={styles.translationContainer}>
            <View style={styles.translationRow}>
              <Text style={styles.messageText}>{item.translatedText}</Text>
            </View>
            <Text style={styles.translationBadge}>TRANSLATION IN BETA</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          ref={listRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        />

        <View style={styles.inputBar}>
          <TouchableOpacity>
            <Ionicons name="camera" size={27} color="#000" />
          </TouchableOpacity>

          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Chat"
            style={styles.input}
            onSubmitEditing={sendMessage}
          />

          {message.length > 0 ? (
            <TouchableOpacity onPress={sendMessage} style={styles.sendButton}>
              <Ionicons name="arrow-up" size={22} color="white" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity>
              <Ionicons name="mic" size={24} />
            </TouchableOpacity>
          )}

          <TouchableOpacity>
            <Text style={styles.emoji}>🙂</Text>
          </TouchableOpacity>

          <TouchableOpacity>
            <Ionicons name="add-circle-outline" size={28} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  messages: { paddingHorizontal: 12, paddingBottom: 20, paddingTop: 10 },
  messageWrapper: { marginVertical: 10 },
  sender: { fontSize: 11, textTransform: "uppercase", fontWeight: "700", marginBottom: 4, letterSpacing: 0.5 },
  messageRow: { borderLeftWidth: 3, paddingLeft: 8, paddingVertical: 2 },
  messageText: { fontSize: 17, color: "#111" },
  translationContainer: { marginTop: 4 },
  translationRow: {
    borderLeftWidth: 3,
    borderLeftColor: "#1B9E62",
    backgroundColor: "#E4F7EC",
    paddingLeft: 8,
    paddingVertical: 3,
    paddingRight: 12,
    alignSelf: "flex-start",
  },
  translationBadge: { fontSize: 9, color: "#A1A1A1", fontWeight: "600", marginTop: 4, letterSpacing: 0.5 },
  inputBar: {
    height: 55, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 12, borderTopWidth: 1, borderColor: "#eee"
  },
  input: { flex: 1, height: 40, backgroundColor: "#F1F1F5", borderRadius: 20, paddingHorizontal: 18, fontSize: 17 },
  emoji: { fontSize: 25 },
  sendButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#0A84FF", justifyContent: "center", alignItems: "center" }
});
