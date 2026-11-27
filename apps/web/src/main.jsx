import { openPhoneVerification } from './phone-email.js';
import { Profile } from './Profile.jsx';
import { Wordmark } from './Wordmark.jsx';
import { BillReceipt } from './BillReceipt.jsx';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UserRound, Banknote, BookOpen, Truck, ArrowRight, ArrowUpRight, ChartNoAxesColumn, LogOut, ReceiptText, RefreshCw, Utensils } from 'lucide-react';
import '@fontsource-variable/bricolage-grotesque';
import './style.css';
import { SignupVoice } from './SignupVoice.jsx';

import { request, asRupees } from './api.js';
import { Orders, Vendors, Menu, Bank } from './Operations.jsx';
import './dashboard.css';

const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', dateStyle: 'short' });
const time = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
});
const today = () => day.format(new Date());

const orderWords = [
  ['en', 'order.'],
  ['hi', 'ऑर्डर।'],
  ['bn', 'অর্ডার।'],
  ['ta', 'ஆர்டர்.'],
  ['te', 'ఆర్డర్.'],
];

function CounterHeadline() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer;
    function syncRotation() {
      window.clearInterval(timer);
      if (preference.matches) setActive(0);
      else timer = window.setInterval(() => setActive((index) => (index + 1) % orderWords.length), 2600);
    }
    syncRotation();
    preference.addEventListener('change', syncRotation);
    return () => {
      window.clearInterval(timer);
      preference.removeEventListener('change', syncRotation);
    };
  }, []);

  return (
    <h1 aria-label="Say the order. Get the bill.">
      <span aria-hidden="true" className="hero-first-line">
        Say the
        <span className="rotating-word">
          {orderWords.map(([language, word], index) => (
            <span key={language} lang={language} className={index === active ? 'is-current' : undefined}>
              {word}
            </span>
          ))}
        </span>
      </span>
      <span aria-hidden="true" className="hero-last-line">
        Get the bill.
      </span>
    </h1>
  );
}

