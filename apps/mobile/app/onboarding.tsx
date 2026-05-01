import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { usePreferencesStore } from '../store/preferences';
import { authedFetch } from '../lib/api';
import { API_BASE_URL } from '../constants/api';
import { PaywallModal } from '../components/paywall/PaywallModal';
import * as Linking from 'expo-linking';

const { width: SCREEN_W } = Dimensions.get('window');
const TOTAL_STEPS = 8; // 0..7 (step 7 = paywall)

// ─── Tone questions ───────────────────────────────────────────────────────────

interface ToneQuestion {
  key: string;
  question: string;
  type: 'text' | 'toggle' | 'slider';
  placeholders?: string[];
  tall?: boolean;
}

const TONE_QUESTIONS: ToneQuestion[] = [
  {
    key: 'emailSalutation',
    question: 'How do you typically address people in emails?',
    type: 'text',
    placeholders: ['Hi [Name],', 'Hello [Name],', 'Dear [Name],', 'Good morning [Name],', 'Hey [Name]! 👋'],
  },
  {
    key: 'textSalutation',
    question: 'How do you typically address people in text messages?',
    type: 'text',
    placeholders: ['Hey!', 'Hi [Name] 😊', 'Hey [Name], hope you\'re doing well!', 'Hi there!', '[Name]!'],
  },
  {
    key: 'emojisInComms',
    question: 'Do you want emojis in client communication?',
    type: 'toggle',
    placeholders: ['Sounds great! 🎉', 'Congratulations! 🏡', 'Looking forward to it 😊', 'Great news!', 'Wonderful! ✨'],
  },
  {
    key: 'emojisInSocial',
    question: 'Do you want emojis in social media posts?',
    type: 'toggle',
    placeholders: ['Just listed! 🏠✨', 'Market update 📊', 'Open house this Sunday! 🎪', 'New listing alert 🔑', 'Sold! 🎉'],
  },
  {
    key: 'formalityLevel',
    question: 'How formal do you want written communication to be?',
    type: 'slider',
    placeholders: ['Casual & friendly', 'Warm & professional', 'Polished & professional', 'Formal & precise', 'Highly professional'],
  },
  {
    key: 'writingSample',
    question: 'Paste a message you\'ve actually sent to a client. This teaches Claw your exact voice.',
    type: 'text',
    tall: true,
    placeholders: [
      'Hi Sarah! Just wanted to check in — found a couple new listings that match your criteria perfectly...',
      'Hey John, quick update on the offer. They countered at $650k but I think we can get them down...',
      'Hi there! Congrats again on the accepted offer. Here\'s what happens next...',
    ],
  },
];

const FORMALITY_LABELS = ['Casual', 'Warm', 'Balanced', 'Professional', 'Formal'];

// ─── Integration tiles ────────────────────────────────────────────────────────

interface IntegrationTile {
  id: string;
  label: string;
  icon: string;
  comingSoon?: boolean;
  serverSide?: boolean;
}

const INTEGRATIONS: IntegrationTile[] = [
  { id: 'gmail', label: 'Gmail', icon: '📧' },
  { id: 'google_calendar', label: 'Google Calendar', icon: '📅' },
  { id: 'twilio', label: 'SMS / Twilio', icon: '💬' },
  { id: 'hubspot', label: 'HubSpot CRM', icon: '🤝' },
  { id: 'rentcast', label: 'RentCast MLS', icon: '🏡', serverSide: true },
  { id: 'docusign', label: 'DocuSign', icon: '✍️', comingSoon: true },
];

// ─── Step 7: Onboarding Paywall ───────────────────────────────────────────────

