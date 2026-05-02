What Still Needs to Happen
1. RevenueCat Account Setup (most critical)
Create an account at app.revenuecat.com, then:

Create a new Project → add an iOS App and Android App
Copy the iOS API key → set EXPO_PUBLIC_RC_API_KEY_IOS
Copy the Android API key → set EXPO_PUBLIC_RC_API_KEY_ANDROID
Create an Entitlement named exactly professional
Create a default Offering with two Packages: monthly and annual (mapping to the App Store / Play Store product IDs defined in the code as rc_professional_monthly and rc_professional_annual)
2. Apple App Store Connect
Register the app bundle ID in Apple Developer Console
Create a Subscription Group → add two auto-renewable subscriptions:
rc_professional_monthly — $79.99/mo, 14-day free trial
rc_professional_annual — $828.00/yr, 14-day free trial
Link your App Store Connect account to RevenueCat (RevenueCat dashboard → App → App Store Connect API Key) so RC can validate receipts
Set up Sandbox Testers in App Store Connect for testing purchases
3. Google Play Console (if shipping Android)
Create the app → enable billing
Create two subscriptions with matching product IDs (rc_professional_monthly, rc_professional_annual)
Link the Play Console service account to RevenueCat
4. RevenueCat Webhook
Deploy the server to get a public HTTPS URL
In RC dashboard → Webhooks: add https://your-server.com/v1/webhooks/revenuecat
Generate a random secret → set it as REVENUECAT_WEBHOOK_AUTH_KEY in your server environment
The code already validates this header and handles all event types (purchase, renewal, cancellation, billing issue, etc.)
5. One Code Fix: app.json Plugin
react-native-purchases requires a native config plugin entry in app.json for EAS builds to work. Add it to the plugins array:


"react-native-purchases"
Without this, EAS will produce a build that crashes when any RC call is made on a real device.

6. Document the Missing Env Vars
Neither .env.example mentions these — add them so future devs know they're required:

Server: REVENUECAT_WEBHOOK_AUTH_KEY
Mobile: EXPO_PUBLIC_RC_API_KEY_IOS, EXPO_PUBLIC_RC_API_KEY_ANDROID
7. IAP Requires a Native Build
RevenueCat / in-app purchases do not work in Expo Go. You must build with EAS (eas build) and test on a real device or simulator with the sandbox account. The existing EXPO_PUBLIC_BYPASS_PAYWALL=true bypass in .env.local covers Expo Go development.

Summary: The code is complete. The remaining work is all external account setup — RevenueCat project, App Store Connect products, webhook URL configuration, and the single app.json plugin line. Once those keys are in your env and the webhook is live, the full billing loop (subscribe → webhook fires → DB updates → JWT reflects new tier → feature gates unlock) is ready to go.