function Login({ onSignIn, mode, phoneEmailClientId }) {
  const localPhoneOnly = mode === 'phone-only';
  const allowSignup = localPhoneOnly || Boolean(phoneEmailClientId);
  const verification = useRef(null);
  useEffect(() => () => verification.current?.abort(), []);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestInFlight = useRef(false);
  const signupNotes = useRef([]);

  async function submit(event) {
    event.preventDefault();
    if (requestInFlight.current || voiceBusy) return;
    requestInFlight.current = true;
    setBusy(true);
    setError('');
    try {
      if (phoneEmailClientId) {
        verification.current = new AbortController();
        const receipt = await openPhoneVerification(phoneEmailClientId, phone, verification.current.signal);
        await request('/auth/phone-email', { body: { receipt, phone: '+91' + phone,
          ...(creating && { signup: { name, businessName, signupNotes: signupNotes.current } }) } });
        await onSignIn();
      } else if (localPhoneOnly) {
        const form = { phone: '+91' + phone, client: 'web' };
        const body = creating ? { ...form, name, businessName, signupNotes: signupNotes.current } : form;
        await request(creating ? '/auth/signup' : '/auth/login', { body });
        onSignIn();
      } else if (confirmation) {
        await request('/auth/verify', { body: { challenge: confirmation, code, client: 'web' } });
        onSignIn();
      } else {
        const { challenge } = await request('/auth/send', { body: { phone: '+91' + phone } });
        setConfirmation(challenge);
      }
    } catch (failure) {
      setError(failure.message || 'Could not sign in. Try again.');
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }

  const status = busy
    ? phoneEmailClientId ? 'Complete verification in the open window.' : localPhoneOnly ? (creating ? 'Creating your account…' : 'Signing in…')
      : confirmation ? 'Checking your code…' : 'Sending your code…'
    : voiceStatus;
  const locked = busy || voiceBusy;

  async function fillSignup(audio) {
    const body = new FormData();
    const extension = audio.type.startsWith('audio/mp4') ? 'm4a'
      : audio.type.startsWith('audio/ogg') ? 'ogg' : 'webm';
    body.append('audio', audio, 'signup.' + extension);
    const details = await request('/signup/voice', { body });
    if (details.noteId) signupNotes.current.push(details.noteId);
    if (details.phone) setPhone(details.phone.slice(3));
    if (details.name) setName(details.name);
    if (details.businessName) setBusinessName(details.businessName);
    setVoiceStatus('Review your details and fill any blanks before continuing.');
  }

  return (
    <main className={creating ? "login is-signup" : "login"}>
      <section className="login-visual" aria-label={creating ? "The handoff artwork" : "Counter rhythm artwork"}>
        <img
          src={creating ? "/bill-handoff.webp" : "/counter-print.jpg"}
          alt={creating ? "Two ink silhouettes pass a receipt across a counter" : "Abstract monotype with bottle-green arcs, amber ink and a ribbon of paper"}
        />
        <div className="photo-caption">
          <span className="caption-rule" /> {creating ? "The handoff" : "Counter rhythm"}
        </div>
      </section>
      <section className="login-content">
        <header className="account-header">
          <Wordmark />
          {allowSignup && (
            <button className="account-switch" type="button" disabled={locked}
              onClick={() => {
                setCreating(!creating);
                setError('');
                setVoiceStatus('');
              }}>
              {creating ? 'Back to sign in' : 'Create an account'} <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          )}
        </header>
        <div className="login-form">
          {creating ? <h1>Open your<span className="title-break"> </span><em>counter.</em></h1> : <CounterHeadline />}
          <p className="account-intro">{creating
            ? 'Speak your details or write them below.'
            : 'Sign in to see your bills and the day’s sales.'}</p>
          <form onSubmit={submit}>
            {creating && (
              <>
                <SignupVoice disabled={busy} onBusy={setVoiceBusy} onRecording={fillSignup}
                  onError={(message) => { setError(message); setVoiceStatus(''); }} />
                <div className="entry-line">
                  <label htmlFor="account-name">Your name</label>
                  <input id="account-name" autoComplete="name" required maxLength={96}
                    readOnly={locked} value={name} onChange={(event) => setName(event.target.value)} />
                </div>
                <div className="entry-line">
                  <label htmlFor="business-name">Business name</label>
                  <input id="business-name" autoComplete="organization" required maxLength={96}
                    readOnly={locked} value={businessName} onChange={(event) => setBusinessName(event.target.value)} />
                </div>
              </>
            )}
            <div className="entry-line">
              <label htmlFor={confirmation ? 'code' : 'phone'}>
                {confirmation ? 'Verification code' : 'Mobile number'}
              </label>
              {confirmation ? (
                <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
                  maxLength={6} required readOnly={busy} value={code} autoFocus key="otp"
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
              ) : (
                <div className="phone-entry">
                  <span>+91</span>
                  <input id="phone" type="tel" autoComplete="tel-national" pattern="[0-9]{10}"
                    maxLength={10} required readOnly={locked} placeholder="98765 43210" value={phone}
                    onChange={(event) => { setPhone(event.target.value.replace(/\D/g, '')); setError(''); }} />
                </div>
              )}
            </div>
            {confirmation && <p className="account-hint" role="status">Code sent to +91 {phone}.</p>}
            <button className="account-submit" disabled={locked} aria-busy={busy}>
              {creating ? 'Create account' : allowSignup ? 'Sign in' : confirmation ? 'Verify code' : 'Send code'}
              <ArrowRight size={22} aria-hidden="true" />
            </button>
            {confirmation && (
              <button type="button" className="plain" disabled={busy}
                onClick={() => { setConfirmation(null); setCode(''); setError(''); }}>
                Change number
              </button>
            )}
            {error && (
              <p className="feedback" role="alert">
                {error}
              </p>
            )}
            <div role="status" className="account-hint auth-status">{status}</div>
          </form>
        </div>
      </section>
    </main>
  );
}

function HourlyChart({ values }) {
  const maximum = Math.max(1, ...values);
  return (
    <div className="sales-chart" role="group" aria-label="Paid sales by hour, India time">
      <div className="chart-level">
        <span>{maximum === 1 && !values.some(Boolean) ? '₹0' : asRupees(maximum)}</span>
        <span>₹0</span>
      </div>
      <div className="chart-inner">
        <div className="chart-bars">
          {values.map((value, hour) => (
            <div
              className="bar-slot"
              key={hour}
              title={hour.toString().padStart(2, '0') + ':00 · ' + asRupees(value)}
              aria-label={hour + ':00, ' + asRupees(value)}
            >
              <div
                style={{ height: Math.max(1, (value / maximum) * 100) + '%' }}
                className={value ? 'bar' : 'bar empty-bar'}
              />
            </div>
          ))}
        </div>
        <div className="chart-labels">
          <span>12 am</span>
          <span>6 am</span>
          <span>12 pm</span>
          <span>6 pm</span>
          <span>11 pm</span>
        </div>
      </div>
    </div>
  );
}

const destinations = [
  ['overview','Overview', ChartNoAxesColumn], ['orders','Orders', ReceiptText],
  ['vendors','Vendors', Truck], ['menu','Menu', BookOpen], ['bank','Bank details', Banknote],
];
function currentView() {
  const hash = window.location.hash.slice(1);
  if (hash === 'profile') return hash;
  if (hash === 'bills') return 'orders';
  return destinations.some(([id]) => id === hash) ? hash : 'overview';
}

function Ledger({ onSignOut, onSessionExpired }) {
  const [view,setView] = useState(currentView);
  const ledger = useRef(null);
  const previousView = useRef(view);

  useLayoutEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const entrance = ledger.current.animate(
      [{ opacity: 0.55, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }],
      { duration: 240, easing: 'cubic-bezier(.2,.7,.25,1)' },
    );
    return () => entrance.cancel();
  }, [view]);
  useEffect(() => {
    const navigate = () => {setView(currentView()); window.scrollTo(0,0);};
    window.addEventListener('hashchange',navigate);
    return () => window.removeEventListener('hashchange',navigate);
  }, []);
  const [date, setDate] = useState(today);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ loading: true });
  const [openBill, setOpenBill] = useState(null);
  const dialog = useRef(null);
  const [signOutError, setSignOutError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    request('/workspace', { signal: controller.signal })
      .then(async ({ restaurant, menu, profile }) => {
        const analytics = restaurant
          ? await request('/analytics?date=' + date, { signal: controller.signal })
          : null;
        if (!controller.signal.aborted) setState({ restaurant, menu, profile, analytics, date, revision });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error.status === 401) onSessionExpired();
        else setState({ error: error.message, date, revision });
      });
    return () => controller.abort();
  }, [onSessionExpired, date, revision]);

  function showBill(id) {
    setOpenBill({id});
    dialog.current?.showModal();
    request('/bills/' + id)
      .then(({ bill }) => setOpenBill(current => current?.id === id ? { id, bill } : current))
      .catch((error) => {
        if (error.status === 401) onSessionExpired();
        else setOpenBill(current => current?.id === id ? { id, error:error.message } : current);
      });
  }

  const { restaurant, analytics, error } = state;
  const loading = state.loading || date !== state.date || revision !== state.revision;
  return (
    <div className="layout">
      <aside className="sidebar">
        <Wordmark />
        <nav aria-label="Ledger navigation">
          {destinations.map(([id,label,Icon]) => <a href={'#'+id} key={id} aria-current={id === view ? 'page' : undefined}>
            <Icon size={19} aria-hidden="true" /><span>{label}</span></a>)}
        </nav>
        <div className="account-links">
          <a href="#profile" aria-current={view === 'profile' ? 'page' : undefined}><UserRound size={17} /> Profile</a>
        <button className="signout" onClick={() => void onSignOut().catch((error) => setSignOutError(error.message))}>
          <LogOut size={17} /> Sign out
        </button>
        </div>
        {signOutError && <p role="alert">{signOutError}</p>}
      </aside>
      <main ref={ledger} className="ledger" data-view={view}>
        <div className="page-heading"><header className="ledger-header">
          <div>
            {restaurant && (
              <p className="restaurant-name">
                {restaurant.name} <span>{restaurant.city}</span>
              </p>
            )}
            <h1>{view === 'profile' ? 'Your profile' : destinations.find(([id]) => id === view)[1]}</h1>
            {view === 'overview' && !loading && analytics && <div className="daily-sales">
              <span>Paid sales</span><strong>{asRupees(analytics.revenue)}</strong>
            </div>}
          </div>
          {view === 'overview' && <img className="masthead-print" src="/closing-the-counter.webp"
            alt="Closing the Counter, an abstract print of stacked order slips in vermilion, green and carbon ink" />}
        </header>
        <div className="ledger-tools">
          <div className="ledger-controls">
            {(view === 'overview' || view === 'orders') && <label className="date-field">
              <input
                aria-label="Business date"
                type="date"
                value={date}
                max={today()}
                onChange={(event) => {
                  if (event.target.value) setDate(event.target.value);
                }}
              />
            </label>}
            <button
              className="refresh"
              aria-label="Refresh ledger"
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>
        </div>
        {loading && (
          <p className="notice" role="status">
            Loading the ledger…
          </p>
        )}
        {!loading && error && (
          <p className="notice feedback" role="alert">
            {error}
          </p>
        )}
        {view === 'profile' && state.profile && (
          <Profile profile={state.profile} restaurant={restaurant} onSaved={details => {
            setState(current => ({ ...current, ...details }));
            setRevision(value => value + 1);
          }} />
        )}
        {!loading && view !== 'profile' && !restaurant && !error && (
          <div className="notice">
            <Utensils size={22} />
            <h2>Set up your restaurant</h2>
            <p>
              Open the counter app and say your restaurant name and location. Your sales will appear here as
              bills are recorded.
            </p>
          </div>
        )}
        {restaurant && <div hidden={view !== 'orders'}><Orders menu={state.menu || []} onBill={(bill,proposal) => {
          setOpenBill({id:bill.id,bill,proposal}); dialog.current?.showModal(); setRevision(v => v+1);
        }}/></div>}
        {restaurant && <div className="menu-spread" hidden={view !== 'menu'}><Menu menu={state.menu || []}
          onMenu={menu => setState(s => ({...s,menu}))}/></div>}
        {restaurant && <div className="vendor-spread" hidden={view !== 'vendors'}><Vendors revision={revision}/></div>}
        {restaurant && <div hidden={view !== 'bank'}><Bank restaurant={restaurant}
          onSave={restaurant => setState(s => ({...s,restaurant}))}/></div>}
        {!loading && analytics && (
          <>
            {view === 'overview' && <><div className="metrics">
              <div>
                <span>Bills created</span>
                <strong>{analytics.orders}</strong>
              </div>
              <div>
                <span>Payments recorded</span>
                <strong>{analytics.paidCount}</strong>
              </div>
              <div>
                <span>Average paid bill</span>
                <strong>{asRupees(analytics.average)}</strong>
              </div>
            </div>
            {!analytics.orders && date === today() && <section className="overview-next">
              <div><h2>{state.menu?.length ? 'Take the first order' : 'Bring your menu to the counter'}</h2>
              <p>{state.menu?.length ? 'Your dishes are ready for voice billing.' : 'A photo of the printed menu is enough to get started.'}</p></div>
              <a href={state.menu?.length ? '#orders' : '#menu'}>{state.menu?.length ? 'Open orders' : 'Add menu'} <ArrowRight size={16}/></a>
            </section>}
            <div className="report-grid">
              <section>
                <h2>Sales by hour</h2>
                {analytics.hourly.some(value => value !== 0) ? <HourlyChart values={analytics.hourly} /> : <p className="subtle">Hourly sales appear when you record the first payment for this date.</p>}
              </section>
              <section>
                <h2>Top dishes</h2>
                {analytics.items.length ? (
                  <ol className="dishes">
                    {analytics.items.map((item, index) => (
                      <li key={item.name + item.variant}>
                        <span className="rank">{index + 1}</span>
                        <span>
                          {item.name} {item.variant}
                        </span>
                        <strong>{item.quantity} sold</strong>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="subtle">Dishes appear when their bills are paid.</p>
                )}
              </section>
            </div>
            </>}
            {view === 'orders' && <section className="bills" id="bills">
              <h2>Bills</h2>
              {analytics.bills.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Bill</th>
                        <th scope="col">Time</th>
                        <th scope="col">Payment</th>
                        <th scope="col">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.bills.map((bill) => (
                        <tr key={bill.id}>
                          <td>
                            <button className="bill-link" onClick={() => showBill(bill.id)}>
                              #{String(bill.number).padStart(4, '0')}
                            </button>
                          </td>
                          <td>{time.format(new Date(bill.created))}</td>
                          <td>
                            {bill.paid
                              ? bill.movements?.some(m => m.amount > 0 && m.method !== bill.method) ? 'Paid' : bill.method === 'upi' ? 'UPI · Paid' : 'Cash · Paid'
                              : bill.received ? asRupees(bill.total-bill.received)+' due' : 'Awaiting payment'}
                          </td>
                          <td>{asRupees(bill.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="subtle">Bills created on this date appear here.</p>
              )}
            </section>}
          </>
        )}
        <dialog
          ref={dialog}
          className="bill-dialog"
          onClose={() => setOpenBill(null)}
          aria-labelledby="bill-title"
        >
          <BillReceipt openBill={openBill} restaurant={restaurant} onPayment={async (method,change) => {
                  const id = openBill.bill.id;
                  setOpenBill(b => ({...b,saving:true,error:null}));
                  try {
                    const {bill} = await request('/bills/'+id+'/payment',{body:{method,...change}});
                    setOpenBill(b => b?.id === id ? {id,bill} : b); setRevision(v => v+1);
                  } catch(e) {setOpenBill(b => b?.id === id ? {...b,error:e.message,saving:false} : b);}
                }}/>
        </dialog>
      </main>
    </div>
  );
}

function App() {
  const [signedIn, setSignedIn] = useState(undefined);
  const [sessionError, setSessionError] = useState('');
  const [mode, setMode] = useState('otp');
  const [phoneEmailClientId, setPhoneEmailClientId] = useState('');
  const [expiresAt, setExpiresAt] = useState(null);
  const sessionExpired = React.useCallback(() => setSignedIn(false), []);
  const loadSession = React.useCallback(async () => {
    setSessionError('');
    try {
      const session = await request('/auth/session');
      setMode(session.mode);
      setPhoneEmailClientId(session.phoneEmailClientId || '');
      setExpiresAt(session.expiresAt || null);
      setSignedIn(session.authenticated);
    } catch (error) {
      setSessionError(error.message);
    }
  }, []);
  useEffect(() => { void loadSession(); }, [loadSession]);

  useEffect(() => {
    if (!signedIn || !expiresAt) return;
    let timer;
    function checkExpiry() {
      clearTimeout(timer);
      const remaining = Date.parse(expiresAt) - Date.now();
      if (remaining <= 0) setSignedIn(false);
      else timer = setTimeout(checkExpiry, Math.min(remaining, 2147483647));
    }
    checkExpiry();
    document.addEventListener('visibilitychange', checkExpiry);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', checkExpiry); };
  }, [signedIn, expiresAt]);

  async function signOut() {
    await request('/auth/logout', { body: {} });
    setSignedIn(false);
  }

  if (signedIn === undefined)
    return (
      <main className="startup">
        <Wordmark />
        {sessionError ? (
          <>
            <p role="alert">{sessionError}</p>
            <button className="plain" onClick={loadSession}>Retry</button>
          </>
        ) : <p role="status">Opening your ledger…</p>}
      </main>
    );
  return signedIn
    ? <Ledger onSignOut={signOut} onSessionExpired={sessionExpired} />
    : <Login mode={mode} phoneEmailClientId={phoneEmailClientId} onSignIn={loadSession} />;
}

createRoot(document.getElementById('root')).render(<App />);