function OnboardingPaywallStep({ onStart, onSkip }: { onStart(): void; onSkip(): void }) {
  const [paywallVisible, setPaywallVisible] = useState(false);
  const { syncAfterPurchase } = require('../store/subscription').useSubscriptionStore.getState();

  return (
    <View style={styles.stepContainer}>
      <Text style={{ fontSize: 48, marginBottom: 16 }}>⚡</Text>
      <Text style={styles.welcomeTitle}>Unlock Professional</Text>
      <Text style={styles.stepSub}>
        Start your 14-day free trial and get full access to Contract X-Ray, Content Studio,
        Route Optimization, Virtual Staging, and Open House Kiosk.
      </Text>

      <View style={{ gap: 12, marginTop: 32, width: '100%' }}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: '#6366F1' }]}
          onPress={() => setPaywallVisible(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>✦ Start 14-Day Free Trial</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onSkip} style={{ alignItems: 'center', paddingVertical: 12 }}>
          <Text style={{ color: '#9CA3AF', fontSize: 14 }}>Skip — continue on Starter</Text>
        </TouchableOpacity>
      </View>

      <PaywallModal
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
        contextTitle="Start Your Free Trial"
      />
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const setPreferences = usePreferencesStore(s => s.setPreferences);

  // Collected data (committed all at once at the end)
  const [displayName, setDisplayName] = useState('');
  const [brokerage, setBrokerage] = useState('');
  const [phone, setPhone] = useState('');
  const [primaryZip, setPrimaryZip] = useState('');
  const [toneAnswers, setToneAnswers] = useState<Record<string, string | boolean | number>>({});
  const [toneQIndex, setToneQIndex] = useState(0);
  const [llmTier, setLlmTier] = useState<'fast' | 'balanced' | 'best'>('balanced');
  const [integrationStatuses, setIntegrationStatuses] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Fetch integration statuses for step 4
  const loadIntegrations = useCallback(async () => {
    try {
      const res = await authedFetch('/v1/integrations');
      if (res.ok) {
        const data = await res.json() as { integrations: Array<{ id: string; status: string }> };
        const map: Record<string, string> = {};
        for (const s of data.integrations) map[s.id] = s.status;
        setIntegrationStatuses(map);
      }
    } catch { /* show stale */ }
  }, []);

  useEffect(() => {
    if (step === 4) loadIntegrations();
  }, [step, loadIntegrations]);

  const goTo = (next: number) => {
    const dir = next > step ? -1 : 1;
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: dir * SCREEN_W, duration: 0, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 11, useNativeDriver: true }),
    ]).start();
    setStep(next);
  };

  const next = () => goTo(step + 1);

  // ─── Finish ───
  const finish = async () => {
    setSaving(true);
    try {
      const tonePrefs: Record<string, unknown> = { ...toneAnswers };
      await authedFetch('/v1/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: displayName.trim() || undefined,
          brokerage: brokerage.trim() || undefined,
          phone: phone.trim() || undefined,
          primaryZip: /^\d{5}$/.test(primaryZip) ? primaryZip : undefined,
          llmTier,
          tonePrefs,
          onboardingDone: true,
        }),
      });
      setPreferences({
        displayName: displayName.trim() || null,
        brokerage: brokerage.trim() || null,
        phone: phone.trim() || null,
        primaryZip: /^\d{5}$/.test(primaryZip) ? primaryZip : null,
        llmTier,
        tonePrefs,
        onboardingDone: true,
        status: 'loaded',
      });
    } catch {
      // best-effort — still proceed to chat
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* Progress bar — visible for steps 1–5 only */}
      {step > 0 && step < 6 && (
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: `${(step / 5) * 100}%` }]} />
        </View>
      )}

      <Animated.View style={[styles.slide, { transform: [{ translateX: slideAnim }] }]}>
        {step === 0 && <WelcomeStep onNext={next} />}
        {step === 1 && (
          <ProfileStep
            displayName={displayName} setDisplayName={setDisplayName}
            brokerage={brokerage} setBrokerage={setBrokerage}
            phone={phone} setPhone={setPhone}
            onNext={next}
          />
        )}
        {step === 2 && (
          <MarketStep primaryZip={primaryZip} setPrimaryZip={setPrimaryZip} onNext={next} />
        )}
        {step === 3 && (
          <VoiceStep
            toneAnswers={toneAnswers} setToneAnswers={setToneAnswers}
            qIndex={toneQIndex} setQIndex={setToneQIndex}
            onDone={next}
          />
        )}
        {step === 4 && (
          <IntegrationsStep statuses={integrationStatuses} onNext={next} />
        )}
        {step === 5 && (
          <QualityStep llmTier={llmTier} setLlmTier={setLlmTier} onNext={next} />
        )}
        {step === 6 && (
          <AllSetStep
            displayName={displayName}
            primaryZip={primaryZip}
            llmTier={llmTier}
            saving={saving}
            onFinish={finish}
            onAdvance={next}
          />
        )}
        {step === 7 && (
          <OnboardingPaywallStep
            onStart={() => router.replace('/(main)/chat')}
            onSkip={() => router.replace('/(main)/chat')}
          />
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

// ─── Step 0: Welcome ──────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  return (
    <View style={styles.stepContainer}>
      <Animated.Text style={[styles.bigLogo, { transform: [{ scale: pulse }] }]}>⚡</Animated.Text>
      <Text style={styles.welcomeTitle}>Welcome to RealClaw</Text>
      <Text style={styles.welcomeSub}>Your AI-powered real estate executive</Text>

      <View style={styles.benefitList}>
        <BenefitRow icon="📊" text="Daily market briefings tailored to your territory" />
        <BenefitRow icon="✉️" text="Automated emails, texts & social media in your voice" />
        <BenefitRow icon="🏡" text="Live MLS comps & market intelligence on demand" />
      </View>

      <Text style={styles.setupNote}>Let's get you set up. It'll only take a minute.</Text>

      <TouchableOpacity style={styles.primaryBtn} onPress={onNext}>
        <Text style={styles.primaryBtnText}>Get Started →</Text>
      </TouchableOpacity>
    </View>
  );
}

function BenefitRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.benefitRow}>
      <Text style={styles.benefitIcon}>{icon}</Text>
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

// ─── Step 1: Profile ──────────────────────────────────────────────────────────

function ProfileStep({
  displayName, setDisplayName,
  brokerage, setBrokerage,
  phone, setPhone,
  onNext,
}: {
  displayName: string; setDisplayName: (v: string) => void;
  brokerage: string; setBrokerage: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  onNext: () => void;
}) {
  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepWhimsy}>First, let's get to know you. 👋</Text>
      <Text style={styles.stepTitle}>Your Profile</Text>
      <Text style={styles.stepSub}>Claw uses this to personalize every email, text, and post it writes.</Text>

      <View style={styles.form}>
        <Text style={styles.label}>Your name</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Grant Mickelsen"
          placeholderTextColor="#bbb"
          autoFocus
          returnKeyType="next"
        />
        <Text style={styles.label}>Brokerage</Text>
        <TextInput
          style={styles.input}
          value={brokerage}
          onChangeText={setBrokerage}
          placeholder="Keller Williams Realty"
          placeholderTextColor="#bbb"
          returnKeyType="next"
        />
        <Text style={styles.label}>Phone number</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="+1 (555) 000-0000"
          placeholderTextColor="#bbb"
          keyboardType="phone-pad"
          returnKeyType="done"
        />
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={onNext}>
        <Text style={styles.primaryBtnText}>Continue →</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onNext}>
        <Text style={styles.skipLink}>Skip for now</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Step 2: Market ───────────────────────────────────────────────────────────

