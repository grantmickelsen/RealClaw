import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  TouchableOpacity,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin, GoogleSigninButton } from '@react-native-google-signin/google-signin';
import { useAuthStore } from '../../store/auth';
import { signInWithApple, signInWithGoogle, storeTokens } from '../../lib/auth';

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
});

export default function SignInScreen() {
  const [loading, setLoading] = useState(false);
  const { setTokens } = useAuthStore();

  async function handleAppleSignIn() {
    setLoading(true);
    try {
      const tokens = await signInWithApple();
      await storeTokens(tokens);
      setTokens(tokens);
    } catch (err) {
      if ((err as { code?: string }).code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Sign In Failed', (err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setLoading(true);
    try {
      const tokens = await signInWithGoogle();
      await storeTokens(tokens);
      setTokens(tokens);
    } catch (err) {
      Alert.alert('Sign In Failed', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>⚡ RealClaw</Text>
        <Text style={styles.tagline}>Your AI-powered real estate executive</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#0066FF" />
      ) : (
        <View style={styles.buttons}>
          {Platform.OS === 'ios' && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={12}
              style={styles.appleButton}
              onPress={handleAppleSignIn}
            />
          )}

          <GoogleSigninButton
            size={GoogleSigninButton.Size.Wide}
            color={GoogleSigninButton.Color.Light}
            onPress={handleGoogleSignIn}
            style={styles.googleButton}
          />
        </View>
      )}

      <Text style={styles.legal}>
        By signing in, you agree to our Terms of Service and Privacy Policy.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 64,
  },
  logo: {
    fontSize: 40,
    fontWeight: '700',
    color: '#0066FF',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  buttons: {
    width: '100%',
    gap: 16,
    alignItems: 'center',
  },
  appleButton: {
    width: '100%',
    height: 50,
  },
  googleButton: {
    width: '100%',
    height: 50,
  },
  legal: {
    position: 'absolute',
    bottom: 40,
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
