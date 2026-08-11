import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Image,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from "react-native";
import {
  CameraView,
  CameraType,
  FlashMode,
  useCameraPermissions,
  useMicrophonePermissions,
} from "expo-camera";
import { Video, ResizeMode } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "../../utils/hooks/supabase";
import { uploadSnap, requestDub } from "../../utils/snaps";

type Props = {
  navigation?: {
    canGoBack: () => boolean;
    goBack: () => void;
  };
};

type Capture =
  | { type: "photo"; uri: string }
  | { type: "video"; uri: string };

const DUB_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
] as const;

/** Download remote dubbed MP4 to a local cache file for reliable playback. */
async function cacheRemoteVideo(remoteUrl: string) {
  const dest = `${FileSystem.cacheDirectory}dubbed-${Date.now()}.mp4`;
  const result = await FileSystem.downloadAsync(remoteUrl, dest);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Could not download dubbed video (HTTP ${result.status})`);
  }
  return result.uri;
}

function PreviewPlayer({ uri }: { uri: string }) {
  return (
    <Video
      key={uri}
      source={{ uri }}
      style={styles.previewVideo}
      resizeMode={ResizeMode.COVER}
      shouldPlay
      isLooping
      isMuted
      useNativeControls
    />
  );
}

export default function CameraScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [flash, setFlash] = useState<FlashMode>("off");
  const [isRecording, setIsRecording] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [isDubbing, setIsDubbing] = useState(false);
  const [dubStatus, setDubStatus] = useState<string | null>(null);
  const [dubbedVideoUrl, setDubbedVideoUrl] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState<(typeof DUB_LANGUAGES)[number]["code"]>("en");
  const cameraRef = useRef<CameraView>(null);
  const isRecordingRef = useRef(false);
  const longPressActiveRef = useRef(false);

  const handleClose = () => {
    if (isRecordingRef.current) {
      cameraRef.current?.stopRecording();
    }
    if (navigation?.canGoBack()) {
      navigation.goBack();
      return;
    }
    supabase.auth.signOut();
  };

  if (!permission) {
    return <View style={styles.center} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>
          Snap needs camera access to take Snaps.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
        >
          <Text style={styles.permissionButtonText}>Enable Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const takePicture = async () => {
    if (!cameraRef.current || isRecordingRef.current || !cameraReady) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) setCapture({ type: "photo", uri: photo.uri });
    } catch (error) {
      console.error("Failed to take picture:", error);
    }
  };

  const startRecording = async () => {
    if (!cameraRef.current || isRecordingRef.current || !cameraReady) {
      console.warn("Camera not ready yet — wait a second and try again.");
      return;
    }

    if (!micPermission?.granted) {
      const result = await requestMicPermission();
      if (!result.granted) {
        console.warn("Microphone permission is required to record video.");
        return;
      }
    }

    longPressActiveRef.current = true;
    isRecordingRef.current = true;
    setIsRecording(true);

    try {
      // Small delay so the long-press gesture settles before native recording starts.
      await new Promise((r) => setTimeout(r, 50));

      if (!longPressActiveRef.current || !cameraRef.current) {
        return;
      }

      const video = await cameraRef.current.recordAsync({
        maxDuration: 60,
        mute: false,
      });

      if (video?.uri) {
        // Always show preview even if audio-session helpers fail
        setCapture({ type: "video", uri: video.uri });
        setDubbedVideoUrl(null);
      } else {
        console.warn("recordAsync returned no uri", video);
      }
    } catch (error) {
      console.error("Failed to record video:", error);
    } finally {
      isRecordingRef.current = false;
      longPressActiveRef.current = false;
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    longPressActiveRef.current = false;
    if (isRecordingRef.current) {
      cameraRef.current?.stopRecording();
    }
  };

  const retake = async () => {
    setDubStatus(null);
    setDubbedVideoUrl(null);
    setCameraReady(false);
    setCapture(null);
  };

  const sendSnap = async () => {
    if (!capture) return;
    try {
      setDubStatus("Uploading to Supabase…");
      const uploaded = await uploadSnap(capture);
      setDubStatus(`Saved to Storage: ${uploaded.path}`);
      Alert.alert(
        "Uploaded",
        `Snap saved to Supabase Storage bucket "snaps":\n${uploaded.path}`,
      );
      await retake();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setDubStatus(null);
      Alert.alert(
        "Upload failed",
        `${message}\n\nMake sure you are logged in and ran supabase/sql/setup_snaps_storage.sql`,
      );
    }
  };

  const handleDub = async () => {
    if (!capture || capture.type !== "video" || isDubbing) return;

    setIsDubbing(true);
    setDubbedVideoUrl(null);

    try {
      setDubStatus("1/3 Uploading video to Supabase…");
      const uploaded = await uploadSnap(capture);

      const langLabel =
        DUB_LANGUAGES.find((l) => l.code === targetLang)?.label ?? targetLang;
      setDubStatus(`2/3 Dubbing to ${langLabel} with ElevenLabs…`);
      const result = await requestDub({
        path: uploaded.path,
        targetLang,
        // Auto-detect spoken language so English dub works from Spanish (or anything)
        sourceLang: "auto",
      });

      setDubStatus("3/3 Loading dubbed video into preview…");
      let playableUri = result.dubbedVideoUrl;
      try {
        playableUri = await cacheRemoteVideo(result.dubbedVideoUrl);
      } catch (downloadError) {
        console.warn("Local cache failed, playing remote URL", downloadError);
      }
      setDubbedVideoUrl(playableUri);
      setDubStatus(`Dubbed to ${langLabel}. Playing dubbed video.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Dubbing failed";
      setDubStatus(null);
      Alert.alert(
        "Dubbing failed",
        `${message}\n\nChecklist:\n• Logged in\n• Ran setup_snaps_storage.sql\n• Deployed dub-snap Edge Function\n• Set ELEVENLABS_API_KEY secret`,
      );
    } finally {
      setIsDubbing(false);
    }
  };

  const previewUri =
    capture?.type === "video" ? dubbedVideoUrl || capture.uri : capture?.uri;

  if (capture) {
    return (
      <View style={styles.container}>
        {capture.type === "photo" ? (
          <Image source={{ uri: capture.uri }} style={styles.previewVideo} />
        ) : previewUri ? (
          <PreviewPlayer key={previewUri} uri={previewUri} />
        ) : (
          <View style={styles.videoPreview}>
            <Text style={styles.videoPreviewLabel}>No video URI</Text>
          </View>
        )}
        {dubStatus ? (
          <View style={styles.statusBanner} pointerEvents="none">
            <Text style={styles.dubStatus}>{dubStatus}</Text>
            {dubbedVideoUrl ? (
              <Text style={styles.dubStatusSub}>Dubbed preview ready</Text>
            ) : null}
          </View>
        ) : null}
        <SafeAreaView style={styles.overlay} pointerEvents="box-none">
          <View style={styles.topBar} pointerEvents="box-none">
            <TouchableOpacity style={styles.iconButton} onPress={retake}>
              <Text style={styles.iconText}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.previewActions}>
            {capture.type === "video" ? (
              <>
                <View style={styles.langRow}>
                  {DUB_LANGUAGES.map((lang) => {
                    const selected = targetLang === lang.code;
                    return (
                      <TouchableOpacity
                        key={lang.code}
                        style={[
                          styles.langChip,
                          selected && styles.langChipSelected,
                          isDubbing && styles.buttonDisabled,
                        ]}
                        onPress={() => setTargetLang(lang.code)}
                        disabled={isDubbing}
                      >
                        <Text
                          style={[
                            styles.langChipText,
                            selected && styles.langChipTextSelected,
                          ]}
                        >
                          {lang.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity
                  style={[styles.dubButton, isDubbing && styles.buttonDisabled]}
                  onPress={handleDub}
                  disabled={isDubbing}
                >
                  {isDubbing ? (
                    <ActivityIndicator color="#111" />
                  ) : (
                    <Text style={styles.dubButtonText}>
                      {`Dub to ${DUB_LANGUAGES.find((l) => l.code === targetLang)?.label}`}
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            ) : null}
            <TouchableOpacity
              style={[styles.sendButton, isDubbing && styles.buttonDisabled]}
              onPress={sendSnap}
              disabled={isDubbing}
            >
              <Text style={styles.sendButtonText}>
                {capture.type === "video" ? "Save to Supabase ▸" : "Send To ▸"}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        flash={flash}
        mode="video"
        mute={false}
        onCameraReady={() => setCameraReady(true)}
        onMountError={(e) => {
          console.error("Camera mount error:", e);
          setCameraReady(false);
        }}
      />
      <SafeAreaView style={styles.overlay}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconButton} onPress={handleClose}>
            <Text style={styles.iconText}>✕</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => setFlash((f) => (f === "off" ? "on" : "off"))}
          >
            <Text style={styles.iconText}>{flash === "off" ? "⚡" : "⚡︎"}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomBar}>
          <View style={styles.bottomSpacer} />
          <Pressable
            onPress={takePicture}
            onLongPress={startRecording}
            onPressOut={stopRecording}
            delayLongPress={250}
            disabled={!cameraReady}
            style={[
              styles.shutterOuter,
              isRecording && styles.shutterOuterRecording,
              !cameraReady && styles.shutterDisabled,
            ]}
          >
            <View
              style={[
                styles.shutterInner,
                isRecording && styles.shutterInnerRecording,
              ]}
            />
          </Pressable>
          <TouchableOpacity
            style={styles.flipButton}
            onPress={() => {
              setCameraReady(false);
              setFacing((f) => (f === "back" ? "front" : "back"));
            }}
            disabled={isRecording}
          >
            <Text style={styles.iconText}>↺</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const YELLOW = "#FFFC00";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  permissionText: {
    color: "#fff",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: YELLOW,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  permissionButtonText: { fontWeight: "800", color: "#111" },
  previewVideo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    backgroundColor: "transparent",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: { color: "#fff", fontSize: 20 },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 40,
    paddingBottom: 30,
  },
  bottomSpacer: { width: 44 },
  shutterOuter: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  shutterOuterRecording: {
    borderColor: "#FF3B30",
  },
  shutterDisabled: {
    opacity: 0.4,
  },
  shutterInner: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: "#fff",
  },
  shutterInnerRecording: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#FF3B30",
  },
  flipButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButton: {
    alignSelf: "flex-end",
    backgroundColor: YELLOW,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
  },
  sendButtonText: { fontWeight: "800", color: "#111" },
  previewActions: {
    paddingHorizontal: 20,
    paddingBottom: 30,
    gap: 12,
    alignItems: "flex-end",
  },
  langRow: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
  },
  langChip: {
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  langChipSelected: {
    backgroundColor: "#fff",
    borderColor: "#fff",
  },
  langChipText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  langChipTextSelected: {
    color: "#111",
  },
  dubButton: {
    backgroundColor: "#fff",
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
    minWidth: 160,
    alignItems: "center",
  },
  playDubButton: {
    backgroundColor: "#A0E7E5",
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
    minWidth: 160,
    alignItems: "center",
  },
  dubButtonText: { fontWeight: "800", color: "#111" },
  buttonDisabled: { opacity: 0.6 },
  dubStatus: {
    color: "#FFFC00",
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  dubStatusSub: {
    color: "#A0E7E5",
    fontSize: 12,
    textAlign: "center",
    marginTop: 4,
  },
  statusBanner: {
    position: "absolute",
    top: 90,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 2,
  },
  videoPreview: {
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },
  videoPreviewLabel: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  videoPreviewHint: {
    color: "#aaa",
    fontSize: 14,
  },
});
