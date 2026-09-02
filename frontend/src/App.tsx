import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Bug,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  Database,
  ExternalLink,
  Flame,
  Footprints,
  Globe,
  KeyRound,
  Layers,
  LogIn,
  LogOut,
  Network,
  Radio,
  Server,
  ShieldAlert,
  Sparkles,
  Terminal,
  Trash2,
  UserCheck,
  Zap,
} from 'lucide-react';
import {
  rumConfigInfo,
  setUserIdentity,
  clearUserIdentity,
  getCurrentUser,
  recordCustomError,
  recordCustomEvent,
  recordPageView,
  recordHttpEvent,
  addBreadcrumb,
  getBreadcrumbs,
  subscribeToRumLogs,
  broadcastTelemetry,
  initGlobalErrorListeners,
  TelemetryEvent,
  Breadcrumb,
  UserProfile,
} from './rum';

// Helper: Decode JWT without external libraries
function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      window
        .atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

// Error Boundary with Component Stack & Breadcrumbs
interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Captured in ErrorBoundary:', error, errorInfo);
    recordCustomError(error, { componentStack: errorInfo.componentStack || undefined });
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-rose-950/40 border border-rose-600/40 rounded-xl my-4 text-rose-200">
          <div className="flex items-center gap-2 font-semibold text-rose-400 mb-2">
            <ShieldAlert className="w-5 h-5" />
            <span>React Error Boundary Caught a Crash!</span>
          </div>
          <p className="text-sm font-mono bg-rose-950/80 p-3 rounded-lg border border-rose-800/50 mb-3">
            {this.state.error?.message || 'Unknown render error'}
          </p>
          <button
            onClick={this.reset}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Reset Component
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Faulty Component that crashes on render
const CrashingComponent: React.FC<{ shouldCrash: boolean }> = ({ shouldCrash }) => {
  if (shouldCrash) {
    throw new Error('Fatal React Component Crash: undefined is not a function at <CrashingComponent>');
  }
  return (
    <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm">
      ✓ Component is rendering normally without exceptions.
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'lab' | 'claims' | 'journey' | 'snippets' | 'logs' | 'guide'>('lab');
  const [logs, setLogs] = useState<TelemetryEvent[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [isCrashing, setIsCrashing] = useState(false);
  const [httpLoading, setHttpLoading] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile>(getCurrentUser());
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    initGlobalErrorListeners();

    // 1. Check if returning from Cognito Hosted UI redirect with JWT tokens
    const hash = window.location.hash.substring(1);
    if (hash) {
      const params = new URLSearchParams(hash);
      const idToken = params.get('id_token');
      const accessToken = params.get('access_token');

      if (idToken) {
        const claims = parseJwt(idToken);
        if (claims) {
          const email = (claims.email as string) || (claims['cognito:username'] as string) || 'user@cognito.com';
          const sub = (claims.sub as string) || '';
          setUserIdentity(email, email, sub, {
            ...claims,
            tier: 'Enterprise',
            authTime: claims.auth_time,
            tokenType: 'Cognito-Hosted-UI-JWT',
          });
          setCurrentUser(getCurrentUser());
        }
        // Clean URL hash without reload
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }

    // 2. Subscribe to internal debug stream
    const unsubscribe = subscribeToRumLogs((event) => {
      setLogs((prev) => [event, ...prev.slice(0, 49)]);
      setBreadcrumbs(getBreadcrumbs());
    });

    // 3. Record initial page view
    recordPageView('/dashboard');

    return () => unsubscribe();
  }, []);

  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    recordPageView(`/${tab}`);
  };

  const getCognitoLoginUrl = () => {
    const currentOrigin = window.location.origin;
    const isLocal = currentOrigin.includes('localhost');
    const redirectUri = isLocal
      ? 'http://localhost:5173'
      : currentOrigin.replace('http://', 'https://'); // Cognito hosted UI requires https for non-localhost

    return `https://${rumConfigInfo.cognitoDomain}/login?client_id=${rumConfigInfo.cognitoClientId}&response_type=token&scope=email+openid+profile&redirect_uri=${encodeURIComponent(
      redirectUri
    )}`;
  };

  const handleCognitoLogin = () => {
    addBreadcrumb('navigation', 'Redirecting to Cognito Managed Hosted UI', {});
    window.location.href = getCognitoLoginUrl();
  };

  const handleLogout = () => {
    clearUserIdentity();
    setCurrentUser(getCurrentUser());
  };

  // 1. Error simulation handlers
  const triggerUncaughtError = () => {
    addBreadcrumb('ui_click', `Clicked 'Trigger Uncaught Error' button`, { user: currentUser.email });
    setTimeout(() => {
      throw new TypeError(`Uncaught TypeError: User '${currentUser.email}' requested billing calculation of null`);
    }, 10);
  };

  const triggerUnhandledRejection = () => {
    addBreadcrumb('ui_click', `Clicked 'Trigger Unhandled Rejection' button`, { user: currentUser.email });
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`UnhandledPromiseRejection: Session for ${currentUser.email} failed telemetry handshake`));
      }, 50);
    });
  };

  const triggerCustomLoggedError = () => {
    addBreadcrumb('user_action', `Attempted bulk report export for ${currentUser.email}`, { sub: currentUser.sub });
    try {
      throw new RangeError(`ExportQuotaExceeded: User ${currentUser.email} exceeded row export limit (500/100)`);
    } catch (err) {
      recordCustomError(err as Error, {
        customAttributes: {
          feature: 'ExportReport',
          requestedRows: 500,
          allowedMax: 100,
          userTier: currentUser.tier,
          authenticatedSub: currentUser.sub,
        },
      });
    }
  };

  // 2. HTTP telemetry simulation
  const triggerHttpCall = async (type: 'success' | '404' | '500' | 'slow') => {
    setHttpLoading(type);
    let url = '';
    if (type === 'success') url = 'https://jsonplaceholder.typicode.com/todos/1';
    if (type === '404') url = 'https://jsonplaceholder.typicode.com/non-existent-api-endpoint-404';
    if (type === '500') url = 'https://httpstat.us/500';
    if (type === 'slow') url = 'https://httpstat.us/200?sleep=2000';

    addBreadcrumb('network', `Initiated HTTP request to ${url}`, { user: currentUser.email, type });

    const start = performance.now();
    try {
      const res = await fetch(url);
      const duration = Math.round(performance.now() - start);
      addBreadcrumb('network', `HTTP ${res.status} received from ${url}`, { durationMs: duration, status: res.status });
      broadcastTelemetry({
        type: 'http',
        title: `HTTP ${res.status} [User: ${currentUser.email}]`,
        detail: { url, status: res.status, durationMs: duration, user: currentUser.email },
      });
      recordHttpEvent(url, 'GET', res.status, res.statusText, undefined, duration);
    } catch (err) {
      const duration = Math.round(performance.now() - start);
      addBreadcrumb('network', `HTTP Network failure on ${url}: ${(err as Error).message}`, { durationMs: duration });
      broadcastTelemetry({
        type: 'http',
        title: `HTTP Network Failure [User: ${currentUser.email}]`,
        detail: { url, error: (err as Error).message, durationMs: duration, user: currentUser.email },
      });
      recordHttpEvent(url, 'GET', undefined, undefined, err as Error, duration);
    } finally {
      setHttpLoading(null);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Navigation Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-tr from-cyan-500 to-blue-600 rounded-xl shadow-lg shadow-cyan-500/20">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">AWS CloudWatch RUM</h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-700/50 font-medium">
                  Lambda Proxy POC
                </span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 font-mono">
                  No-Cookies
                </span>
              </div>
              <p className="text-xs text-slate-400">Direct Lambda Proxy + Cognito User Pool Hosted UI</p>
            </div>
          </div>

          {/* Auth Status & Login Button */}
          <div className="flex items-center gap-2">
            {currentUser.isAuthenticated ? (
              <div className="flex items-center gap-2 bg-slate-900 border border-emerald-500/40 px-3 py-1.5 rounded-xl">
                <UserCheck className="w-4 h-4 text-emerald-400" />
                <div className="text-xs">
                  <span className="font-semibold text-emerald-300">{currentUser.email}</span>
                  <span className="text-[10px] text-slate-400 block font-mono">sub: {currentUser.sub.slice(0, 8)}...</span>
                </div>
                <button
                  onClick={handleLogout}
                  title="Log Out"
                  className="p-1 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded-lg ml-1 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={handleCognitoLogin}
                className="px-3.5 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-cyan-500/20 flex items-center gap-1.5 transition-all"
              >
                <LogIn className="w-3.5 h-3.5" />
                Login via Cognito Hosted UI
              </button>
            )}
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-xl flex-wrap">
            <button
              onClick={() => handleTabChange('lab')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'lab'
                  ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Telemetry Lab
            </button>
            <button
              onClick={() => handleTabChange('claims')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'claims'
                  ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              User Claims
            </button>
            <button
              onClick={() => handleTabChange('journey')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'journey'
                  ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Footprints className="w-3.5 h-3.5" />
              Lead-up Breadcrumbs
              {breadcrumbs.length > 0 && (
                <span className="px-1.5 py-0.2 bg-cyan-950 text-cyan-300 rounded text-[10px] border border-cyan-800">
                  {breadcrumbs.length}
                </span>
              )}
            </button>
            <button
              onClick={() => handleTabChange('snippets')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'snippets'
                  ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              Architecture Snippets
            </button>
            <button
              onClick={() => handleTabChange('logs')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 relative ${
                activeTab === 'logs'
                  ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              Live Stream
              {logs.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse inline-block ml-0.5" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Connection & Telemetry Status Bar */}
      <div className="bg-slate-900/40 border-b border-slate-800/80 text-xs py-2 px-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-slate-400">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Backend Proxy:</span>
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> AWS Lambda Function URL
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Cookies:</span>
              <span className="font-mono text-amber-300">Disabled (In-Memory Only)</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">User Profile:</span>
              <span className="font-mono text-cyan-300">{currentUser.email}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-slate-400">
              <Globe className="w-3.5 h-3.5 text-cyan-400" /> S3 Static Website
            </span>
          </div>
        </div>
      </div>

      {/* Main Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full">
        {/* Tab 1: Telemetry Lab */}
        {activeTab === 'lab' && (
          <div className="space-y-8">
            {/* Intro Hero */}
            <div className="p-6 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/40 border border-slate-800 rounded-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-cyan-400" />
                    Lambda Backend Proxy & Claims Testing Lab
                  </h2>
                  <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
                    All telemetry is forwarded directly to your <strong>AWS Lambda Function URL</strong> (zero Identity Pool credentials in client).
                    {currentUser.isAuthenticated ? (
                      <span className="text-emerald-400 block mt-1">
                        ✓ Logged in via Cognito as <strong>{currentUser.email}</strong>. Every error is tied to your authenticated Cognito claims!
                      </span>
                    ) : (
                      <span className="text-amber-400 block mt-1">
                        Currently acting as anonymous guest. Click "Login via Cognito Hosted UI" above to authenticate and test claims-linking.
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Test Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* 1. Errors with User Attribution */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between hover:border-slate-700 transition-colors">
                <div>
                  <div className="flex items-center gap-2 text-rose-400 font-semibold mb-2">
                    <Bug className="w-5 h-5" />
                    <h3>User-Attributed Errors</h3>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">
                    Trigger errors while acting as <strong className="text-slate-200">{currentUser.email}</strong>. Forwarded via Lambda proxy.
                  </p>

                  <div className="space-y-2">
                    <button
                      onClick={triggerUncaughtError}
                      className="w-full text-left px-3 py-2 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/40 rounded-xl text-xs font-medium text-rose-300 transition-colors flex items-center justify-between"
                    >
                      <span>Trigger Uncaught TypeError</span>
                      <Flame className="w-4 h-4 text-rose-400" />
                    </button>

                    <button
                      onClick={triggerUnhandledRejection}
                      className="w-full text-left px-3 py-2 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/40 rounded-xl text-xs font-medium text-rose-300 transition-colors flex items-center justify-between"
                    >
                      <span>Trigger Unhandled Promise Rejection</span>
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                    </button>

                    <button
                      onClick={triggerCustomLoggedError}
                      className="w-full text-left px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-medium text-slate-200 transition-colors flex items-center justify-between"
                    >
                      <span>Custom Error with Breadcrumbs</span>
                      <ShieldAlert className="w-4 h-4 text-amber-400" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Tagged user: {currentUser.email}</span>
                  <span className="text-cyan-400">Lambda &gt; RUM</span>
                </div>
              </div>

              {/* 2. React Component Crash */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between hover:border-slate-700 transition-colors">
                <div>
                  <div className="flex items-center gap-2 text-amber-400 font-semibold mb-2">
                    <ShieldAlert className="w-5 h-5" />
                    <h3>Component Tree Crash</h3>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">
                    Captures React component hierarchy: <code className="text-[11px] text-cyan-300">&lt;App&gt; &gt; &lt;CrashingComponent&gt;</code>.
                  </p>

                  <ErrorBoundary>
                    <CrashingComponent shouldCrash={isCrashing} />
                  </ErrorBoundary>

                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => {
                        addBreadcrumb('ui_click', `Clicked 'Crash Component' button`, { user: currentUser.email });
                        setIsCrashing(true);
                      }}
                      disabled={isCrashing}
                      className="flex-1 px-3 py-2 bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/40 rounded-xl text-xs font-medium text-amber-200 transition-colors disabled:opacity-50"
                    >
                      Crash Component
                    </button>
                    {isCrashing && (
                      <button
                        onClick={() => setIsCrashing(false)}
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-medium text-slate-200"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-500">
                  Captures React ErrorBoundary stack trace
                </div>
              </div>

              {/* 3. HTTP / API Request Telemetry */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between hover:border-slate-700 transition-colors">
                <div>
                  <div className="flex items-center gap-2 text-cyan-400 font-semibold mb-2">
                    <Network className="w-5 h-5" />
                    <h3>HTTP Request Telemetry</h3>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">
                    Trigger API calls to generate network breadcrumbs before errors.
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => triggerHttpCall('success')}
                      disabled={httpLoading !== null}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-medium text-emerald-300 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> 200 OK
                    </button>

                    <button
                      onClick={() => triggerHttpCall('404')}
                      disabled={httpLoading !== null}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-medium text-amber-300 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" /> 404 Not Found
                    </button>

                    <button
                      onClick={() => triggerHttpCall('500')}
                      disabled={httpLoading !== null}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-medium text-rose-300 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <Flame className="w-3.5 h-3.5" /> 500 Error
                    </button>

                    <button
                      onClick={() => triggerHttpCall('slow')}
                      disabled={httpLoading !== null}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-medium text-purple-300 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <Clock className="w-3.5 h-3.5" /> 2s Latency
                    </button>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-500">
                  {httpLoading ? `In flight: ${httpLoading}...` : 'Forwarded via Lambda Function URL'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: User Claims Inspector */}
        {activeTab === 'claims' && (
          <div className="space-y-6">
            <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl">
              <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-cyan-400" />
                Cognito Authenticated Claims & Session Context
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                When a user logs in via the Cognito Managed Hosted UI, their JWT claims are extracted and linked to every single
                RUM event sent to the Lambda proxy:
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-2xl space-y-4">
                <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-cyan-400" /> Active Session Claims
                </h3>

                <div className="space-y-2 text-xs font-mono">
                  <div className="p-2.5 bg-slate-950 rounded-lg flex justify-between">
                    <span className="text-slate-400">Authenticated:</span>
                    <span className={currentUser.isAuthenticated ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                      {currentUser.isAuthenticated ? 'YES (Cognito User Pool)' : 'NO (Anonymous Guest)'}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-950 rounded-lg flex justify-between">
                    <span className="text-slate-400">Email (User ID):</span>
                    <span className="text-cyan-300">{currentUser.email}</span>
                  </div>

                  <div className="p-2.5 bg-slate-950 rounded-lg flex justify-between">
                    <span className="text-slate-400">Cognito Subject (sub):</span>
                    <span className="text-slate-300 truncate max-w-[200px]">{currentUser.sub}</span>
                  </div>

                  <div className="p-2.5 bg-slate-950 rounded-lg flex justify-between">
                    <span className="text-slate-400">Subscription Tier:</span>
                    <span className="text-purple-300">{currentUser.tier}</span>
                  </div>
                </div>

                <div className="pt-2">
                  {currentUser.isAuthenticated ? (
                    <button
                      onClick={handleLogout}
                      className="w-full py-2 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/40 text-rose-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5"
                    >
                      <LogOut className="w-4 h-4" /> Log Out
                    </button>
                  ) : (
                    <button
                      onClick={handleCognitoLogin}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5"
                    >
                      <LogIn className="w-4 h-4" /> Open Cognito Login Page
                    </button>
                  )}
                </div>
              </div>

              {/* Demo Credentials Box */}
              <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-2xl space-y-3">
                <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-emerald-400" /> Pre-Seeded Test User Credentials
                </h3>
                <p className="text-xs text-slate-400">
                  Use these credentials on the Cognito Managed Login Page, or click "Sign up" to create a new user:
                </p>

                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs font-mono space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Username:</span>
                    <span className="text-emerald-300 font-semibold">testuser@example.com</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Password:</span>
                    <span className="text-emerald-300 font-semibold">P@ssword123!</span>
                  </div>
                </div>

                <button
                  onClick={handleCognitoLogin}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Test Cognito Hosted UI
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Lead-up Breadcrumbs Timeline */}
        {activeTab === 'journey' && (
          <div className="space-y-6">
            <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl">
              <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <Footprints className="w-5 h-5 text-cyan-400" />
                Error Lead-up Breadcrumb Buffer (In-Memory / No Cookies)
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                When an error throws, this rolling memory buffer is forwarded to AWS Lambda alongside the error.
              </p>
            </div>

            {breadcrumbs.length === 0 ? (
              <div className="p-12 text-center bg-slate-900/40 border border-slate-800 rounded-2xl text-slate-500 text-sm">
                No breadcrumbs yet. Click buttons in the Telemetry Lab to record actions.
              </div>
            ) : (
              <div className="relative pl-6 border-l-2 border-cyan-500/30 space-y-4 ml-4">
                {breadcrumbs.map((crumb, idx) => (
                  <div key={idx} className="relative group">
                    <div className="absolute -left-[31px] top-1.5 w-3.5 h-3.5 rounded-full bg-slate-950 border-2 border-cyan-400 group-hover:scale-125 transition-transform" />
                    <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              crumb.category === 'ui_click'
                                ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                                : crumb.category === 'navigation'
                                ? 'bg-blue-950 text-blue-400 border border-blue-800'
                                : crumb.category === 'network'
                                ? 'bg-purple-950 text-purple-400 border border-purple-800'
                                : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            }`}
                          >
                            {crumb.category}
                          </span>
                          <span className="font-semibold text-xs text-slate-200">{crumb.message}</span>
                        </div>
                        <span className="font-mono text-[11px] text-slate-500">
                          {new Date(crumb.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {crumb.data && (
                        <div className="mt-2 p-2 bg-slate-950 rounded text-[11px] font-mono text-slate-400 overflow-x-auto">
                          <pre>{JSON.stringify(crumb.data, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Architecture Snippets */}
        {activeTab === 'snippets' && (
          <div className="space-y-6">
            <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl">
              <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <Code2 className="w-5 h-5 text-cyan-400" />
                Direct Lambda Proxy & Claims Linking Pattern
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                Here is the exact pattern used in this prototype to omit the Cognito Identity Pool, disable cookies, and link Cognito User Pool claims:
              </p>
            </div>

            {/* Snippet 1 */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-cyan-400 text-sm flex items-center gap-2">
                  <Server className="w-4 h-4" /> 1. AWS Lambda Telemetry Forwarder (Backend Proxy)
                </h3>
                <button
                  onClick={() =>
                    copyToClipboard(
                      `import { RUMClient, PutRumEventsCommand } from '@aws-sdk/client-rum';

const rum = new RUMClient({ region: 'ap-southeast-1' });

export const handler = async (event) => {
  const payload = JSON.parse(event.body);
  
  await rum.send(new PutRumEventsCommand({
    Id: process.env.RUM_APP_MONITOR_ID,
    BatchId: crypto.randomUUID(),
    AppMonitorDetails: { name: 'my-app', version: '1.0.0' },
    UserDetails: { userId: payload.userId, sessionId: payload.sessionId },
    RumEvents: payload.events
  }));

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};`,
                      'code-lambda'
                    )
                  }
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedCode === 'code-lambda' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="p-4 bg-slate-950 rounded-xl font-mono text-xs text-cyan-200 overflow-x-auto">
{`import { RUMClient, PutRumEventsCommand } from '@aws-sdk/client-rum';

const rum = new RUMClient({ region: 'ap-southeast-1' });

export const handler = async (event) => {
  const payload = JSON.parse(event.body);
  
  await rum.send(new PutRumEventsCommand({
    Id: process.env.RUM_APP_MONITOR_ID,
    BatchId: crypto.randomUUID(),
    AppMonitorDetails: { name: 'my-app', version: '1.0.0' },
    UserDetails: { userId: payload.userId, sessionId: payload.sessionId },
    RumEvents: payload.events
  }));

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};`}
              </pre>
            </div>

            {/* Snippet 2 */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-cyan-400 text-sm flex items-center gap-2">
                  <KeyRound className="w-4 h-4" /> 2. Extracting Cognito Claims & Attaching to Session
                </h3>
                <button
                  onClick={() =>
                    copyToClipboard(
                      `// Decode Cognito JWT token on redirect
const hash = window.location.hash.substring(1);
const params = new URLSearchParams(hash);
const idToken = params.get('id_token');

if (idToken) {
  const claims = parseJwt(idToken);
  // Attach claims to active telemetry session
  setUserIdentity(claims.email, claims.email, claims.sub, claims);
}`,
                      'code-claims'
                    )
                  }
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedCode === 'code-claims' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="p-4 bg-slate-950 rounded-xl font-mono text-xs text-cyan-200 overflow-x-auto">
{`// Decode Cognito JWT token on redirect
const hash = window.location.hash.substring(1);
const params = new URLSearchParams(hash);
const idToken = params.get('id_token');

if (idToken) {
  const claims = parseJwt(idToken);
  // Attach claims to active telemetry session
  setUserIdentity(claims.email, claims.email, claims.sub, claims);
}`}
              </pre>
            </div>
          </div>
        )}

        {/* Tab 5: Live Stream */}
        {activeTab === 'logs' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-cyan-400" />
                  Live In-App Telemetry Stream
                </h2>
                <p className="text-xs text-slate-400">
                  Real-time events dispatched through the AWS Lambda proxy.
                </p>
              </div>
              <button
                onClick={() => setLogs([])}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear Logs
              </button>
            </div>

            {logs.length === 0 ? (
              <div className="p-12 text-center bg-slate-900/40 border border-slate-800 rounded-2xl text-slate-500 text-sm">
                No events recorded yet. Click buttons in the <span className="text-cyan-400 font-medium">Telemetry Lab</span> tab.
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col gap-2 font-mono text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            log.type === 'error'
                              ? 'bg-rose-950 text-rose-400 border border-rose-800'
                              : log.type === 'http'
                              ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                              : log.type === 'performance'
                              ? 'bg-purple-950 text-purple-400 border border-purple-800'
                              : log.type === 'breadcrumb'
                              ? 'bg-amber-950 text-amber-400 border border-amber-800'
                              : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          }`}
                        >
                          {log.type}
                        </span>
                        <span className="font-semibold text-slate-200">{log.title}</span>
                      </div>
                      <span className="text-slate-500 text-[11px]">{log.timestamp}</span>
                    </div>

                    <div className="p-2.5 bg-slate-950 rounded-lg text-slate-300 overflow-x-auto text-[11px]">
                      <pre>{typeof log.detail === 'string' ? log.detail : JSON.stringify(log.detail, null, 2)}</pre>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-900/30 py-4 px-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <span>AWS CloudWatch RUM + Lambda Proxy + Cognito User Pool</span>
          <span className="font-mono text-[11px] text-slate-400">Terraform Managed</span>
        </div>
      </footer>
    </div>
  );
}
