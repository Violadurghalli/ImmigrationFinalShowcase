import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import Ionicons from "@expo/vector-icons/Ionicons";
import Header from "../components/Header";
import BasicChatbot from "../chatbots/BasicChatbot";
import RNHelperChatbot from "../chatbots/RNHelperChatbot";

export const CHATBOTS = {
  BasicChatbot: {
    id: "BasicChatbot",
    name: "React Native Chatbot",
    imageUrl: "https://loremflickr.com/140/140",
    component: BasicChatbot,
  },
  RNHelperChatbot: {
    id: "RNHelperChatbot",
    name: "RN Helper",
    imageUrl: "https://loremflickr.com/140/140?lock=2",
    component: RNHelperChatbot,
  },
};

export default function ChatScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  const chats = Object.values(CHATBOTS);

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          marginBottom: tabBarHeight,
        },
      ]}
    >
      <Header title="Chat" />

      {chats.map((chat) => (
        <View key={chat.id} style={styles.userButton}>
          <TouchableOpacity
            style={styles.userMain}
            onPress={() =>
              navigation.navigate("Conversation", {
                chatbotName: chat.name,
                chatId: chat.id,
              })
            }
          >
            <Ionicons name="person-circle" size={48} color="#D8D8D8" />
            <Text style={styles.userName}>{chat.name}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.navigate("ChatCamera")}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="camera-outline" size={24} color="#999" />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },

  userButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderColor: "#EFEFEF",
  },

  userMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },

  userName: {
    flex: 1,
    marginLeft: 15,
    fontSize: 18,
    fontWeight: "600",
  },
});