function MarketStep({
  primaryZip, setPrimaryZip, onNext,
}: { primaryZip: string; setPrimaryZip: (v: string) => void; onNext: () => void }) {
  const [error, setError] = useState('');

  const handleContinue = () => {
    if (primaryZip && !/^\d{5}$/.test(primaryZip)) {
      setError('Please enter a valid 5-digit ZIP code.');
      return;
    }
    setError('');
    onNext();
  };

  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepWhimsy}>Where's your turf? 🗺️</Text>
      <Text style={styles.stepTitle}>Your Primary Market</Text>
      <Text style={styles.stepSub}>
        Claw pulls live market stats, active listings, and comps for your territory.
      </Text>

      <View style={styles.form}>
        <Text style={styles.label}>Primary market ZIP code</Text>
        <TextInput
          style={[styles.input, styles.inputLarge, error ? styles.inputError : null]}
          value={primaryZip}
          onChangeText={v => { setPrimaryZip(v); setError(''); }}
          placeholder="90210"
          placeholderTextColor="#bbb"
          keyboardType="numeric"
          maxLength={5}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleContinue}
        />
        {!!error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={handleContinue}>
        <Text style={styles.primaryBtnText}>Continue →</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onNext}>
        <Text style={styles.skipLink}>Skip for now</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Step 3: Voice ────────────────────────────────────────────────────────────

function VoiceStep({
  toneAnswers, setToneAnswers, qIndex, setQIndex, onDone,
}: {
  toneAnswers: Record<string, string | boolean | number>;
  setToneAnswers: (v: Record<string, string | boolean | number>) => void;
  qIndex: number;
  setQIndex: (v: number) => void;
  onDone: () => void;
}) {
  const q = TONE_QUESTIONS[qIndex]!;
  const [textVal, setTextVal] = useState('');
  const [boolVal, setBoolVal] = useState(true);
  const [sliderVal, setSliderVal] = useState(2); // 0..4
  const placeholderIdx = useRef(0);
  const [placeholder, setPlaceholder] = useState(q.placeholders?.[0] ?? '');
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Cycle placeholder text
  useEffect(() => {
    if (!q.placeholders?.length) return;
    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 0.4, duration: 0, useNativeDriver: true }),
      ]).start(() => {
        placeholderIdx.current = (placeholderIdx.current + 1) % q.placeholders!.length;
        setPlaceholder(q.placeholders![placeholderIdx.current]!);
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    }, 2500);
    return () => clearInterval(interval);
  }, [qIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset local input when question changes
  useEffect(() => {
    const saved = toneAnswers[q.key];
    if (q.type === 'text') setTextVal(typeof saved === 'string' ? saved : '');
    if (q.type === 'toggle') setBoolVal(typeof saved === 'boolean' ? saved : true);
    if (q.type === 'slider') setSliderVal(typeof saved === 'number' ? saved : 2);
    placeholderIdx.current = 0;
    setPlaceholder(q.placeholders?.[0] ?? '');
  }, [qIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAndNext = () => {
    let value: string | boolean | number;
    if (q.type === 'text') value = textVal;
    else if (q.type === 'toggle') value = boolVal;
    else value = sliderVal;

    const updated = { ...toneAnswers, [q.key]: value };
    setToneAnswers(updated);

    if (qIndex < TONE_QUESTIONS.length - 1) {
      setQIndex(qIndex + 1);
    } else {
      onDone();
    }
  };

  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepWhimsy}>Now let's find your voice. 🎙️</Text>
      <Text style={styles.stepTitle}>Your Communication Style</Text>

      <View style={styles.toneProgress}>
        {TONE_QUESTIONS.map((_, i) => (
          <View
            key={i}
            style={[styles.toneDot, i <= qIndex ? styles.toneDotActive : styles.toneDotInactive]}
          />
        ))}
      </View>

      <View style={styles.toneCard}>
        <Text style={styles.toneQuestion}>{q.question}</Text>

        {q.type === 'text' && (
          <View>
            <TextInput
              style={[styles.toneInput, q.tall ? styles.toneInputTall : null]}
              value={textVal}
              onChangeText={setTextVal}
              multiline
              placeholderTextColor="transparent"
              returnKeyType="done"
            />
            <Animated.Text style={[styles.tonePlaceholder, q.tall ? styles.tonePlaceholderTall : null, { opacity: fadeAnim }, textVal ? { opacity: 0 } : null]}>
              {placeholder}
            </Animated.Text>
          </View>
        )}

        {q.type === 'toggle' && (
          <View style={styles.toggleRow}>
            <Animated.Text style={[styles.tonePlaceholder, styles.tonePlaceholderInline, { opacity: fadeAnim }]}>
              e.g. "{placeholder}"
            </Animated.Text>
            <Switch
              value={boolVal}
              onValueChange={setBoolVal}
              trackColor={{ false: '#e0e0e0', true: '#b0c8ff' }}
              thumbColor={boolVal ? '#0066FF' : '#ccc'}
            />
          </View>
        )}

        {q.type === 'slider' && (
          <View style={styles.sliderSection}>
            <SliderRow value={sliderVal} onChange={setSliderVal} />
            <Animated.Text style={[styles.tonePlaceholder, { opacity: fadeAnim, textAlign: 'center' }]}>
              e.g. "{placeholder}"
            </Animated.Text>
          </View>
        )}
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={saveAndNext}>
        <Text style={styles.primaryBtnText}>
          {qIndex < TONE_QUESTIONS.length - 1 ? 'Next Question →' : 'Done →'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onDone}>
        <Text style={styles.skipLink}>Done with Tone For Now</Text>
      </TouchableOpacity>
    </View>
  );
}

