export type Locale = 'ru' | 'en';

export interface Translations {
  // Auth
  auth: {
    login: string;
    register: string;
    logout: string;
    guest: string;
    email: string;
    password: string;
    confirmPassword: string;
    minChars: string;
    submit: {
      login: string;
      register: string;
    };
    later: string;
    loading: string;
    errors: {
      enterEmail: string;
      invalidEmail: string;
      enterPassword: string;
      passwordMinLength: string;
      passwordMismatch: string;
      authError: string;
    };
    tradeRequiresAuth: string;
    buy: string;
    sell: string;
  };

  // Migration Modal
  migration: {
    title: string;
    description: string;
    local: string;
    server: string;
    instruments: string;
    noInstruments: string;
    autoScroll: string;
    on: string;
    off: string;
    keepLocal: string;
    loadServer: string;
    decideLater: string;
  };

  // Loading
  loading: {
    connecting: string;
    subscribing: string;
    loadingOrderbook: string;
    loadingClusters: string;
    server: string;
    connected: string;
    orderbook: string;
    clusters: string;
    tickChart: string;
    waiting: string;
    waitingTrades: string;
    levels: string;
    columns: string;
    ticks: string;
    // Retry and errors
    retrying: string;
    connectionFailed: string;
    retry: string;
    failed: string;
    attempt: string;
  };

  // UI
  ui: {
    addSymbol: string;
    noSymbols: string;
    autoScroll: string;
    autoScrollHint: string;
    settings: string;
    select: string;
    active: string;
    addNew: string;
    selectInstrument: string;
    volPrice: string;
    beta: string;
  };

  // Common
  common: {
    loading: string;
  };
}
