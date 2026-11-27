import { billTotals } from '../../../shared/bill-totals.mjs';
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
  useWindowDimensions,
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
  type VendorEvent,
  type VendorFields,
  type VendorLedger,
  type VendorEntry,
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
  paper: '#F7F1E4',
  rule: '#D5CDB9',
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
  const { height } = useWindowDimensions();

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

  useEffect(() => {
    void loadMode();
  }, []);

  const signupNotes = useRef<string[]>([]);
  async function fillSignup(uri: string) {
    const details = await phoneAuth.signupVoice(uri);
    if (details.noteId) signupNotes.current.push(details.noteId);
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
          ? await phoneAuth.signup('+91' + phone, name, businessName, signupNotes.current)
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
        <View style={styles.loginHead}>
          <Brand />
          {mode === 'phone-only' && (
            <Button
              label={creating ? 'Back to sign in' : 'Create an account'}
              quiet
              disabled={locked}
              onPress={() => {
                setCreating(!creating);
                setError('');
                setVoiceStatus('');
              }}
            />
          )}
        </View>
        <Image
          source={creating ? require('../assets/bill-handoff.jpg') : image}
          style={[
            styles.loginArtwork,
            { height: creating ? Math.min(112, height * 0.13) : Math.min(280, height * 0.27) },
          ]}
          accessibilityLabel={creating ? "Two ink silhouettes pass a receipt across a counter" : "Abstract print of curved steel reflections and receipt paper"}
        />
        <Text style={styles.title}>{creating ? 'Open your counter.' : 'Say the order. Get the bill.'}</Text>
        {creating ? (
          <>
            <Text style={styles.body}>Say your name, business name and mobile number.</Text>
            <VoiceButton
              disabled={busy}
              idleLabel="Fill by voice"
              onRecording={fillSignup}
              onError={(message) => {
                setError(message);
                setVoiceStatus('');
              }}
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
          label={
            mode === 'phone-only'
              ? creating
                ? 'Create account'
                : 'Sign in'
              : pending
                ? 'Verify and sign in'
                : 'Send verification code'
          }
          disabled={
            !mode ||
            locked ||
            (pending ? otp.length !== 6 : phone.length !== 10) ||
            (creating && (!name.trim() || !businessName.trim()))
          }
          onPress={() => void submit()}
        />
        {busy && (
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {mode === 'phone-only'
              ? creating
                ? 'Creating your account…'
                : 'Signing in…'
              : pending
                ? 'Checking your code…'
                : 'Sending your code…'}
          </Text>
        )}
        {!mode &&
          (loadingMode ? (
            <ActivityIndicator color={color.green} />
          ) : (
            <Button label="Retry connecting" quiet onPress={() => void loadMode()} />
          ))}
        {!!voiceStatus && (
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            {voiceStatus}
          </Text>
        )}
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={working ? 'Reading your voice note' : active ? 'Finish recording' : idleLabel}
      accessibilityState={{ disabled: disabled || working, busy: working }}
      disabled={disabled || working}
      style={({ pressed }) => [styles.mic, active && styles.micActive, (pressed || working) && styles.dim]}
      onPress={() => void (active ? finish() : start())}
    >
      {working ? (
        <ActivityIndicator color={color.white} />
      ) : (
        <Ionicons name={active ? 'stop' : 'mic-outline'} size={23} color={active ? color.ink : color.white} />
      )}
      <Text accessibilityLiveRegion="polite" style={[styles.micText, active && { color: color.ink }]}>
        {working ? 'Reading voice note…' : active ? 'Finish recording' : idleLabel}
      </Text>
    </Pressable>
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

function Counter({
  token,
  onSignOut,
  onSessionExpired,
}: {
  token: string;
  onSignOut: () => Promise<void>;
  onSessionExpired: () => void;
}) {
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [menu, setMenu] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const { height: screenHeight } = useWindowDimensions();
  const openingArt = { height: Math.max(80, Math.min(220, screenHeight * 0.23)) };
  const [tab, setTab] = useState<'order' | 'menu' | 'setup' | 'vendors'>('order');
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
  const scroll = useRef<ScrollView>(null);
  const feedback = useRef<Record<string, { text: string; question: string; ready: boolean }>>({});
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [tab, bill?.id, bill?.paid, restaurant?.id]);

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
    feedback.current[tab] = { text, question, ready };
    const previous = feedback.current[next];
    setTab(next);
    setText(previous?.text || '');
    setQuestion(previous?.question || '');
    setError('');
    setReady(previous?.ready || false);
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
      const response = await client.voice('order', uri, {
        basket,
        clarificationReply: question ? { previous: text, question } : undefined,
      });
      requestId.current = undefined;
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
  const { total: draftTotal } = billTotals(draftLines, restaurant?.gstBps ?? 0);

  const setupAction = setup && (
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
  );
  const menuAction = entries.length > 0 && (
    <Button
      label={'Save ' + entries.length + (entries.length === 1 ? ' dish' : ' dishes')}
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
  );
  const billAction = draftLines.length > 0 && (
    <Button
      label={'Create bill · ' + formatMoney(draftTotal)}
      disabled={saving || voiceBusy || !!question}
      onPress={() =>
        void save(async () => {
          requestId.current ??= randomUUID();
          try {
            const prices = Object.fromEntries(draftLines.map((line) => [line.id, line.price]));
            setBill((await api(token, onSessionExpired).bill(requestId.current, basket, prices, restaurant?.gstBps ?? 0)).bill);
          } catch (e) {
            if ((e as { status?: number }).status === 409) {
              const current = await api(token, onSessionExpired).workspace();
              setMenu(current.menu);
              setRestaurant(current.restaurant);
            }
            throw e;
          }
          feedback.current.order = { text: '', question: '', ready: false };
          setText('');
          setQuestion('');
          setReady(false);
          requestId.current = undefined;
          setBasket([]);
        })
      }
    />
  );
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
      <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {loading && <ActivityIndicator color={color.green} />}
        {!loading && !loaded && <Button label="Retry workspace" quiet onPress={() => void load()} />}
        {loaded && restaurant && (
          <Text style={styles.kicker}>
            {restaurant.name}
            {restaurant.city ? ' · ' + restaurant.city : ''}
          </Text>
        )}
        {loaded &&
          (restaurant && tab === 'vendors' ? (
            <VendorCounter reveal={() => scroll.current?.scrollTo({y:0,animated:false})} token={token} expired={onSessionExpired} onBusy={setVoiceBusy} />
          ) : restaurant && tab === 'setup' ? (
            <>
              <Image
                source={require('../assets/settlement-stamp.jpg')}
                style={styles.menuArt}
                accessible={false}
              />
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
              <Text style={styles.paymentState}>
                {bill.paid
                  ? bill.method === 'upi'
                    ? 'UPI payment recorded'
                    : 'Cash payment recorded'
                  : 'Awaiting payment'}
              </Text>
              <View style={styles.ticket}>
                <Text style={styles.billAmount}>{formatMoney(bill.total)}</Text>
                {!!bill.gstBps && <Text>Includes GST ({bill.gstBps / 100}%) · {formatMoney(bill.gstAmount ?? 0)}</Text>}
                {bill.lines.map((line) => (
                  <View key={line.item} style={styles.row}>
                    <Text style={styles.rowName}>
                      {line.quantity} × {line.name} {line.variant}
                    </Text>
                    <Text style={styles.rowValue}>{formatMoney(Math.round(line.price * line.quantity))}</Text>
                  </View>
                ))}
                {!bill.paid && restaurant.qr && (
                  <Text style={styles.body}>Check your merchant app before confirming UPI.</Text>
                )}
                {restaurant.qr && !bill.paid && (
                  <Image
                    source={{ uri: restaurant.qr }}
                    style={styles.qr}
                    accessibilityLabel="Scan to pay by UPI"
                  />
                )}
              </View>
            </>
          ) : (
            <>
              {task === 'order' && !basket.length && (
                <Image
                  source={require('../assets/order-rail.jpg')}
                  style={[styles.menuArt, openingArt]}
                  accessible={false}
                />
              )}
              {task === 'menu' && (
                <Image
                  accessible={false}
                  source={require('../assets/folded-menu.jpg')}
                  style={[styles.menuArt, !menu.length && !entries.length && openingArt]}
                />
              )}
              <Text accessibilityRole="header" style={styles.title}>
                {taskTitles[task]}
              </Text>
              <Text style={styles.body}>{taskExamples[task]}</Text>
              {!restaurant && (
                <Image
                  source={image}
                  style={styles.taskArtwork}
                  accessibilityLabel="Abstract counter rhythm print"
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
              {task === 'order' && !draftLines.length && (
                <View style={styles.ticket}>
                  <Text style={styles.sectionTitle}>Current ticket</Text>
                  <Text style={styles.body}>
                    {menu.length
                      ? 'Your ordered items and total will appear here.'
                      : 'Save your first dish to start taking orders.'}
                  </Text>
                </View>
              )}
              {task === 'order' && draftLines.length > 0 && (
                <View style={styles.ticket}>
                  <Text style={styles.sectionTitle}>{ready ? 'Confirm the bill' : 'Current order'}</Text>
                  {draftLines.map((line) => (
                    <View key={line.id} style={styles.row}>
                      <Text style={styles.rowName}>
                        {line.quantity} × {line.name} {line.variant}
                      </Text>
                      <Text style={styles.rowValue}>
                        {formatMoney(Math.round(line.price * line.quantity))}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={'Remove ' + line.name}
                        style={styles.remove}
                        disabled={saving || voiceBusy}
                        onPress={() => {
                          setBasket((old) => old.filter((x) => x.item !== line.id));
                          requestId.current = undefined;
                          setReady(false);
                        }}
                      >
                        <Ionicons name="close-outline" size={19} color={color.muted} />
                      </Pressable>
                    </View>
                  ))}
                  <View style={styles.row}>
                    <Text style={styles.rowName}>Total</Text>
                    <Text style={styles.total}>{formatMoney(draftTotal)}</Text>
                  </View>
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
      {loaded && tab !== 'vendors' && !(restaurant && tab === 'setup') && (
        <View style={styles.dock}>
          {tab === 'order' && bill && restaurant ? (
            bill.paid ? (
              <Button
                label="Start next order"
                onPress={() => {
                  setBill(null);
                  setText('');
                  setQuestion('');
                  setReady(false);
                  setError('');
                }}
              />
            ) : (
              <>
                {restaurant.qr ? (
                  <>
                    <Button
                      label="Confirm UPI received"
                      disabled={saving}
                      onPress={() =>
                        void save(async () =>
                          setBill((await api(token, onSessionExpired).payment(bill.id, 'upi')).bill),
                        )
                      }
                    />
                  </>
                ) : (
                  <Button label="Set up the counter QR" quiet onPress={() => changeTab('setup')} />
                )}
                <Button
                  label="Confirm cash received"
                  quiet={!!restaurant.qr}
                  disabled={saving}
                  onPress={() =>
                    void save(async () =>
                      setBill((await api(token, onSessionExpired).payment(bill.id, 'cash')).bill),
                    )
                  }
                />
              </>
            )
          ) : task === 'order' && !menu.length ? (
            <Button label="Add menu items first" onPress={() => changeTab('menu')} />
          ) : (
            <>
              <VoiceButton
                key={task}
                disabled={saving}
                onBusy={setVoiceBusy}
                onRecording={record}
                onError={setError}
                idleLabel={
                  task === 'menu'
                    ? 'Speak dishes and prices'
                    : task === 'order'
                      ? basket.length
                        ? 'Add or correct items'
                        : 'Speak order'
                      : 'Speak restaurant details'
                }
              />
              {task === 'onboarding' ? setupAction : task === 'menu' ? menuAction : billAction}
            </>
          )}
        </View>
      )}
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
            label="Vendors"
            icon="people-outline"
            active={tab === 'vendors'}
            onPress={() => changeTab('vendors')}
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

const eventNames = { order: 'Order placed', purchase: 'Purchase', payment: 'Payment', balance: 'Balance' };
function VendorCounter({
  reveal,
  token,
  expired,
  onBusy,
}: {
  token: string;
  reveal: () => void;
  expired: () => void;
  onBusy: (value: boolean) => void;
}) {
  const client = api(token, expired);
  const [ledger, setLedger] = useState<VendorLedger>();
  const [selected, select] = useState<VendorEvent>();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [paid, setPaid] = useState('');
  const [status, setStatus] = useState('Unpaid');
  const [preview, setPreview] = useState<VendorLedger>();
  const [entries, setEntries] = useState<VendorEntry[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const requestKey = useRef(randomUUID());
  const lock = useRef(false);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setMessage('');
    try {
      await action();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      lock.current = false;
      onBusy(false);
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    client
      .vendors()
      .then((data) => {
        if (alive) setLedger(data);
      })
      .catch((e) => {
        if (alive) setMessage(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [token]);
  function edit(event: VendorEvent, fields: VendorFields = event) {
    reveal();
    select(event);
    setEntries([]);
    setName(fields.vendor);
    setNote(fields.note);
    setAmount(String(fields.amount / 100));
    setPaid(String(fields.paid / 100));
    setStatus(fields.paid === 0 ? 'Unpaid' : fields.amount === fields.paid ? 'Paid' : 'Part paid');
    setPreview(undefined);
  }
  const total = Math.round(Number(amount) * 100);
  const fields = {
    vendor: name,
    note,
    amount: total,
    paid: status === 'Paid' ? total : status === 'Unpaid' ? 0 : Math.round(Number(paid) * 100),
  };
  const locked = busy || listening;
  async function record(uri: string) {
    if (!ledger) return;
    if (selected) {
      const { result } = await client.voice('vendorEdit', uri, { id: selected.id, draft: fields });
      if (result.question) {
        setMessage(result.question);
        return;
      }
      edit(selected, result);
      setMessage('Review your correction.');
    } else {
      const { result } = await client.voice('vendor', uri, {});
      if (result.edit) {
        const target = ledger.events.find((row) => row.id === result.edit?.id);
        if (!target || ledger.revision !== result.edit.revision)
          throw Error('Refresh entries and try again.');
        edit(target, result.edit.details);
      } else {
        requestKey.current = randomUUID();
        setEntries(result.entries);
        setMessage(result.question || (!result.entries.length ? 'No entry to record.' : ''));
      }
    }
  }
  function field(label: string, value: string, set: (v: string) => void, numeric = false) {
    return (
      <View>
        <Text style={styles.voiceLabel}>{label}</Text>
        <View style={styles.field}>
          <TextInput
            accessibilityLabel={label}
            value={value}
            editable={!locked}
            keyboardType={numeric ? 'decimal-pad' : 'default'}
            style={styles.input}
            onChangeText={(v) => {
              set(v);
              setPreview(undefined);
            }}
          />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.vendorPage}>
      <Text style={styles.title}>{selected ? 'Edit entry' : 'Vendors'}</Text>
      {ledger && (
        <VoiceButton
          disabled={busy}
          onBusy={(v) => {
            setListening(v);
            onBusy(v);
          }}
          onRecording={record}
          onError={setMessage}
          idleLabel={selected ? 'Speak correction' : 'Speak vendor entry'}
        />
      )}
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={styles.followup}>
          {message}
        </Text>
      )}
      {selected && ledger ? (
        <View style={styles.receipt}>
          <Text style={styles.sectionTitle}>{eventNames[selected.kind]}</Text>
          {field('Vendor name', name, setName)}
          {field('Amount (₹)', amount, setAmount, true)}
          <Text style={styles.voiceLabel}>Payment status</Text>
          <View style={styles.statusChoices}>
            {['Unpaid', 'Part paid', 'Paid'].map((s) => (
              <Pressable
                key={s}
                accessibilityRole="radio"
                accessibilityState={{ checked: s === status }}
                disabled={locked}
                onPress={() => {
                  setStatus(s);
                  setPreview(undefined);
                }}
                style={[styles.statusChoice, s === status && styles.selectedChoice]}
              >
                <Text style={{ color: s === status ? color.white : color.green }}>{s}</Text>
              </Pressable>
            ))}
          </View>
          {status === 'Part paid' && field('Paid amount (₹)', paid, setPaid, true)}
          {field('Entry note', note, setNote)}
          {preview && (
            <>
              <Text style={styles.sectionTitle}>Balance after correction</Text>
              {preview.balances
                .filter((b) => [name.trim(), selected.vendor].includes(b.vendor))
                .map((b) => (
                  <Text key={b.vendor} style={styles.body}>
                    {b.vendor} · {formatMoney(Math.abs(b.due))} {b.due < 0 ? 'advance' : 'due'}
                  </Text>
                ))}
            </>
          )}
          <Button
            disabled={
              locked ||
              !name.trim() ||
              !amount.trim() ||
              !Number.isFinite(total) ||
              (status === 'Part paid' && !(fields.paid > 0 && fields.paid < total))
            }
            label={preview ? 'Save correction' : 'Preview correction'}
            onPress={() =>
              void run(async () => {
                const data = await client.correctVendor(selected.id, ledger.revision, fields, !!preview);
                if (preview) {
                  setLedger(data);
                  select(undefined);
                  setPreview(undefined);
                  setMessage('Correction saved.');
                } else setPreview(data);
              })
            }
          />
          <Button
            quiet
            disabled={locked}
            label="Cancel edit"
            onPress={() => {
              select(undefined);
              setPreview(undefined);
            }}
          />
        </View>
      ) : (
        <>
          {entries.length > 0 && (
            <View style={styles.receipt}>
              {entries.map((e, i) => (
                <Text key={i} style={styles.body}>
                  {e.vendor} · {eventNames[e.kind]} · {formatMoney(e.amount)}
                </Text>
              ))}
              <Button
                label="Confirm entries"
                disabled={locked}
                onPress={() =>
                  void run(async () => {
                    setLedger(await client.postVendor(requestKey.current, entries));
                    setEntries([]);
                    setMessage('Entries saved.');
                  })
                }
              />
              <Button label="Discard" quiet disabled={locked} onPress={() => setEntries([])} />
            </View>
          )}
          {ledger && (
            <>
              <Text style={styles.sectionTitle}>Vendor balances</Text>
              {!ledger.balances.length && (
                <Text style={styles.body}>Speak a supplier purchase or payment to open the ledger.</Text>
              )}
              {ledger.balances.map((b) => (
                <View key={b.vendor} style={styles.row}>
                  <Text style={styles.rowName}>{b.vendor}</Text>
                  <Text style={styles.rowValue}>
                    {formatMoney(Math.abs(b.due))} {b.due < 0 ? 'advance' : 'due'}
                  </Text>
                </View>
              ))}
              {ledger.events.length > 0 && <Text style={styles.sectionTitle}>Recent entries</Text>}
              {ledger.events
                .filter((e) => !e.linkedPurchase)
                .map((e) => (
                  <Pressable
                    key={e.id}
                    disabled={locked}
                    accessibilityRole="button"
                    onPress={() => {
                      edit(e);
                      setMessage('');
                    }}
                    style={styles.receipt}
                  >
                    <Text style={styles.rowValue}>
                      {e.vendor} · {formatMoney(e.amount)}
                    </Text>
                    <Text style={styles.body}>
                      {eventNames[e.kind]} · {e.note}
                    </Text>
                    <Text style={styles.voiceLabel}>Edit entry</Text>
                  </Pressable>
                ))}
            </>
          )}
          <Button
            quiet
            disabled={locked}
            label="Refresh entries"
            onPress={() => void run(async () => setLedger(await client.vendors()))}
          />
        </>
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
      accessibilityLabel={label}
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
    void SecureStore.getItemAsync(sessionKey).then(
      (session) => {
        activeSession.current = session;
        setToken(session);
      },
      () => setToken(null),
    );
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
    void SecureStore.deleteItemAsync(sessionKey)
      .catch(() => {})
      .finally(() => setToken(null));
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
  login: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingBottom: 22, gap: 8 },
  header: {
    paddingHorizontal: 22,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: color.rule,
  },
  brandName: { color: color.ink, fontFamily: 'Wordmark', fontSize: 38, letterSpacing: -0.8 },
  loginArtwork: { width: '100%', height: 202, marginTop: 8, backgroundColor: color.green },
  taskArtwork: { width: '100%', height: 96, backgroundColor: color.green },
  title: { color: color.ink, fontFamily: 'Wordmark', fontSize: 42, letterSpacing: -1.3, lineHeight: 46 },
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
  loginHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  menuArt: { width: '100%', height: 72, backgroundColor: '#263b72' },
  ticket: { backgroundColor: '#fffcf6', borderTopWidth: 4, borderColor: '#987444', padding: 18, gap: 10 },
  paymentState: { fontSize: 15, fontWeight: '600', color: color.green },
  billAmount: { fontFamily: 'Wordmark', fontSize: 52, color: color.ink },
  vendorPage: { gap: 12 },
  statusChoices: { flexDirection: 'row', gap: 4 },
  statusChoice: {
    minHeight: 48,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.rule,
  },
  selectedChoice: { backgroundColor: color.green },
  dock: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderTopWidth: 1,
    borderColor: color.rule,
    gap: 6,
    backgroundColor: color.paper,
  },
  remove: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  micText: { fontSize: 16, fontWeight: '600', color: color.white, flexShrink: 1 },
  voice: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  mic: {
    backgroundColor: color.green,
    minHeight: 50,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 10,
    flexDirection: 'row',
    borderRadius: 24,
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
  sectionTitle: { fontFamily: 'Wordmark', fontSize: 28, color: color.ink, letterSpacing: -0.7 },
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
