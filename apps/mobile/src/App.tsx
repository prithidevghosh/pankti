import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque/700Bold';
import * as SecureStore from 'expo-secure-store';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import {
  api,
  formatMoney,
  phoneAuth,
  type AuthMode,
  type Bill,
  type Entry,
  type Item,
  type Line,
  type Qr,
  type Restaurant,
  type Task,
} from './api';

const color = {
  ink: '#1D2724',
  paper: '#F5F5ED',
  rule: '#DADFD2',
  green: '#234C40',
  gold: '#F2D777',
  white: '#FFFFFF',
  muted: '#55635A',
  error: '#833D2C',
};
const image = require('../assets/counter-print.jpg');
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Try again.';
const sessionKey = 'pankti.session';

function Button({
  label,
  onPress,
  quiet,
  disabled,
}: {
  label: string;
  onPress: () => void;
  quiet?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        quiet && styles.quietButton,
        (pressed || disabled) && styles.dim,
      ]}
    >
      <Text style={[styles.buttonText, quiet && styles.quietText]}>{label}</Text>
    </Pressable>
  );
}

function Brand() {
  return <Text style={styles.brandName}>Pankti</Text>;
}

function Login({ onSignIn }: { onSignIn: (token: string) => Promise<void> }) {
  const [mode, setMode] = useState<AuthMode>();
  const [loadingMode, setLoadingMode] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestInFlight = useRef(false);
  const locked = busy || voiceBusy;

  async function loadMode() {
    setLoadingMode(true);
    setError('');
    try {
      setMode(await phoneAuth.mode());
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setLoadingMode(false);
    }
  }

  useEffect(() => { void loadMode(); }, []);

  async function fillSignup(uri: string) {
    const details = await phoneAuth.signupVoice(uri);
    if (details.phone) setPhone(details.phone.slice(3));
    if (details.name) setName(details.name);
    if (details.businessName) setBusinessName(details.businessName);
    setVoiceStatus('Review your details and fill any blanks before continuing.');
  }

  async function submit() {
    if (!mode || voiceBusy || requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true);
    setError('');
    try {
      if (mode === 'phone-only') {
        const { token } = creating
          ? await phoneAuth.signup('+91' + phone, name, businessName)
          : await phoneAuth.login('+91' + phone);
        await onSignIn(token);
      } else if (pending) {
        const { token } = await phoneAuth.verify(pending, otp);
        await onSignIn(token);
      } else {
        const { challenge } = await phoneAuth.send('+91' + phone);
        setPending(challenge);
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.login} keyboardShouldPersistTaps="handled">
        <Brand />
        <Image
          source={image}
          style={styles.loginArtwork}
          accessibilityLabel="Abstract print of curved steel reflections and receipt paper"
        />
        <Text style={styles.title}>Say the order.{'\n'}Get the bill.</Text>
        {creating ? (
          <>
            <Text style={styles.body}>Say your name, business name and mobile number.</Text>
            <VoiceButton
              disabled={busy}
              idleLabel="Fill by voice"
              onRecording={fillSignup}
              onError={(message) => { setError(message); setVoiceStatus(''); }}
              onBusy={setVoiceBusy}
            />
            <Text style={styles.voiceLabel}>Your name</Text>
            <View style={styles.field}>
              <TextInput
                accessibilityLabel="Your name"
                autoComplete="name"
                editable={!locked}
                maxLength={96}
                onChangeText={setName}
                value={name}
                style={styles.input}
              />
            </View>
            <Text style={styles.voiceLabel}>Business name</Text>
            <View style={styles.field}>
              <TextInput
                accessibilityLabel="Business name"
                editable={!locked}
                maxLength={96}
                onChangeText={setBusinessName}
                value={businessName}
                style={styles.input}
              />
            </View>
            <Text style={styles.voiceLabel}>Mobile number</Text>
          </>
        ) : (
          <Text style={styles.body}>
            {pending ? 'Enter the six-digit code from your SMS.' : 'Sign in with your mobile number.'}
          </Text>
        )}
        <View style={styles.field}>
          {!pending && <Text style={styles.prefix}>+91</Text>}
          <TextInput
            key={pending ? 'otp' : 'phone'}
            value={pending ? otp : phone}
            onChangeText={(value) => (pending ? setOtp : setPhone)(value.replace(/\D/g, ''))}
            maxLength={pending ? 6 : 10}
            editable={!locked}
            keyboardType="number-pad"
            autoComplete={pending ? 'sms-otp' : 'tel-national'}
            accessibilityLabel={pending ? 'Verification code' : 'Mobile number'}
            placeholder={pending ? '000000' : '98765 43210'}
            placeholderTextColor={color.muted}
            style={styles.input}
          />
        </View>
        <Button
          label={mode === 'phone-only' ? (creating ? 'Create account' : 'Sign in')
            : pending ? 'Verify and sign in' : 'Send verification code'}
          disabled={!mode || locked || (pending ? otp.length !== 6 : phone.length !== 10)
            || (creating && (!name.trim() || !businessName.trim()))}
          onPress={() => void submit()}
        />
        {busy && <Text accessibilityLiveRegion="polite" style={styles.body}>
          {mode === 'phone-only' ? (creating ? 'Creating your account…' : 'Signing in…')
            : pending ? 'Checking your code…' : 'Sending your code…'}
        </Text>}
        {mode === 'phone-only' && (
          <Button
            label={creating ? 'Back to sign in' : 'Create an account'}
            quiet
            disabled={locked}
            onPress={() => { setCreating(!creating); setError(''); setVoiceStatus(''); }}
          />
        )}
        {!mode && (loadingMode ? <ActivityIndicator color={color.green} />
          : <Button label="Retry connecting" quiet onPress={() => void loadMode()} />)}
        {!!voiceStatus && <Text accessibilityLiveRegion="polite" style={styles.body}>{voiceStatus}</Text>}
        {pending && (
          <Button
            label="Start over"
            quiet
            disabled={busy}
            onPress={() => {
              setPending(undefined);
              setOtp('');
              setError('');
            }}
          />
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function VoiceButton({
  disabled,
  onRecording,
  onError,
  onBusy,
  idleLabel = 'Tap to speak',
}: {
  disabled: boolean;
  idleLabel?: string;
  onRecording: (uri: string) => Promise<void>;
  onError: (error: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [active, setActive] = useState(false);
  const [working, setWorking] = useState(false);
  const locked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function finish() {
    if (locked.current) return;
    locked.current = true;
    setWorking(true);
    clearTimeout(timer.current);
    let uri: string | null = null;
    try {
      await recorder.stop();
      setActive(false);
      uri = recorder.uri;
      if (!uri) throw new Error('No recording was saved. Try again.');
      await onRecording(uri);
    } catch (error) {
      onError(errorText(error));
    } finally {
      try {
        if (uri) new File(uri).delete();
      } catch {
        /* recorder cache may already be cleared */
      }
      setActive(false);
      setWorking(false);
      onBusy(false);
      locked.current = false;
    }
  }

  async function start() {
    if (locked.current) return;
    locked.current = true;
    onError('');
    onBusy(true);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Allow microphone access in Settings to record a voice note.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setActive(true);
      timer.current = setTimeout(() => void finish(), 26000);
    } catch (error) {
      onError(errorText(error));
      onBusy(false);
    } finally {
      locked.current = false;
    }
  }

  return (
    <View style={styles.voice}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={active ? 'Finish recording' : idleLabel}
        disabled={disabled || working}
        style={({ pressed }) => [styles.mic, active && styles.micActive, (pressed || working) && styles.dim]}
        onPress={() => void (active ? finish() : start())}
      >
        {working ? (
          <ActivityIndicator color={color.white} />
        ) : (
          <Ionicons
            name={active ? 'stop' : 'mic-outline'}
            size={34}
            color={active ? color.ink : color.white}
          />
        )}
      </Pressable>
      <Text style={styles.voiceLabel}>
        {working ? 'Reading your voice note…' : active ? 'Listening. Tap to finish' : idleLabel}
      </Text>
    </View>
  );
}

const taskTitles: Record<Task, string> = {
  onboarding: 'Set up your restaurant',
  menu: 'Add to the menu',
  order: 'Take an order',
};
const taskExamples: Record<Task, string> = {
  onboarding: 'Say the restaurant name and where it’s located.',
  menu: 'Say each dish, its size if relevant, and its price.',
  order: 'Say what the customer ordered, or dictate a correction.',
};

function Counter({ token, onSignOut, onSessionExpired }: {
  token: string;
  onSignOut: () => Promise<void>;
  onSessionExpired: () => void;
}) {
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [menu, setMenu] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<'order' | 'menu' | 'setup'>('order');
  const [setup, setSetup] = useState<{ name: string | null; city: string | null }>();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [basket, setBasket] = useState<Line[]>([]);
  const [bill, setBill] = useState<Bill | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const [text, setText] = useState('');
  const [question, setQuestion] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const requestId = useRef<string | undefined>(undefined);
  const writing = useRef(false);

  async function load() {
    setError('');
    setLoading(true);
    try {
      const data = await api(token, onSessionExpired).workspace();
      setRestaurant(data.restaurant);
      setMenu(data.menu);
      setBill(data.pendingBill);
      if (data.restaurant && !data.menu.length && !data.pendingBill) setTab('menu');
      setLoaded(true);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [token]);

  async function save(action: () => Promise<void>) {
    if (writing.current) return;
    writing.current = true;
    setSaving(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setSaving(false);
      writing.current = false;
    }
  }

  function changeTab(next: typeof tab) {
    setTab(next);
    setText('');
    setQuestion('');
    setError('');
    setReady(false);
  }

  async function record(uri: string) {
    const client = api(token, onSessionExpired);
    if (!restaurant) {
      const response = await client.voice('onboarding', uri, { previous: setup });
      setSetup({ name: response.result.name, city: response.result.city });
      setText(response.transcript);
      setQuestion(response.result.question || '');
    } else if (tab === 'menu') {
      const response = await client.voice('menu', uri, { previous: entries });
      setEntries(response.result.entries);
      setText(response.transcript);
      setQuestion(response.result.question || '');
    } else {
      const response = await client.voice('order', uri, { basket });
      setBasket(response.result.lines);
      setText(response.transcript);
      setQuestion(response.result.question || '');
      setReady(response.result.readyToBill && !response.result.question);
    }
  }

  function chooseQr(camera: boolean) {
    void save(async () => {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted)
        throw new Error('Allow camera access in Settings to photograph your QR.');
      const pick = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!pick.canceled) {
        const photo = pick.assets[0];
        setQr(await api(token, onSessionExpired).qr(photo.uri, photo.mimeType || 'image/jpeg'));
      }
    });
  }

  const task = !restaurant ? 'onboarding' : tab === 'menu' ? 'menu' : 'order';
  const draftLines = basket.flatMap((line) => {
    const item = menu.find((entry) => entry.id === line.item);
    return item ? [{ ...item, quantity: line.quantity }] : [];
  });
  const draftTotal = draftLines.reduce((acc, line) => acc + line.price * line.quantity, 0);

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <Brand />
        <Pressable
          accessibilityLabel="Sign out"
          accessibilityRole="button"
          style={styles.iconButton}
          disabled={voiceBusy || saving}
          onPress={() => {
            void onSignOut().catch((failure) => setError(errorText(failure)));
          }}
        >
          <Ionicons name="log-out-outline" size={22} color={color.green} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {loading && <ActivityIndicator color={color.green} />}
        {!loading && !loaded && <Button label="Retry workspace" quiet onPress={() => void load()} />}
        {loaded && restaurant && (
          <Text style={styles.kicker}>
            {restaurant.name} · {restaurant.city}
          </Text>
        )}
        {loaded &&
          (restaurant && tab === 'setup' ? (
            <>
              <Text style={styles.title}>Payment QR</Text>
              <Text style={styles.body}>
                Photograph the UPI card you already use. Check the payee before adding it to bills.
              </Text>
              {qr ? (
                <>
                  <Image
                    source={{ uri: qr.image }}
                    style={styles.qr}
                    accessibilityLabel="Scanned UPI payment QR"
                  />
                  <Text style={styles.body}>
                    {qr.payee} · {qr.address}
                  </Text>
                  <Button
                    label="Save this QR"
                    disabled={saving}
                    onPress={() =>
                      void save(async () => {
                        setRestaurant((await api(token, onSessionExpired).saveQr(qr.uri)).restaurant);
                        setQr(null);
                      })
                    }
                  />
                  <Button label="Scan again" quiet onPress={() => setQr(null)} />
                </>
              ) : (
                <>
                  {!!restaurant.qr && (
                    <>
                      <Image
                        source={{ uri: restaurant.qr }}
                        style={styles.qr}
                        accessibilityLabel="Saved UPI payment QR"
                      />
                      <Text style={styles.body}>{restaurant.payee}</Text>
                    </>
                  )}
                  <Button label="Photograph QR card" disabled={saving} onPress={() => chooseQr(true)} />
                  <Button label="Choose a photo" quiet disabled={saving} onPress={() => chooseQr(false)} />
                </>
              )}
            </>
          ) : tab === 'order' && bill && restaurant ? (
            <>
              <Text style={styles.title}>Bill #{String(bill.number).padStart(4, '0')}</Text>
              <Text style={styles.body}>
                {bill.paid
                  ? bill.method === 'upi'
                    ? 'UPI payment recorded'
                    : 'Cash payment recorded'
                  : 'Awaiting payment'}
              </Text>
              <View style={styles.receipt}>
                {bill.lines.map((line) => (
                  <View key={line.item} style={styles.row}>
                    <Text style={styles.rowName}>
                      {line.quantity} × {line.name} {line.variant}
                    </Text>
                    <Text style={styles.rowValue}>{formatMoney(line.price * line.quantity)}</Text>
                  </View>
                ))}
                <View style={styles.row}>
                  <Text style={styles.rowName}>Total</Text>
                  <Text style={styles.total}>{formatMoney(bill.total)}</Text>
                </View>
                {restaurant.qr && !bill.paid && (
                  <Image
                    source={{ uri: restaurant.qr }}
                    style={styles.qr}
                    accessibilityLabel="Scan to pay by UPI"
                  />
                )}
              </View>
              {bill.paid ? (
                <Button
                  label="Start next order"
                  onPress={() => {
                    setBill(null);
                    changeTab('order');
                  }}
                />
              ) : (
                <>
                  {restaurant.qr ? (
                    <>
                      <Text style={styles.body}>
                        Check the payment on your merchant app before recording UPI.
                      </Text>
                      <Button
                        label="Record verified UPI payment"
                        disabled={saving}
                        onPress={() =>
                          void save(async () => setBill((await api(token, onSessionExpired).payment(bill.id, 'upi')).bill))
                        }
                      />
                    </>
                  ) : (
                    <Button label="Set up the counter QR" quiet onPress={() => changeTab('setup')} />
                  )}
                  <Button
                    label="Record cash payment"
                    quiet
                    disabled={saving}
                    onPress={() =>
                      void save(async () => setBill((await api(token, onSessionExpired).payment(bill.id, 'cash')).bill))
                    }
                  />
                </>
              )}
            </>
          ) : (
            <>
              <Text style={styles.title}>{taskTitles[task]}</Text>
              <Text style={styles.body}>{taskExamples[task]}</Text>
              {!restaurant && (
                <Image
                  source={image}
                  style={styles.taskArtwork}
                  accessibilityLabel="Abstract counter rhythm print"
                />
              )}
              {task === 'order' && !menu.length ? (
                <Button label="Add menu items first" onPress={() => changeTab('menu')} />
              ) : (
                <VoiceButton
                  key={task}
                  disabled={saving}
                  onRecording={record}
                  onError={setError}
                  onBusy={setVoiceBusy}
                />
              )}
              {!!text && <Text style={styles.transcript}>{text}</Text>}
              {!!question && (
                <Text accessibilityLiveRegion="polite" style={styles.followup}>
                  {question}
                </Text>
              )}
              {task === 'onboarding' && setup && (
                <View style={styles.receipt}>
                  <Text style={styles.sectionTitle}>{setup.name || 'Restaurant name needed'}</Text>
                  <Text style={styles.body}>{setup.city || 'Location needed'}</Text>
                  <Button
                    label="Create restaurant"
                    disabled={saving || voiceBusy || !!question || !setup.name || !setup.city}
                    onPress={() =>
                      void save(async () => {
                        if (!setup.name || !setup.city) return;
                        setRestaurant((await api(token, onSessionExpired).setup(setup.name, setup.city)).restaurant);
                        changeTab('menu');
                      })
                    }
                  />
                </View>
              )}
              {task === 'menu' && (
                <>
                  {entries.length > 0 && (
                    <View style={styles.receipt}>
                      <Text style={styles.sectionTitle}>Menu draft</Text>
                      {entries.map((entry, index) => (
                        <View key={entry.name + ':' + entry.variant + index} style={styles.row}>
                          <Text style={styles.rowName}>
                            {entry.name} {entry.variant}
                          </Text>
                          <Text style={styles.rowValue}>{formatMoney(entry.price)}</Text>
                        </View>
                      ))}
                      <Button
                        label="Save menu items"
                        disabled={saving || voiceBusy || !!question}
                        onPress={() =>
                          void save(async () => {
                            setMenu((await api(token, onSessionExpired).menu(entries)).menu);
                            setEntries([]);
                            setText('');
                            setQuestion('');
                          })
                        }
                      />
                    </View>
                  )}
                  {menu.length > 0 && (
                    <View style={styles.receipt}>
                      <Text style={styles.sectionTitle}>Current menu</Text>
                      {menu.map((item) => (
                        <View key={item.id} style={styles.row}>
                          <Text style={styles.rowName}>
                            {item.name} {item.variant}
                          </Text>
                          <Text style={styles.rowValue}>{formatMoney(item.price)}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </>
              )}
              {task === 'order' && draftLines.length > 0 && (
                <View style={styles.receipt}>
                  <Text style={styles.sectionTitle}>{ready ? 'Confirm the bill' : 'Current order'}</Text>
                  {draftLines.map((line) => (
                    <View key={line.id} style={styles.row}>
                      <Text style={styles.rowName}>
                        {line.quantity} × {line.name} {line.variant}
                      </Text>
                      <Text style={styles.rowValue}>{formatMoney(line.price * line.quantity)}</Text>
                    </View>
                  ))}
                  <View style={styles.row}>
                    <Text style={styles.rowName}>Total</Text>
                    <Text style={styles.total}>{formatMoney(draftTotal)}</Text>
                  </View>
                  <Button
                    label="Create bill"
                    disabled={saving || voiceBusy || !!question}
                    onPress={() =>
                      void save(async () => {
                        requestId.current ??= randomUUID();
                        setBill((await api(token, onSessionExpired).bill(requestId.current, basket)).bill);
                        requestId.current = undefined;
                        setBasket([]);
                      })
                    }
                  />
                </View>
              )}
            </>
          ))}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </ScrollView>
      {restaurant && (
        <View style={styles.nav}>
          <Tab
            disabled={voiceBusy || saving}
            label="Orders"
            icon="receipt-outline"
            active={tab === 'order'}
            onPress={() => changeTab('order')}
          />
          <Tab
            disabled={voiceBusy || saving}
            label="Menu"
            icon="restaurant-outline"
            active={tab === 'menu'}
            onPress={() => changeTab('menu')}
          />
          <Tab
            disabled={voiceBusy || saving}
            label="Payment QR"
            icon="qr-code-outline"
            active={tab === 'setup'}
            onPress={() => changeTab('setup')}
          />
        </View>
      )}
    </View>
  );
}

function Tab({
  label,
  icon,
  active,
  onPress,
  disabled,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.tab, active && styles.activeTab]}
    >
      <Ionicons name={icon} size={21} color={color.green} />
      <Text style={styles.tabLabel}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>();
  const activeSession = useRef<string | null>(null);
  const [fonts, fontError] = useFonts({
    Display: BricolageGrotesque_700Bold,
    Wordmark: require('../assets/InstrumentSerif-Regular.ttf'),
  });
  useEffect(() => {
    void SecureStore.getItemAsync(sessionKey).then((session) => {
      activeSession.current = session;
      setToken(session);
    }, () => setToken(null));
  }, []);

  async function signIn(session: string) {
    try {
      await SecureStore.setItemAsync(sessionKey, session);
      activeSession.current = session;
      setToken(session);
    } catch {
      void phoneAuth.signOut(session).catch(() => {});
      throw new Error('Could not save your sign-in. Start over to request a new code.');
    }
  }

  function sessionExpired() {
    if (!token || activeSession.current !== token) return;
    activeSession.current = null;
    void SecureStore.deleteItemAsync(sessionKey).catch(() => {}).finally(() => setToken(null));
  }

  async function signOut() {
    if (!token || activeSession.current !== token) return;
    await phoneAuth.signOut(token);
    if (activeSession.current !== token) return;
    activeSession.current = null;
    try {
      await SecureStore.deleteItemAsync(sessionKey);
    } finally {
      setToken(null);
    }
  }
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="dark-content" backgroundColor={color.paper} />
        {token === undefined || (!fonts && !fontError) ? (
          <ActivityIndicator style={styles.loader} color={color.green} />
        ) : token ? (
          <Counter key={token} token={token} onSignOut={signOut} onSessionExpired={sessionExpired} />
        ) : (
          <Login onSignIn={signIn} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  fill: { flex: 1 },
  loader: { marginTop: 45 },
  login: { padding: 23, paddingBottom: 36, gap: 14 },
  header: {
    paddingHorizontal: 22,
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: color.rule,
  },
  brandName: { color: color.ink, fontFamily: 'Wordmark', fontSize: 38, letterSpacing: -0.8 },
  loginArtwork: { width: '100%', height: 202, marginTop: 8, backgroundColor: color.green },
  taskArtwork: { width: '100%', height: 96, backgroundColor: color.green },
  title: { color: color.ink, fontFamily: 'Display', fontSize: 46, letterSpacing: -2.8, lineHeight: 49 },
  body: { color: color.muted, fontSize: 15, lineHeight: 22, flexShrink: 1 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    backgroundColor: color.white,
    borderColor: color.rule,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 14,
  },
  prefix: {
    borderRightWidth: 1,
    borderColor: color.rule,
    paddingRight: 12,
    fontWeight: '600',
    color: color.ink,
  },
  input: { flex: 1, color: color.ink, fontSize: 17, paddingHorizontal: 9 },
  button: {
    backgroundColor: color.green,
    minHeight: 49,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 3,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  quietButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.rule },
  buttonText: { color: color.white, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  quietText: { color: color.green },
  dim: { opacity: 0.57 },
  error: { color: color.error, lineHeight: 21, fontSize: 14 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 28, gap: 13 },
  kicker: { color: color.green, fontWeight: '600', fontSize: 14 },
  voice: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  mic: {
    backgroundColor: color.green,
    width: 84,
    height: 84,
    borderRadius: 42,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micActive: { backgroundColor: color.gold },
  voiceLabel: { fontSize: 14, color: color.muted },
  transcript: {
    color: color.muted,
    lineHeight: 22,
    borderLeftWidth: 2,
    borderColor: color.gold,
    paddingLeft: 12,
  },
  followup: { fontSize: 15, color: color.ink, backgroundColor: '#F7EAB8', lineHeight: 21, padding: 12 },
  receipt: { backgroundColor: color.white, borderWidth: 1, borderColor: color.rule, padding: 15, gap: 9 },
  sectionTitle: { fontFamily: 'Display', fontSize: 24, color: color.ink, letterSpacing: -0.7 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 10,
    borderTopWidth: 1,
    borderColor: color.rule,
    paddingVertical: 9,
  },
  rowName: { fontSize: 15, color: color.ink, flexShrink: 1 },
  rowValue: { fontSize: 15, fontWeight: '600', color: color.ink },
  total: { fontFamily: 'Display', fontSize: 27, color: color.ink },
  qr: { width: 176, height: 176, alignSelf: 'center', backgroundColor: color.white },
  nav: {
    borderTopWidth: 1,
    borderColor: color.rule,
    flexDirection: 'row',
    backgroundColor: color.paper,
    paddingHorizontal: 12,
  },
  tab: {
    flex: 1,
    minHeight: 59,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderTopWidth: 2,
    borderColor: 'transparent',
  },
  activeTab: { borderColor: color.green, backgroundColor: '#E9EEE3' },
  tabLabel: { color: color.green, fontSize: 12, fontWeight: '600' },
});
