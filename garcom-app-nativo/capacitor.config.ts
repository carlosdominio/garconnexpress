import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.garconnexpress.garcom',
  appName: 'GarçomExpress',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    LocalNotifications: {
      smallIcon: "ic_stat_notification",
      iconColor: "#27ae60",
      sound: "notificacao.mp3"
    }
  }
};

export default config;