function SliderRow({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.sliderRow}>
      {FORMALITY_LABELS.map((label, i) => (
        <TouchableOpacity key={i} onPress={() => onChange(i)} style={styles.sliderItem}>
          <View style={[styles.sliderDot, i === value ? styles.sliderDotActive : styles.sliderDotInactive]} />
          <Text style={[styles.sliderLabel, i === value ? styles.sliderLabelActive : null]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Step 4: Integrations ─────────────────────────────────────────────────────

function IntegrationsStep({
  statuses, onNext,
}: { statuses: Record<string, string>; onNext: () => void }) {
  const handleConnect = (id: string) => {
    Linking.openURL(`${API_BASE_URL}/oauth/connect/${id}`);
  };

  return (
    <ScrollView contentContainerStyle={styles.stepContainer} showsVerticalScrollIndicator={false}>
      <Text style={styles.stepWhimsy}>Gear up. 🔧</Text>
      <Text style={styles.stepTitle}>Connect Your Tools</Text>
      <Text style={styles.stepSub}>Connect the apps you use every day. You can always do this later in Settings.</Text>

      <View style={styles.integrationList}>
        {INTEGRATIONS.map(tile => {
          const status = statuses[tile.id];
          const isConnected = status === 'connected';
          return (
            <View key={tile.id} style={[styles.integrationTile, tile.comingSoon && styles.integrationTileDisabled]}>
              <Text style={styles.integrationIcon}>{tile.icon}</Text>
              <Text style={styles.integrationLabel}>{tile.label}</Text>
              {tile.comingSoon && (
                <View style={styles.chip}><Text style={styles.chipText}>Coming Soon</Text></View>
              )}
              {tile.serverSide && (
                <View style={[styles.chip, styles.chipGreen]}><Text style={[styles.chipText, styles.chipTextGreen]}>Active ✓</Text></View>
              )}
              {!tile.comingSoon && !tile.serverSide && (
                isConnected
                  ? <View style={[styles.chip, styles.chipGreen]}><Text style={[styles.chipText, styles.chipTextGreen]}>Connected ✓</Text></View>
                  : <TouchableOpacity style={styles.connectBtn} onPress={() => handleConnect(tile.id)}>
                      <Text style={styles.connectBtnText}>Connect</Text>
                    </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      <TouchableOpacity style={[styles.primaryBtn, { marginTop: 8 }]} onPress={onNext}>
        <Text style={styles.primaryBtnText}>Continue →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Step 5: AI Quality ───────────────────────────────────────────────────────

const TIERS: Array<{ id: 'fast' | 'balanced' | 'best'; icon: string; label: string; desc: string }> = [
  { id: 'fast', icon: '⚡', label: 'Fast', desc: 'Quick responses, great for real-time help and routine tasks.' },
  { id: 'balanced', icon: '⚖️', label: 'Balanced', desc: 'The default — smart, thorough, and responsive.' },
  { id: 'best', icon: '🧠', label: 'Best', desc: 'Maximum quality for important client emails and documents.' },
];

function QualityStep({
  llmTier, setLlmTier, onNext,
}: { llmTier: 'fast' | 'balanced' | 'best'; setLlmTier: (v: 'fast' | 'balanced' | 'best') => void; onNext: () => void }) {
  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepWhimsy}>How much brainpower do you want? 🧩</Text>
      <Text style={styles.stepTitle}>AI Quality</Text>
      <Text style={styles.stepSub}>You can change this anytime in Settings.</Text>

      <View style={styles.tierList}>
        {TIERS.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[styles.tierCard, llmTier === t.id && styles.tierCardSelected]}
            onPress={() => setLlmTier(t.id)}
          >
            <Text style={styles.tierIcon}>{t.icon}</Text>
            <View style={styles.tierText}>
              <Text style={[styles.tierLabel, llmTier === t.id && styles.tierLabelSelected]}>{t.label}</Text>
              <Text style={styles.tierDesc}>{t.desc}</Text>
            </View>
            {llmTier === t.id && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={onNext}>
        <Text style={styles.primaryBtnText}>Continue →</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Step 6: All Set ──────────────────────────────────────────────────────────

function AllSetStep({
  displayName, primaryZip, llmTier, saving, onFinish, onAdvance,
}: {
  displayName: string;
  primaryZip: string;
  llmTier: 'fast' | 'balanced' | 'best';
  saving: boolean;
  onFinish: () => Promise<void>;
  onAdvance: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(0.6)).current;
  const hasFinished = useRef(false);

  useEffect(() => {
    Animated.spring(scaleAnim, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }).start();
  }, [scaleAnim]);

  // Save prefs then advance to the paywall step
  useEffect(() => {
    if (hasFinished.current) return;
    hasFinished.current = true;
    onFinish().then(() => {
      setTimeout(() => onAdvance(), 2000);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tierLabel = TIERS.find(t => t.id === llmTier)?.label ?? 'Balanced';

  return (
    <View style={styles.stepContainer}>
      <Animated.Text style={[styles.bigLogo, { transform: [{ scale: scaleAnim }] }]}>🎉</Animated.Text>
      <Text style={styles.welcomeTitle}>You're all set!</Text>
      <Text style={styles.stepSub}>Claw is warming up. ⚡</Text>

      <View style={styles.summaryList}>
        {displayName ? <SummaryRow icon="👤" text={displayName} /> : null}
        {/^\d{5}$/.test(primaryZip) ? <SummaryRow icon="📍" text={`Primary market: ${primaryZip}`} /> : null}
        <SummaryRow icon="🧩" text={`AI quality: ${tierLabel}`} />
      </View>

      {saving ? (
        <ActivityIndicator size="small" color="#0066FF" style={{ marginTop: 32 }} />
      ) : (
        <Text style={styles.autoNav}>Taking you to chat…</Text>
      )}
    </View>
  );
}

function SummaryRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryIcon}>{icon}</Text>
      <Text style={styles.summaryText}>{text}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  progressTrack: { height: 3, backgroundColor: '#f0f0f5', marginHorizontal: 24, borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: '#0066FF', borderRadius: 2 },
  slide: { flex: 1 },
  stepContainer: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Welcome
  bigLogo: { fontSize: 64, marginBottom: 16 },
  welcomeTitle: { fontSize: 30, fontWeight: '800', color: '#0a0a0a', textAlign: 'center', marginBottom: 8 },
  welcomeSub: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 32 },
  benefitList: { width: '100%', gap: 16, marginBottom: 32 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  benefitIcon: { fontSize: 22 },
  benefitText: { flex: 1, fontSize: 15, color: '#444', lineHeight: 22 },
  setupNote: { fontSize: 13, color: '#999', textAlign: 'center', marginBottom: 24 },

  // Step headers
  stepWhimsy: { fontSize: 14, color: '#0066FF', fontWeight: '600', marginBottom: 6, textAlign: 'center' },
  stepTitle: { fontSize: 26, fontWeight: '800', color: '#0a0a0a', textAlign: 'center', marginBottom: 8 },
  stepSub: { fontSize: 14, color: '#777', textAlign: 'center', marginBottom: 28, lineHeight: 20 },

  // Buttons
  primaryBtn: {
    width: '100%',
    backgroundColor: '#0066FF',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  skipLink: { marginTop: 16, fontSize: 14, color: '#aaa', textDecorationLine: 'underline' },

  // Form
  form: { width: '100%', gap: 8, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginTop: 8 },
  input: {
    backgroundColor: '#f5f5fa',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputLarge: { fontSize: 32, textAlign: 'center', letterSpacing: 4, paddingVertical: 20 },
  inputError: { borderColor: '#ff3b30' },
  errorText: { fontSize: 13, color: '#ff3b30', marginTop: 4 },

  // Tone
  toneProgress: { flexDirection: 'row', gap: 6, marginBottom: 20 },
  toneDot: { width: 8, height: 8, borderRadius: 4 },
  toneDotActive: { backgroundColor: '#0066FF' },
  toneDotInactive: { backgroundColor: '#e0e0e0' },
  toneCard: {
    width: '100%',
    backgroundColor: '#f8f8fc',
    borderRadius: 16,
    padding: 20,
    marginBottom: 8,
    minHeight: 140,
  },
  toneQuestion: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginBottom: 16, lineHeight: 24 },
  toneInput: {
    fontSize: 16,
    color: '#1a1a1a',
    minHeight: 60,
    textAlignVertical: 'top',
  },
  toneInputTall: {
    minHeight: 130,
    fontSize: 14,
    lineHeight: 20,
  },
  tonePlaceholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    fontSize: 16,
    color: '#bbb',
    fontStyle: 'italic',
    pointerEvents: 'none',
  },
  tonePlaceholderTall: {
    fontSize: 14,
    lineHeight: 20,
  },
  tonePlaceholderInline: {
    position: 'relative',
    flex: 1,
    marginRight: 8,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sliderSection: { gap: 12 },
  sliderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  sliderItem: { alignItems: 'center', gap: 4 },
  sliderDot: { width: 24, height: 24, borderRadius: 12 },
  sliderDotActive: { backgroundColor: '#0066FF' },
  sliderDotInactive: { backgroundColor: '#ddd' },
  sliderLabel: { fontSize: 10, color: '#aaa', textAlign: 'center' },
  sliderLabelActive: { color: '#0066FF', fontWeight: '700' },

  // Integrations
  integrationList: { width: '100%', gap: 10, marginBottom: 8 },
  integrationTile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f8fc',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  integrationTileDisabled: { opacity: 0.5 },
  integrationIcon: { fontSize: 24 },
  integrationLabel: { flex: 1, fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  chip: { backgroundColor: '#e8eeff', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  chipGreen: { backgroundColor: '#e5f9ee' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#0066FF' },
  chipTextGreen: { color: '#1a8a4a' },
  connectBtn: {
    backgroundColor: '#0066FF',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  connectBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // AI Quality
  tierList: { width: '100%', gap: 12, marginBottom: 8 },
  tierCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f8fc',
    borderRadius: 16,
    padding: 18,
    gap: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tierCardSelected: { borderColor: '#0066FF', backgroundColor: '#f0f5ff' },
  tierIcon: { fontSize: 28 },
  tierText: { flex: 1 },
  tierLabel: { fontSize: 17, fontWeight: '700', color: '#1a1a1a', marginBottom: 2 },
  tierLabelSelected: { color: '#0066FF' },
  tierDesc: { fontSize: 13, color: '#888', lineHeight: 18 },
  checkmark: { fontSize: 20, color: '#0066FF', fontWeight: '700' },

  // All Set
  summaryList: { width: '100%', gap: 10, marginTop: 24 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  summaryIcon: { fontSize: 20 },
  summaryText: { fontSize: 16, color: '#444' },
  autoNav: { marginTop: 32, fontSize: 14, color: '#aaa' },
});
