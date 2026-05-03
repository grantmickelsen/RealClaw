import { TouchableOpacity, View, StyleSheet, Modal } from 'react-native';
import { Tabs, Redirect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/auth';
import { useKioskStore } from '../../store/kiosk';
import { KioskLockedView } from '../../components/kiosk/KioskLockedView';

export default function MainLayout() {
  const status = useAuthStore(s => s.status);
  const isKioskLocked = useKioskStore(s => s.isLocked);

  if (status === 'unauthenticated') {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (status === 'loading') {
    return null;
  }

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: '#0066FF',
          tabBarInactiveTintColor: '#8e8e93',
          headerShown: false,
        }}
      >
        {/* ─── 5 visible tabs ─────────────────────────────────────────── */}
        <Tabs.Screen
          name="briefing"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="sunny-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="comms"
          options={{
            title: 'Comms',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="chatbubbles-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="growth"
          options={{
            title: 'Growth',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="trending-up-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="tours"
          options={{
            title: 'Properties',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="map-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="deals"
          options={{
            title: 'Deals',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="document-text-outline" color={color} size={size} />
            ),
          }}
        />

        {/* ─── Hidden routes — deep-link compat ──────────────────────── */}
        <Tabs.Screen name="studio"   options={{ href: null }} />
        <Tabs.Screen name="kiosk"    options={{ href: null }} />
        <Tabs.Screen name="contacts" options={{ href: null }} />
        <Tabs.Screen name="messages" options={{ href: null }} />
        <Tabs.Screen name="chat"     options={{ href: null }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
        <Tabs.Screen name="sms"          options={{ href: null }} />
        <Tabs.Screen name="subscription" options={{ href: null }} />
        <Tabs.Screen name="listings"     options={{ href: null }} />
      </Tabs>

      {/* Floating chat button — opens RealClaw conversation thread */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(main)/sms/realclaw')}
        activeOpacity={0.85}
      >
        <Ionicons name="chatbubble-ellipses" color="#fff" size={24} />
      </TouchableOpacity>

      {/* Kiosk lockdown — full-screen Modal covers everything including tab bar */}
      <Modal
        visible={isKioskLocked}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => {/* prevent hardware back from escaping kiosk */}}
      >
        <KioskLockedView />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 88,
    alignSelf: 'center',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 8,
  },
});
