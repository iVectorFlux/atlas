export interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  server?: Record<string, any>;
  ios?: Record<string, any>;
  android?: Record<string, any>;
  plugins?: Record<string, any>;
}

const config: CapacitorConfig = {
  appId: "com.zawvee.tutor",
  appName: "Zawvee AI Tutor",
  webDir: "out",
  server: {
    // During local tablet development, points directly to the Next.js dev server
    androidScheme: "https",
    iosScheme: "https",
  },
  ios: {
    // Optimized for iPad Pro / iPad Air with Apple Pencil
    allowsLinkPreview: false,
    scrollEnabled: false,
    backgroundColor: "#141416",
    preferredContentMode: "mobile",
  },
  android: {
    backgroundColor: "#141416",
    allowMixedContent: true,
  },
  plugins: {
    Keyboard: {
      resize: "none",
    },
  },
};

export default config;
