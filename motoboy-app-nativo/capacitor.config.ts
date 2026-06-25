import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.garconnexpress.motoboy2',
  appName: 'Motoboy Express',
  webDir: 'www',
  server: {
    url: 'https://garconnexpress.vercel.app/app-motoboy',
    cleartext: true,
    androidScheme: 'https'
  },
  plugins: {
    PushNotifications: {
      presentationOptions: []
    },
    StatusBar: {
      overlaysWebView: false
    },
    LocalNotifications: {
      smallIcon: "ic_stat_notification",
      iconColor: "#488AFF",
      sound: "notificacao.mp3"
    },
    SplashScreen: {
      launchShowDuration: 4000,
      launchAutoHide: true,
      backgroundColor: "#f1f2f6",
      androidSplashResourceName: "splash",
      showSpinner: true,
      androidSpinnerStyle: "large",
      spinnerColor: "#e74c3c"
    }
  }
};

export default config;
